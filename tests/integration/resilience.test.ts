import { beforeAll, afterAll, expect, test } from 'bun:test';
import type { MikroORM } from '@mikro-orm/postgresql';
import { DeleteQueueCommand } from '@aws-sdk/client-sqs';
import { openDatabase } from '../../src/infrastructure/persistence/orm';
import { WagerStore } from '../../src/infrastructure/persistence/wager-store';
import { Wagering } from '../../src/application/wagering';
import { Money } from '../../src/domain/money';
import { SqsGateway } from '../../src/infrastructure/messaging/sqs';
import { OutboxPublisher } from '../../src/infrastructure/workers/outbox';
let admin: MikroORM;
let orm: MikroORM;
let store: WagerStore;
let broker: SqsGateway;
let databaseUrl: string;
const name = 'wager_test_' + crypto.randomUUID().replaceAll('-', '');
const query = <T extends object = Record<string, unknown>>(
  sql: string,
  parameters: unknown[] = [],
) => orm.em.fork().execute<T[]>(sql, parameters);
const open = async () => {
  const wallet = await store.openWallet(
    crypto.randomUUID(),
    Money.from({ amount: '100.00', currency: 'BRL' }),
  );
  return { walletId: wallet.snapshot.id, playerId: wallet.snapshot.playerId };
};
const wager = (wallet: { walletId: string; playerId: string }) => ({
  ...wallet,
  providerId: 'resilience',
  externalTransactionId: crypto.randomUUID(),
  roundId: 'round',
  gameId: 'game',
  kind: 'BET',
  money: { amount: '10.00', currency: 'BRL' },
});
async function spawn(mode: string, extra: Record<string, string> = {}) {
  const worker = Bun.spawn([process.execPath, 'tests/fixtures/resilience-worker.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      TEST_MODE: mode,
      TEST_PREFIX: name + '-',
      SILENT_LOGS: '1',
      ...extra,
    },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const reader = worker.stdout.getReader();
  let output = '';
  const waitFor = async (token: string) => {
    const timeout = setTimeout(() => worker.kill(), 20000);
    try {
      while (!output.includes(token)) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error('Missing worker stage ' + token);
        output += new TextDecoder().decode(chunk.value);
      }
    } finally {
      clearTimeout(timeout);
    }
  };
  await waitFor('READY');
  return { worker, waitFor, reader };
}
beforeAll(async () => {
  const url = new URL(
    process.env.TEST_DATABASE_URL ?? 'postgresql://challenge:challenge@localhost:5432/postgres',
  );
  admin = await openDatabase(url.toString());
  await admin.em.fork().execute('create database ' + name);
  url.pathname = '/' + name;
  databaseUrl = url.toString();
  orm = await openDatabase(databaseUrl);
  await orm.getMigrator().up();
  store = new WagerStore(orm);
  broker = new SqsGateway(name + '-');
  await broker.ready();
}, 60000);
afterAll(async () => {
  if (broker) {
    for (const QueueUrl of Object.values(await broker.queues()))
      await broker.client.send(new DeleteQueueCommand({ QueueUrl }));
    broker.close();
  }
  if (orm) await orm.close();
  if (admin) {
    await admin.em.fork().execute('drop database if exists ' + name + ' with (force)');
    await admin.close();
  }
});
test('process dies after financial commit; another publisher recovers durable events', async () => {
  const wallet = await open();
  const body = wager(wallet);
  const child = await spawn('commit-before-publish', { TEST_BODY: JSON.stringify(body) });
  child.worker.stdin.write('go\n');
  child.worker.stdin.end();
  expect(await child.worker.exited).toBe(87);
  child.reader.releaseLock();
  expect(
    (
      await query<{ balance: string }>('select balance from wallets where id=?', [wallet.walletId])
    )[0]?.balance,
  ).toBe('90.00');
  const pending = await query<{ id: string }>(
    'select id from outbox_messages where published_at is null',
  );
  expect(pending.length).toBeGreaterThan(0);
  const restarted = await openDatabase(databaseUrl);
  try {
    const publisher = new OutboxPublisher(restarted, broker);
    for (let count = 0; count < pending.length; count++) expect(await publisher.tick()).toBe(true);
  } finally {
    await restarted.close();
  }
  expect(await query('select id from outbox_messages where published_at is null')).toHaveLength(0);
  const { events } = await broker.queues();
  for (let count = 0; count < pending.length; count++) {
    const [event] = await broker.receive(events, 1);
    expect(event).toBeDefined();
    await broker.ack(events, event!);
  }
}, 30000);
test('publisher dies after SQS send; stable eventId allows persistent subscriber deduplication', async () => {
  await open();
  const { events } = await broker.queues();
  const child = await spawn('publish-before-mark');
  child.worker.stdin.write('go\n');
  child.worker.stdin.end();
  expect(await child.worker.exited).toBe(88);
  child.reader.releaseLock();
  const [first] = await broker.receive(events, 1);
  expect(first).toBeDefined();
  const firstEnvelope = JSON.parse(first!.Body!);
  await broker.ack(events, first!);
  expect(
    (
      await query<{ published_at: null }>('select published_at from outbox_messages where id=?', [
        firstEnvelope.eventId,
      ])
    )[0]?.published_at,
  ).toBeNull();
  const publisher = new OutboxPublisher(orm, {
    publish: async (envelope) =>
      broker.send(events, envelope, String(envelope.aggregateId), crypto.randomUUID()),
  });
  expect(await publisher.tick()).toBe(true);
  const [second] = await broker.receive(events, 1);
  const secondEnvelope = JSON.parse(second!.Body!);
  expect(secondEnvelope.eventId).toBe(firstEnvelope.eventId);
  await broker.ack(events, second!);
  // A minimal real SQL subscriber inbox, deliberately avoiding FIFO's five-minute deduplication window.
  await query('create table subscriber_receipts(event_id uuid primary key)');
  const receipts = await Promise.all(
    [firstEnvelope, secondEnvelope].map((envelope) =>
      query(
        'insert into subscriber_receipts(event_id) values (?) on conflict do nothing returning event_id',
        [envelope.eventId],
      ),
    ),
  );
  expect(receipts.flat()).toHaveLength(1);
}, 30000);
test.skipIf(process.platform === 'win32')(
  'SIGTERM waits for an in-flight financial operation before closing the database',
  async () => {
    const wallet = await open();
    const body = wager(wallet);
    const envelope = {
      messageId: crypto.randomUUID(),
      type: 'WagerTransactionRequested',
      occurredAt: new Date().toISOString(),
      data: { ...body, idempotencyKey: body.externalTransactionId },
    };
    const { requests } = await broker.queues();
    await broker.send(requests, envelope, wallet.walletId, crypto.randomUUID());
    const child = await spawn('graceful');
    child.worker.stdin.write('go\n');
    child.worker.stdin.end();
    await child.waitFor('IN_FLIGHT');
    child.worker.kill('SIGTERM');
    expect(await child.worker.exited).toBe(0);
    child.reader.releaseLock();
    expect(
      (
        await query<{ balance: string }>('select balance from wallets where id=?', [
          wallet.walletId,
        ])
      )[0]?.balance,
    ).toBe('90.00');
    expect(
      await query(
        'select message_id from inbox_messages where message_id=? and processed_at is not null',
        [envelope.messageId],
      ),
    ).toHaveLength(1);
    expect(await broker.receive(requests, 0)).toHaveLength(0);
  },
  30000,
);
test('terminal infrastructure failure is recorded without a financial movement and replays safely', async () => {
  const wallet = await open();
  const input = wager(wallet);
  const app = new Wagering(store);
  const failed = await app.recordFailure(input, input.externalTransactionId);
  expect(failed.status).toBe('FAILED');
  expect(failed.failureCode).toBe('INFRASTRUCTURE_FAILURE');
  expect(
    await query('select id from wallet_ledger where transaction_id=?', [failed.transactionId]),
  ).toHaveLength(0);
  expect((await app.submit(input, input.externalTransactionId)).status).toBe('FAILED');
});
