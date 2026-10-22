import { beforeAll, afterAll, expect, test } from 'bun:test';
import type { MikroORM } from '@mikro-orm/postgresql';
import { openDatabase } from '../../src/infrastructure/persistence/orm';
import { WagerStore } from '../../src/infrastructure/persistence/wager-store';
import { Money } from '../../src/domain/money';
import { WagerTransaction } from '../../src/domain/wager-transaction';
let admin: MikroORM;
let orm: MikroORM;
let store: WagerStore;
const name = 'wager_test_' + crypto.randomUUID().replaceAll('-', '');
const money = (amount: string) => Money.from({ amount, currency: 'BRL' });
const query = <T extends object = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  orm.em.fork().execute<T[]>(sql, params);
const request = (walletId: string, playerId: string, amount = '10.00', key = crypto.randomUUID()) =>
  WagerTransaction.create({
    id: crypto.randomUUID(),
    providerId: 'provider',
    externalTransactionId: key,
    idempotencyKey: 'provider:' + key,
    payloadHash: amount + ':' + walletId,
    walletId,
    playerId,
    roundId: 'r',
    gameId: 'g',
    kind: 'BET',
    money: money(amount),
    createdAt: new Date().toISOString(),
  });
beforeAll(async () => {
  // Always create our own database; never run migrations down against an existing user database.
  const url = new URL(
    process.env.TEST_DATABASE_URL ?? 'postgresql://challenge:challenge@localhost:5432/postgres',
  );
  admin = await openDatabase(url.toString());
  await admin.em.fork().execute('create database ' + name);
  url.pathname = '/' + name;
  orm = await openDatabase(url.toString());
  await orm.getMigrator().up();
  store = new WagerStore(orm);
}, 60000);
afterAll(async () => {
  if (orm) {
    await orm.close();
  }
  if (admin) {
    await admin.em.fork().execute('drop database if exists ' + name + ' with (force)');
    await admin.close();
  }
});
test('opening is atomic and reconciles exactly', async () => {
  const wallet = await store.openWallet(crypto.randomUUID(), money('100.00'));
  const [row] = await query<{
    balance: string;
    version: number;
    total: string;
  }>(
    "select w.balance,w.version,sum(case when l.direction='CREDIT' then l.amount else -l.amount end)::text total from wallets w join wallet_ledger l on l.wallet_id=w.id where w.id=? group by w.id",
    [wallet.snapshot.id],
  );
  expect(row?.balance).toBe('100.00');
  expect(row?.total).toBe('100.00');
  expect(row?.version).toBe(1);
  expect(
    (await query('select id from outbox_messages where aggregate_id=?', [wallet.snapshot.id]))
      .length,
  ).toBe(1);
});
test('duplicate wallet and naked balance updates are rejected by schema', async () => {
  const player = crypto.randomUUID();
  const wallet = await store.openWallet(player, money('0'));
  await expect(store.openWallet(player, money('0'))).rejects.toThrow();
  await expect(
    query('update wallets set balance=-1 where id=?', [wallet.snapshot.id]),
  ).rejects.toThrow();
  await expect(
    query('update wallets set balance=1 where id=?', [wallet.snapshot.id]),
  ).rejects.toThrow();
});
test('ledger cannot be updated or deleted', async () => {
  const wallet = await store.openWallet(crypto.randomUUID(), money('100'));
  await expect(
    query('update wallet_ledger set amount=1 where wallet_id=?', [wallet.snapshot.id]),
  ).rejects.toThrow();
  await expect(
    query('delete from wallet_ledger where wallet_id=?', [wallet.snapshot.id]),
  ).rejects.toThrow();
});
test('two parallel bets of 80 on 100 produce exactly one debit', async () => {
  const wallet = await store.openWallet(crypto.randomUUID(), money('100'));
  const walletState = wallet.snapshot;
  const responses = await Promise.all([
    store.submit(request(walletState.id, walletState.playerId, '80.00')),
    store.submit(request(walletState.id, walletState.playerId, '80.00')),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual(['PROCESSED', 'REJECTED']);
  expect(
    (
      await query<{
        balance: string;
      }>('select balance from wallets where id=?', [walletState.id])
    )[0]?.balance,
  ).toBe('20.00');
  expect(
    (
      await query("select id from wallet_ledger where wallet_id=? and direction='DEBIT'", [
        walletState.id,
      ])
    ).length,
  ).toBe(1);
});
test('50 parallel deliveries debit once; replay retains original balance', async () => {
  const walletState = (await store.openWallet(crypto.randomUUID(), money('100'))).snapshot;
  const key = crypto.randomUUID();
  const replies = await Promise.all(
    Array.from({ length: 50 }, () =>
      store.submit(request(walletState.id, walletState.playerId, '10.00', key)),
    ),
  );
  expect(replies.filter((r) => !r.idempotentReplay)).toHaveLength(1);
  expect(new Set(replies.map((r) => r.transactionId)).size).toBe(1);
  await store.submit(request(walletState.id, walletState.playerId, '5.00'));
  const replay = await store.submit(request(walletState.id, walletState.playerId, '10.00', key));
  expect(replay.balance.amount).toBe('90.00');
  await expect(
    store.submit(request(walletState.id, walletState.playerId, '11.00', key)),
  ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
});
test('inbox redelivery persists once and altered payload conflicts', async () => {
  const walletState = (await store.openWallet(crypto.randomUUID(), money('100'))).snapshot;
  const key = crypto.randomUUID();
  const inbox = { consumerName: 'test', messageId: crypto.randomUUID(), payloadHash: 'hash' };
  await store.submit(request(walletState.id, walletState.playerId, '10.00', key), inbox);
  expect(
    (await store.submit(request(walletState.id, walletState.playerId, '10.00', key), inbox))
      .idempotentReplay,
  ).toBe(true);
  expect(
    (
      await query('select * from inbox_messages where message_id=? and processed_at is not null', [
        inbox.messageId,
      ])
    ).length,
  ).toBe(1);
  await expect(
    store.submit(request(walletState.id, walletState.playerId, '10.00', key), {
      ...inbox,
      payloadHash: 'changed',
    }),
  ).rejects.toThrow('INBOX_PAYLOAD_CONFLICT');
});
test('outbox failure rolls back inbox, wallet, transaction and ledger', async () => {
  const walletState = (await store.openWallet(crypto.randomUUID(), money('100'))).snapshot;
  await query(
    "create function test_fail_outbox() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end; $$",
  );
  await query(
    'create trigger test_fail before insert on outbox_messages for each row execute function test_fail_outbox()',
  );
  const transaction = request(walletState.id, walletState.playerId);
  const inbox = { consumerName: 'test', messageId: crypto.randomUUID(), payloadHash: 'hash' };
  try {
    await expect(store.submit(transaction, inbox)).rejects.toThrow('injected failure');
  } finally {
    await query('drop trigger test_fail on outbox_messages');
    await query('drop function test_fail_outbox()');
  }
  expect(
    (
      await query<{
        balance: string;
      }>('select balance from wallets where id=?', [walletState.id])
    )[0]?.balance,
  ).toBe('100.00');
  expect(
    await query('select id from wager_transactions where id=?', [transaction.snapshot.id]),
  ).toHaveLength(0);
  expect(
    await query('select * from inbox_messages where message_id=?', [inbox.messageId]),
  ).toHaveLength(0);
  expect(
    await query("select * from wallet_ledger where wallet_id=? and direction='DEBIT'", [
      walletState.id,
    ]),
  ).toHaveLength(0);
});
test('reversible migration can down then up in isolated test database', async () => {
  await orm.getMigrator().down({ to: 0 });
  expect(
    (
      await query<{
        name: string | null;
      }>("select to_regclass('public.wallets')::text name")
    )[0]?.name,
  ).toBeNull();
  await orm.getMigrator().up();
  expect(await query('select * from wallets')).toHaveLength(0);
});
