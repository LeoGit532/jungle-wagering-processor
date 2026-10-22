import { beforeAll, afterAll, expect, test } from 'bun:test';
import type { MikroORM } from '@mikro-orm/postgresql';
import { DeleteQueueCommand } from '@aws-sdk/client-sqs';
import { openDatabase } from '../../src/infrastructure/persistence/orm';
import { WagerStore } from '../../src/infrastructure/persistence/wager-store';
import { Wagering } from '../../src/application/wagering';
import { Money } from '../../src/domain/money';
import { SqsGateway } from '../../src/infrastructure/messaging/sqs';
import { WagerConsumer } from '../../src/infrastructure/workers/consumer';
import { OutboxPublisher } from '../../src/infrastructure/workers/outbox';
let admin: MikroORM;
let orm: MikroORM;
let store: WagerStore;
let app: Wagering;
let broker: SqsGateway;
let consumer: WagerConsumer;
const name = 'wager_test_' + crypto.randomUUID().replaceAll('-', '');
const query = <T extends object = Record<string, unknown>>(sql: string, args: unknown[] = []) =>
  orm.em.fork().execute<T[]>(sql, args);
const money = (amount: string) => Money.from({ amount, currency: 'BRL' });
const open = async () => {
  const wallet = await store.openWallet(crypto.randomUUID(), money('100.00'));
  return { walletId: wallet.snapshot.id, playerId: wallet.snapshot.playerId };
};
const body = (
  wallet: {
    walletId: string;
    playerId: string;
  },
  kind = 'BET',
  reference?: string,
) => ({
  ...wallet,
  providerId: 'provider',
  externalTransactionId: crypto.randomUUID(),
  roundId: 'r',
  gameId: 'g',
  kind,
  money: { amount: '10.00', currency: 'BRL' },
  ...(reference ? { referenceExternalTransactionId: reference } : {}),
});
beforeAll(async () => {
  const url = new URL(
    process.env.TEST_DATABASE_URL ?? 'postgresql://challenge:challenge@localhost:5432/postgres',
  );
  admin = await openDatabase(url.toString());
  await admin.em.fork().execute('create database ' + name);
  url.pathname = '/' + name;
  orm = await openDatabase(url.toString());
  await orm.getMigrator().up();
  store = new WagerStore(orm);
  app = new Wagering(store);
  broker = new SqsGateway(name + '-');
  await broker.ready();
  consumer = new WagerConsumer(broker, app);
}, 60000);
afterAll(async () => {
  if (broker) {
    const queues = await broker.queues();
    for (const QueueUrl of Object.values(queues))
      await broker.client.send(new DeleteQueueCommand({ QueueUrl }));
    broker.close();
  }
  if (orm) {
    await orm.close();
  }
  if (admin) {
    await admin.em.fork().execute('drop database if exists ' + name + ' with (force)');
    await admin.close();
  }
});
test('SQS redelivery commits once and ack follows the financial transaction', async () => {
  const wallet = await open();
  const data = body(wallet);
  const envelope = {
    messageId: crypto.randomUUID(),
    type: 'WagerTransactionRequested',
    occurredAt: new Date().toISOString(),
    data: { ...data, idempotencyKey: data.externalTransactionId },
  };
  const { requests } = await broker.queues();
  await broker.send(requests, envelope, wallet.walletId, crypto.randomUUID());
  const [message] = await broker.receive(requests, 1);
  expect(message).toBeDefined();
  // Process first delivery without deleting it, simulating lost ack after commit.
  const noAck = Object.create(broker) as SqsGateway;
  noAck.ack = async () => {};
  await new WagerConsumer(noAck, app).handle(requests, message!);
  await broker.visibility(requests, message!, 0);
  const [again] = await broker.receive(requests, 1);
  expect(again).toBeDefined();
  await consumer.handle(requests, again!);
  expect(
    (
      await query<{
        balance: string;
      }>('select balance from wallets where id=?', [wallet.walletId])
    )[0]?.balance,
  ).toBe('90.00');
  expect(
    await query("select id from wallet_ledger where wallet_id=? and direction='DEBIT'", [
      wallet.walletId,
    ]),
  ).toHaveLength(1);
  expect(
    await query('select * from inbox_messages where message_id=? and processed_at is not null', [
      envelope.messageId,
    ]),
  ).toHaveLength(1);
  expect(await broker.receive(requests, 0)).toHaveLength(0);
}, 20000);
test('invalid message is moved to real DLQ and removed from input', async () => {
  const { requests, dlq } = await broker.queues();
  await broker.send(requests, 'not json', 'invalid', crypto.randomUUID());
  const [message] = await broker.receive(requests, 1);
  await consumer.handle(requests, message!);
  const [dead] = await broker.receive(dlq, 1);
  expect(dead?.Body).toBe('not json');
  await broker.ack(dlq, dead!);
  expect(await broker.receive(requests, 0)).toHaveLength(0);
}, 20000);
test('transient failure retries, then exhausts into DLQ', async () => {
  const wallet = await open();
  const data = body(wallet);
  const envelope = {
    messageId: crypto.randomUUID(),
    type: 'WagerTransactionRequested',
    occurredAt: new Date().toISOString(),
    data: { ...data, idempotencyKey: data.externalTransactionId },
  };
  const broken = new Wagering({
    openWallet: store.openWallet.bind(store),
    submit: async () => {
      throw new Error('database temporarily offline');
    },
  });
  const worker = new WagerConsumer(broker, broken);
  const { requests, dlq } = await broker.queues();
  await broker.send(requests, envelope, wallet.walletId, crypto.randomUUID());
  const [first] = await broker.receive(requests, 1);
  await worker.handle(requests, first!);
  expect(
    await query('select * from inbox_messages where message_id=?', [envelope.messageId]),
  ).toHaveLength(0);
  // Set visibility to zero so the test exercises redelivery without sleeping through production backoff.
  let current = first!;
  for (let attempt = 2; attempt <= 5; attempt++) {
    await broker.visibility(requests, current, 0);
    const [next] = await broker.receive(requests, 1);
    expect(next).toBeDefined();
    expect(Number(next!.Attributes?.ApproximateReceiveCount)).toBe(attempt);
    await worker.handle(requests, next!);
    current = next!;
  }
  const [dead] = await broker.receive(dlq, 1);
  expect(dead?.Body).toBe(JSON.stringify(envelope));
  await broker.ack(dlq, dead!);
}, 20000);
test('reference delivered first is resumed once, missing reference expires with rejection event', async () => {
  const wallet = await open();
  const bet = body(wallet);
  const refund = body(wallet, 'REFUND', bet.externalTransactionId);
  const pending = await app.submit(refund, refund.externalTransactionId);
  expect(pending.status).toBe('PENDING_REFERENCE');
  await app.submit(bet, bet.externalTransactionId);
  await Promise.all([
    store.retryReference(pending.transactionId),
    store.retryReference(pending.transactionId),
  ]);
  expect(
    (
      await query<{
        status: string;
      }>('select status from wager_transactions where id=?', [pending.transactionId])
    )[0]?.status,
  ).toBe('PROCESSED');
  expect(
    (
      await query<{
        balance: string;
      }>('select balance from wallets where id=?', [wallet.walletId])
    )[0]?.balance,
  ).toBe('100.00');
  const missing = body(wallet, 'REFUND', 'missing');
  const other = await app.submit(missing, missing.externalTransactionId);
  await store.retryReference(other.transactionId, undefined, 1);
  expect(
    (
      await query<{
        status: string;
      }>('select status from wager_transactions where id=?', [other.transactionId])
    )[0]?.status,
  ).toBe('REJECTED');
  expect(
    (
      await query(
        "select * from outbox_messages where event_type='WagerTransactionRejected' and payload->'data'->>'transactionId'=?",
        [other.transactionId],
      )
    ).length,
  ).toBe(1);
});
test('two publishers claim real outbox rows without publishing the same event twice', async () => {
  const calls = new Map<string, number>();
  const actual = {
    publish: async (event: Record<string, unknown>) => {
      const id = String(event.eventId);
      calls.set(id, (calls.get(id) ?? 0) + 1);
      await broker.publish(event);
    },
  };
  const one = new OutboxPublisher(orm, actual);
  const two = new OutboxPublisher(orm, actual);
  const rows = await query<{
    id: string;
  }>('select id from outbox_messages where published_at is null');
  for (let i = 0; i < rows.length + 1; i++) await Promise.all([one.tick(), two.tick()]);
  expect(await query('select id from outbox_messages where published_at is null')).toHaveLength(0);
  expect(calls.size).toBe(rows.length);
  expect([...calls.values()].every((count) => count === 1)).toBe(true);
  const { events } = await broker.queues();
  expect((await broker.receive(events, 1)).length).toBeGreaterThan(0);
}, 30000);
test('outbox remains pending on publication failure and can be resumed by another publisher', async () => {
  const wallet = await open();
  const [event] = await query<{
    id: string;
  }>('select id from outbox_messages where aggregate_id=? and published_at is null', [
    wallet.walletId,
  ]);
  const failing = new OutboxPublisher(orm, {
    publish: async () => {
      throw new Error('SQS offline');
    },
  });
  expect(await failing.tick()).toBe(false);
  const [row] = await query<{
    attempts: number;
    published_at: null;
    next_attempt_at: Date;
  }>('select attempts,published_at,next_attempt_at from outbox_messages where id=?', [event!.id]);
  expect(row?.attempts).toBe(1);
  expect(row?.published_at).toBeNull();
  expect(row?.next_attempt_at).toBeTruthy();
  await query('update outbox_messages set next_attempt_at=now() where id=?', [event!.id]);
  expect(await new OutboxPublisher(orm, broker).tick()).toBe(true);
});
test('missing reference backs off without emitting repeated pending events', async () => {
  const wallet = await open();
  const missing = body(wallet, 'REFUND', 'still-missing');
  const pending = await app.submit(missing, missing.externalTransactionId);
  expect(await store.retryReference(pending.transactionId)).toBe(true);
  expect(await store.retryReference(pending.transactionId)).toBe(false);
  const [row] = await query<{
    reference_attempts: number;
    next_reference_at: Date;
  }>('select reference_attempts,next_reference_at from wager_transactions where id=?', [
    pending.transactionId,
  ]);
  expect(row?.reference_attempts).toBe(1);
  expect(row?.next_reference_at).toBeTruthy();
  expect(
    await query(
      "select id from outbox_messages where event_type='WagerTransactionPendingReference' and payload->'data'->>'transactionId'=?",
      [pending.transactionId],
    ),
  ).toHaveLength(1);
});
