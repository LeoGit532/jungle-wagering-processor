import { cpus, availableParallelism, totalmem, platform, arch, release } from 'node:os';
import { Money } from '../src/domain/money';
import {
  apiBase,
  request,
  createWallet,
  operation,
  submit,
  reconcile,
  readMetrics,
  report,
  assert,
  type Wallet,
} from './client';
interface ScenarioResult {
  name: string;
  requests: number;
  concurrency: number;
  durationSeconds: number;
  throughput: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  unexpectedErrors: number;
  errorRate: number;
  businessRejections: number;
  replays: number;
  applied: number;
  statusCodes: Record<string, number>;
  lockConflicts: number;
  consistent: boolean;
}
const count = integer(process.env.LOAD_REQUESTS, 500, 1, 10000);
const concurrency = integer(process.env.LOAD_CONCURRENCY, 20, 1, 200);
function integer(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  assert(Number.isInteger(parsed) && parsed >= min && parsed <= max, 'Invalid load setting');
  return parsed;
}
function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}
function decimalCents(cents: bigint): string {
  return (cents / 100n).toString() + '.' + (cents % 100n).toString().padStart(2, '0');
}
async function scenario(
  name: string,
  walletCount: number,
  duplicate = false,
  constrained = false,
): Promise<ScenarioResult> {
  const wallets: Wallet[] = [];
  for (let index = 0; index < walletCount; index++)
    wallets.push(await createWallet(constrained ? '100.00' : '10000.00'));
  const duplicateBody = operation(wallets[0]!);
  const latencies: number[] = [];
  const statusCodes: Record<string, number> = {};
  const appliedPerWallet = new Map<string, number>();
  let next = 0;
  let unexpectedErrors = 0;
  let businessRejections = 0;
  let replays = 0;
  let applied = 0;
  const before = await readMetrics();
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < count) {
        const index = next++;
        const wallet = wallets[index % wallets.length]!;
        const body = duplicate
          ? duplicateBody
          : operation(wallet, 'BET', constrained ? '80.00' : '0.01');
        const start = performance.now();
        try {
          const response = await submit(body, body.externalTransactionId);
          statusCodes[response.status] = (statusCodes[response.status] ?? 0) + 1;
          if (response.status === 200 && response.result.status === 'PROCESSED') {
            if (response.result.idempotentReplay) replays++;
            else {
              applied++;
              appliedPerWallet.set(wallet.id, (appliedPerWallet.get(wallet.id) ?? 0) + 1);
            }
          } else if (
            constrained &&
            response.status === 422 &&
            response.result.failureCode === 'INSUFFICIENT_FUNDS'
          )
            businessRejections++;
          else unexpectedErrors++;
        } catch {
          unexpectedErrors++;
        } finally {
          latencies.push(performance.now() - start);
        }
      }
    }),
  );
  const durationSeconds = (performance.now() - started) / 1000;
  const after = await readMetrics();
  let consistent = true;
  for (const wallet of wallets) {
    const reconciliation = await reconcile(wallet);
    const debitCents = BigInt(appliedPerWallet.get(wallet.id) ?? 0) * (constrained ? 8000n : 1n);
    const expected = Money.from({
      amount: constrained ? '100.00' : '10000.00',
      currency: 'BRL',
    }).subtract(Money.from({ amount: decimalCents(debitCents), currency: 'BRL' }));
    consistent &&=
      reconciliation.consistent && reconciliation.storedBalance.amount === expected.toString();
  }
  latencies.sort((left, right) => left - right);
  return {
    name,
    requests: count,
    concurrency,
    durationSeconds,
    throughput: count / durationSeconds,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
    unexpectedErrors,
    errorRate: unexpectedErrors / count,
    businessRejections,
    replays,
    applied,
    statusCodes,
    lockConflicts:
      (after.get('wager_lock_conflicts_total') ?? 0) -
      (before.get('wager_lock_conflicts_total') ?? 0),
    consistent,
  };
}
async function main(): Promise<void> {
  assert((await request('/health/ready')).ok, 'Start the application before the load test');
  for (let index = 0; index < 5; index++) await request('/health/ready');
  let peakLagSeconds = 0;
  let peakPending = 0;
  let sampling = Promise.resolve();
  const sample = async () => {
    try {
      const metrics = await readMetrics();
      peakLagSeconds = Math.max(peakLagSeconds, metrics.get('wager_outbox_lag_seconds') ?? 0);
      peakPending = Math.max(peakPending, metrics.get('wager_outbox_pending') ?? 0);
    } catch {}
  };
  const timer = setInterval(() => {
    sampling = sampling.then(sample);
  }, 500);
  const results: ScenarioResult[] = [];
  try {
    for (const [name, wallets, duplicate, constrained] of [
      ['hot-wallet', 1, false, false],
      ['ten-wallets', 10, false, false],
      ['idempotent-replay', 1, true, false],
      ['insufficient-balance', 1, false, true],
    ] as const) {
      const result = await scenario(name, wallets, duplicate, constrained);
      results.push(result);
      console.log(
        name +
          ': ' +
          result.throughput.toFixed(1) +
          ' req/s; p95 ' +
          result.p95Ms.toFixed(1) +
          ' ms; consistent=' +
          result.consistent,
      );
    }
  } finally {
    clearInterval(timer);
    await sampling;
    await sample();
  }
  // Drain observation is bounded; unfinished outbox work is reported, never silently discarded.
  const drainStarted = Date.now();
  let end = await readMetrics();
  while ((end.get('wager_outbox_pending') ?? 0) > 0 && Date.now() - drainStarted < 15000) {
    await Bun.sleep(500);
    end = await readMetrics();
  }
  const data = {
    recordedAt: new Date().toISOString(),
    environment: {
      bun: Bun.version,
      platform: platform(),
      arch: arch(),
      kernel: release(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      availableParallelism: availableParallelism(),
      memoryBytes: totalmem(),
      api: apiBase,
      processingInstances: process.env.PROCESSING_INSTANCES ?? 'not declared',
    },
    methodology: {
      requestsPerScenario: count,
      concurrency,
      traffic: 'HTTP; four sequential scenarios; closed-loop clients',
      warmup: 'five readiness requests; wallet setup excluded',
      percentiles: 'nearest rank, end-to-end HTTP including JSON response',
      money: 'exact decimal strings and bigint in reconciliation',
      metrics: 'API instance counters; database-wide outbox backlog',
      limitations: [
        'Local synthetic experiment, not production capacity',
        'No fixed target RPS',
        'Other host workloads may affect results',
        'Expected 422 responses are business rejections, not transport errors',
      ],
    },
    scenarios: results,
    outbox: {
      samplingWindow: 'peak values cover offered load; lagAtEndSeconds is after bounded drain',
      peakLagSeconds,
      peakPending,
      remainingPending: end.get('wager_outbox_pending') ?? 0,
      lagAtEndSeconds: end.get('wager_outbox_lag_seconds') ?? 0,
      drainObservationSeconds: (Date.now() - drainStarted) / 1000,
    },
  };
  const rows = results
    .map(
      (result) =>
        '| ' +
        [
          result.name,
          result.requests,
          result.throughput.toFixed(1),
          result.p50Ms.toFixed(1),
          result.p95Ms.toFixed(1),
          result.p99Ms.toFixed(1),
          (result.errorRate * 100).toFixed(2) + '%',
          result.businessRejections,
          result.lockConflicts,
          result.consistent,
        ].join(' | ') +
        ' |',
    )
    .join('\n');
  const markdown =
    '# Load experiment\n\nRecorded: ' +
    data.recordedAt +
    '\n\nBun ' +
    Bun.version +
    '; ' +
    data.environment.platform +
    '/' +
    data.environment.arch +
    '; ' +
    data.environment.cpu +
    '; ' +
    data.environment.availableParallelism +
    ' available CPU threads. Processing instances: ' +
    data.environment.processingInstances +
    '.\n\n' +
    count +
    ' requests per scenario, concurrency ' +
    concurrency +
    '. Wallet creation is excluded. Percentiles include response parsing.\n\n| Scenario | Requests | req/s | p50 ms | p95 ms | p99 ms | Unexpected errors | Business rejections | Lock conflicts | Reconciled |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---|\n' +
    rows +
    '\n\nOutbox peak lag during offered load: ' +
    peakLagSeconds.toFixed(2) +
    ' s; peak pending: ' +
    peakPending +
    '; remaining after bounded drain: ' +
    data.outbox.remainingPending +
    '.\n\nAnalysis: compare the serialized hot wallet with independent wallets; replay still visits PostgreSQL for persistent guarantees. The outbox publishes asynchronously, so HTTP throughput alone is insufficient to describe total processing capacity. Expected insufficient-funds rejections are kept separate from unexpected errors. This is a synthetic local run, without a production RPS claim. Full settings and raw measurements are in the JSON report.';
  const reportName = process.env.REPORT_NAME ?? 'load-latest';
  assert(['load-latest', 'load-scaled'].includes(reportName), 'Invalid report name');
  await report(reportName, data, markdown);
  assert(
    results.every((result) => result.consistent && result.unexpectedErrors === 0),
    'Load run found an error or reconciliation mismatch',
  );
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Load experiment failed');
  process.exitCode = 1;
});
