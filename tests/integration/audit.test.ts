import { beforeAll, afterAll, expect, test } from 'bun:test';
import type { MikroORM } from '@mikro-orm/postgresql';
import { openDatabase } from '../../src/infrastructure/persistence/orm';
import { WagerStore } from '../../src/infrastructure/persistence/wager-store';
import { Wagering } from '../../src/application/wagering';
import { Money } from '../../src/domain/money';
let admin: MikroORM;
let orm: MikroORM;
let store: WagerStore;
let app: Wagering;
const name = 'wager_test_' + crypto.randomUUID().replaceAll('-', '');
const query = <T extends object = Record<string, unknown>>(
  sql: string,
  parameters: unknown[] = [],
) => orm.em.fork().execute<T[]>(sql, parameters);
const wager = (wallet: { id: string; playerId: string }, kind = 'BET', reference?: string) => ({
  providerId: 'audit',
  externalTransactionId: crypto.randomUUID(),
  walletId: wallet.id,
  playerId: wallet.playerId,
  roundId: 'round',
  gameId: 'game',
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
}, 60000);
afterAll(async () => {
  if (orm) await orm.close();
  if (admin) {
    await admin.em.fork().execute('drop database if exists ' + name + ' with (force)');
    await admin.close();
  }
});
test('ledger cannot be truncated directly or through cascading wallet truncation', async () => {
  await store.openWallet(crypto.randomUUID(), Money.from({ amount: '100.00', currency: 'BRL' }));
  await expect(query('truncate wallet_ledger')).rejects.toThrow('immutable');
  await expect(query('truncate wallets cascade')).rejects.toThrow('immutable');
});
test('version cannot change without a corresponding balance change', async () => {
  const wallet = await store.openWallet(crypto.randomUUID(), Money.zero('BRL'));
  await expect(
    query('update wallets set version=version+1 where id=?', [wallet.snapshot.id]),
  ).rejects.toThrow('version');
});
test('balance overflow is rejected and remains auditable with no ledger movement', async () => {
  const wallet = await store.openWallet(crypto.randomUUID(), Money.maximum('BRL'));
  const input = wager(wallet.snapshot, 'WIN');
  input.money.amount = '0.01';
  const result = await app.submit(input, input.externalTransactionId);
  expect(result.status).toBe('REJECTED');
  expect(result.failureCode).toBe('BALANCE_LIMIT_EXCEEDED');
  expect(
    await query('select id from wallet_ledger where transaction_id=?', [result.transactionId]),
  ).toHaveLength(0);
  expect(
    (
      await query<{ version: number }>('select version from wallets where id=?', [
        wallet.snapshot.id,
      ])
    )[0]?.version,
  ).toBe(1);
});
test('parallel distinct refunds cannot reverse the same bet twice', async () => {
  const wallet = await store.openWallet(
    crypto.randomUUID(),
    Money.from({ amount: '100.00', currency: 'BRL' }),
  );
  const bet = wager(wallet.snapshot);
  await app.submit(bet, bet.externalTransactionId);
  const first = wager(wallet.snapshot, 'REFUND', bet.externalTransactionId);
  const second = wager(wallet.snapshot, 'REFUND', bet.externalTransactionId);
  const results = await Promise.all([
    app.submit(first, first.externalTransactionId),
    app.submit(second, second.externalTransactionId),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual(['PROCESSED', 'REJECTED']);
  expect(results.find((result) => result.status === 'REJECTED')?.failureCode).toBe(
    'ALREADY_REVERSED',
  );
});
test('LOSS is processed without ledger or wallet version change', async () => {
  const wallet = await store.openWallet(crypto.randomUUID(), Money.zero('BRL'));
  const loss = wager(wallet.snapshot, 'LOSS');
  loss.money.amount = '0.00';
  const result = await app.submit(loss, loss.externalTransactionId);
  expect(result.status).toBe('PROCESSED');
  expect(
    await query('select id from wallet_ledger where wallet_id=?', [wallet.snapshot.id]),
  ).toHaveLength(0);
  expect(
    (
      await query<{ version: number }>('select version from wallets where id=?', [
        wallet.snapshot.id,
      ])
    )[0]?.version,
  ).toBe(1);
  expect(
    await query(
      "select id from outbox_messages where aggregate_id=? and event_type='WagerTransactionProcessed'",
      [wallet.snapshot.id],
    ),
  ).toHaveLength(1);
});
