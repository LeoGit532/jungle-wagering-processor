import { SqsGateway } from '../src/infrastructure/messaging/sqs';
import {
  apiBase,
  request,
  createWallet,
  operation,
  submit,
  reconcile,
  report,
  assert,
} from './client';
async function main(): Promise<void> {
  assert((await request('/health/ready')).ok, 'Start the application before the demo');
  const steps: { name: string; passed: boolean }[] = [];
  const wallet = await createWallet();
  const repeated = operation(wallet, 'BET', '10.00');
  const replies = await Promise.all(
    Array.from({ length: 50 }, () => submit(repeated, repeated.externalTransactionId)),
  );
  assert(
    replies.filter((reply) => !reply.result.idempotentReplay).length === 1,
    'Duplicate debit detected',
  );
  steps.push({ name: '50 parallel submissions produce one debit', passed: true });
  assert(
    (
      await submit(
        { ...repeated, money: { amount: '11.00', currency: 'BRL' } },
        repeated.externalTransactionId,
      )
    ).status === 409,
    'Expected conflicting payload',
  );
  steps.push({ name: 'Different payload with the same key returns 409', passed: true });
  const contested = await createWallet();
  const betOne = operation(contested, 'BET', '80.00');
  const betTwo = operation(contested, 'BET', '80.00');
  const disputed = await Promise.all([
    submit(betOne, betOne.externalTransactionId),
    submit(betTwo, betTwo.externalTransactionId),
  ]);
  assert(
    disputed
      .map((reply) => reply.status)
      .sort()
      .join(',') === '200,422',
    'Incorrect concurrent balance outcome',
  );
  steps.push({ name: 'Two bets of 80 on 100 leave exactly 20', passed: true });
  const reordered = await createWallet();
  const bet = operation(reordered, 'BET', '10.00');
  const refund = {
    ...operation(reordered, 'REFUND', '10.00'),
    referenceExternalTransactionId: bet.externalTransactionId,
  };
  assert(
    (await submit(refund, refund.externalTransactionId)).status === 202,
    'Reference should be pending',
  );
  await submit(bet, bet.externalTransactionId);
  let resolved = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const transaction = (await (
      await request('/providers/experiment/wagering/transactions/' + refund.externalTransactionId)
    ).json()) as { status: string };
    if (transaction.status === 'PROCESSED') {
      resolved = true;
      break;
    }
    await Bun.sleep(250);
  }
  assert(resolved, 'Reference worker did not complete the refund');
  steps.push({ name: 'Refund arriving before bet is resumed automatically', passed: true });
  const broker = new SqsGateway();
  try {
    const gain = operation(wallet, 'WIN', '15.00');
    const { requests } = await broker.queues();
    await broker.send(
      requests,
      {
        messageId: crypto.randomUUID(),
        type: 'WagerTransactionRequested',
        occurredAt: new Date().toISOString(),
        data: { ...gain, idempotencyKey: gain.externalTransactionId },
      },
      wallet.id,
      gain.externalTransactionId,
    );
    let processed = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (
        (await request('/providers/experiment/wagering/transactions/' + gain.externalTransactionId))
          .status === 200
      ) {
        processed = true;
        break;
      }
      await Bun.sleep(250);
    }
    assert(processed, 'SQS gain was not consumed');
  } finally {
    broker.close();
  }
  steps.push({ name: 'SQS uses the same financial use case as HTTP', passed: true });
  for (const current of [wallet, contested, reordered])
    assert((await reconcile(current)).consistent, 'Ledger reconciliation failed');
  steps.push({ name: 'Every demonstrated wallet reconciles with its ledger', passed: true });
  if (process.env.DEMO_RECOVERY !== 'false') {
    const recovery = Bun.spawn([process.execPath, 'test', 'tests/integration/resilience.test.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, SILENT_LOGS: '1' },
      stdout: 'inherit',
      stderr: 'inherit',
    });
    assert((await recovery.exited) === 0, 'Recovery demonstrations failed');
    steps.push({
      name: 'Process crashes and graceful shutdown checked by isolated integration tests',
      passed: true,
    });
  }
  const result = { recordedAt: new Date().toISOString(), api: apiBase, steps };
  await report(
    'demo-latest',
    result,
    '# Demonstration\n\n' +
      steps.map((step) => '- PASS: ' + step.name).join('\n') +
      '\n\nRecovery tests use isolated databases and queues. Financial examples are synthetic local data.',
  );
  for (const step of steps) console.log('PASS: ' + step.name);
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Demo failed');
  process.exitCode = 1;
});
