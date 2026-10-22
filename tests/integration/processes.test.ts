import { beforeAll, afterAll, expect, test } from 'bun:test';
import type { MikroORM } from '@mikro-orm/postgresql';
import { DeleteQueueCommand } from '@aws-sdk/client-sqs';
import { openDatabase } from '../../src/infrastructure/persistence/orm';
import { WagerStore } from '../../src/infrastructure/persistence/wager-store';
import { Wagering } from '../../src/application/wagering';
import { Money } from '../../src/domain/money';
import { SqsGateway } from '../../src/infrastructure/messaging/sqs';
import { WagerConsumer } from '../../src/infrastructure/workers/consumer';
let admin: MikroORM;
let orm: MikroORM;
let store: WagerStore;
let broker: SqsGateway;
let databaseUrl: string;
const name = 'wager_test_' + crypto.randomUUID().replaceAll('-', '');
const query = <T extends object = Record<string, unknown>>(sql: string, args: unknown[] = []) =>
  orm.em.fork().execute<T[]>(sql, args);
const open = async () => {
  const wallet = await store.openWallet(
    crypto.randomUUID(),
    Money.from({ amount: '100.00', currency: 'BRL' }),
  );
  return { walletId: wallet.snapshot.id, playerId: wallet.snapshot.playerId };
};
const body = (wallet: { walletId: string; playerId: string }) => ({
  ...wallet,
  providerId: 'provider',
  externalTransactionId: crypto.randomUUID(),
  roundId: 'r',
  gameId: 'g',
  kind: 'BET',
  money: { amount: '10.00', currency: 'BRL' },
});
async function child(env: Record<string, string>) {
  const process = Bun.spawn(
    [Bun.which('bun') ?? globalThis.process.execPath, 'tests/fixtures/process-worker.ts'],
    {
      cwd: globalThis.process.cwd(),
      env: { ...globalThis.process.env, DATABASE_URL: databaseUrl, SILENT_LOGS: '1', ...env },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const reader = process.stdout.getReader();
  let ready = '';
  const deadline = setTimeout(() => process.kill(), 20000);
  try {
    while (!ready.includes('READY')) {
      const next = await reader.read();
      if (next.done) {
        throw new Error(
          'Worker exited before barrier: ' + (await new Response(process.stderr).text()),
        );
      }
      ready += new TextDecoder().decode(next.value);
    }
  } finally {
    clearTimeout(deadline);
    reader.releaseLock();
  }
  return process;
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
  if (orm) {
    await orm.close();
  }
  if (admin) {
    await admin.em.fork().execute('drop database if exists ' + name + ' with (force)');
    await admin.close();
  }
});
test('three actual Bun processes share a wallet safely and also process distinct wallets', async () => {
  const shared = await open();
  const one = body(shared);
  const unique = await Promise.all([open(), open(), open()]);
  const children = await Promise.all(
    unique.map(async (wallet) => {
      const own = body(wallet);
      const inputs = [
        ...Array.from({ length: 20 }, () => ({ body: one, key: one.externalTransactionId })),
        ...Array.from({ length: 10 }, () => ({ body: own, key: own.externalTransactionId })),
      ];
      return child({ TEST_INPUTS: JSON.stringify(inputs) });
    }),
  );
  // All three independent runtimes have connected before any financial work starts.
  for (const worker of children) {
    worker.stdin.write('go\n');
    worker.stdin.end();
  }
  expect(await Promise.all(children.map((worker) => worker.exited))).toEqual([0, 0, 0]);
  for (const wallet of [shared, ...unique]) {
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
  }
}, 60000);
test('worker exits after commit before ack; another process connection safely handles redelivery', async () => {
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
  const worker = await child({
    TEST_MODE: 'crash-after-commit',
    TEST_QUEUE: requests,
    TEST_PREFIX: name + '-',
    TEST_MESSAGE: JSON.stringify(message),
  });
  worker.stdin.write('go\n');
  worker.stdin.end();
  expect(await worker.exited).toBe(86);
  expect(
    (
      await query<{
        balance: string;
      }>('select balance from wallets where id=?', [wallet.walletId])
    )[0]?.balance,
  ).toBe('90.00');
  await broker.visibility(requests, message!, 0);
  const [again] = await broker.receive(requests, 1);
  expect(again).toBeDefined();
  await new WagerConsumer(broker, new Wagering(store)).handle(requests, again!);
  expect(
    await query("select id from wallet_ledger where wallet_id=? and direction='DEBIT'", [
      wallet.walletId,
    ]),
  ).toHaveLength(1);
  // Open a fresh ORM after the crashed process to verify persistent balance/ledger reconciliation.
  const restarted = await openDatabase(databaseUrl);
  try {
    const [row] = await restarted.em.fork().execute<
      {
        balance: string;
        ledger: string;
      }[]
    >("select w.balance,(select sum(case when direction='CREDIT' then amount else -amount end) from wallet_ledger where wallet_id=w.id)::text ledger from wallets w where id=?", [wallet.walletId]);
    expect(row?.balance).toBe(row?.ledger);
  } finally {
    await restarted.close();
  }
}, 60000);
