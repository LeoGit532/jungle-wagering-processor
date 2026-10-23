import { beforeAll, afterAll, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import type { MikroORM } from '@mikro-orm/postgresql';
import { openDatabase } from '../../src/infrastructure/persistence/orm';
import { WagerStore } from '../../src/infrastructure/persistence/wager-store';
import { Money } from '../../src/domain/money';
import { createApplication } from '../../src/bootstrap/create-app';
let admin: MikroORM;
let orm: MikroORM;
let app: INestApplication;
let base: string;
let brokerReady = true;
const name = 'wager_test_' + crypto.randomUUID().replaceAll('-', '');
const http = (path: string, body?: unknown, key?: string) =>
  fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
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
  app = await createApplication(
    orm,
    async () => {
      if (!brokerReady) {
        throw new Error('offline');
      }
    },
    false,
  );
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
}, 60000);
afterAll(async () => {
  if (app) {
    await app.close();
  }
  if (orm) {
    await orm.close();
  }
  if (admin) {
    await admin.em.fork().execute('drop database if exists ' + name + ' with (force)');
    await admin.close();
  }
});
const open = async () => {
  const playerId = crypto.randomUUID();
  const res = await http('/wallets', {
    playerId,
    initialBalance: { amount: '100.00', currency: 'BRL' },
  });
  expect(res.status).toBe(201);
  const wallet = (await res.json()) as {
    id: string;
  };
  return { walletId: wallet.id, playerId };
};
const wager = (
  wallet: {
    walletId: string;
    playerId: string;
  },
  amount = '10.00',
) => ({
  ...wallet,
  providerId: 'provider',
  externalTransactionId: crypto.randomUUID(),
  roundId: 'r',
  gameId: 'g',
  kind: 'BET',
  money: { amount, currency: 'BRL' },
});
test('HTTP financial lifecycle, replay, hash conflict, queries and reconciliation', async () => {
  const wallet = await open();
  const body = wager(wallet);
  const key = crypto.randomUUID();
  const first = await http('/wagering/transactions', body, key);
  expect(first.status).toBe(200);
  const result = (await first.json()) as {
    transactionId: string;
    balance: {
      amount: string;
    };
  };
  expect(result.balance.amount).toBe('90.00');
  const replay = await http(
    '/wagering/transactions',
    Object.fromEntries(Object.entries(body).reverse()),
    key,
  );
  expect(replay.status).toBe(200);
  expect(
    (
      (await replay.json()) as {
        idempotentReplay: boolean;
      }
    ).idempotentReplay,
  ).toBe(true);
  expect(
    (
      await http(
        '/wagering/transactions',
        { ...body, money: { amount: '11.00', currency: 'BRL' } },
        key,
      )
    ).status,
  ).toBe(409);
  expect((await http('/wagering/transactions/' + result.transactionId)).status).toBe(200);
  expect(
    (await http('/providers/provider/wagering/transactions/' + body.externalTransactionId)).status,
  ).toBe(200);
  const recon = await http('/wallets/' + wallet.walletId + '/reconciliation', {});
  expect(recon.status).toBe(200);
  expect(
    (
      (await recon.json()) as {
        consistent: boolean;
      }
    ).consistent,
  ).toBe(true);
});
test('HTTP distinguishes invalid, missing wallet, conflict, rejection and pending', async () => {
  const wallet = await open();
  const body = wager(wallet, '101.00');
  expect((await http('/wagering/transactions', body)).status).toBe(400);
  expect((await http('/wagering/transactions', { ...body, kind: 'OPENING' }, 'a')).status).toBe(
    400,
  );
  expect(
    (await http('/wagering/transactions', { ...body, walletId: crypto.randomUUID() }, 'b')).status,
  ).toBe(404);
  expect((await http('/wagering/transactions', body, 'c')).status).toBe(422);
  expect(
    (
      await http(
        '/wagering/transactions',
        { ...wager(wallet), kind: 'REFUND', referenceExternalTransactionId: 'absent' },
        'd',
      )
    ).status,
  ).toBe(202);
  expect(
    (
      await http('/wallets', {
        playerId: wallet.playerId,
        initialBalance: { amount: '0.00', currency: 'BRL' },
      })
    ).status,
  ).toBe(409);
});
test('ledger cursor is opaque, wallet-scoped and has no repeats', async () => {
  const wallet = await open();
  await http('/wagering/transactions', wager(wallet), crypto.randomUUID());
  const page = (await (await http('/wallets/' + wallet.walletId + '/ledger?limit=1')).json()) as {
    items: {
      id: string;
    }[];
    nextCursor: string;
  };
  expect(page.items).toHaveLength(1);
  expect(page.nextCursor).toBeTruthy();
  const next = (await (
    await http('/wallets/' + wallet.walletId + '/ledger?limit=1&cursor=' + page.nextCursor)
  ).json()) as {
    items: {
      id: string;
    }[];
    nextCursor: null;
  };
  expect(next.items).toHaveLength(1);
  expect(next.items[0]?.id).not.toBe(page.items[0]?.id);
  expect(next.nextCursor).toBeNull();
  const other = await open();
  expect(
    (await http('/wallets/' + other.walletId + '/ledger?cursor=' + page.nextCursor)).status,
  ).toBe(400);
  expect((await http('/wallets/' + wallet.walletId + '/ledger?limit=0')).status).toBe(400);
});
test('health is public and readiness distinguishes failed broker', async () => {
  expect((await http('/health/live')).status).toBe(200);
  expect((await http('/health/ready')).status).toBe(200);
  brokerReady = false;
  expect((await http('/health/ready')).status).toBe(503);
  expect((await http('/health/live')).status).toBe(200);
  brokerReady = true;
});
test('foreign-currency operation is an auditable rejection rather than an infrastructure error', async () => {
  const usd = await new WagerStore(orm).openWallet(
    crypto.randomUUID(),
    Money.from({ amount: '100.00', currency: 'USD' }),
  );
  const response = await http(
    '/wagering/transactions',
    wager({ walletId: usd.snapshot.id, playerId: usd.snapshot.playerId }),
    crypto.randomUUID(),
  );
  expect(response.status).toBe(422);
  expect(
    (
      (await response.json()) as {
        status: string;
      }
    ).status,
  ).toBe('REJECTED');
});

test('financial lock timeout returns 503 and the same request safely succeeds after release', async () => {
  const wallet = await open();
  const body = wager(wallet);
  const key = crypto.randomUUID();
  const holder = orm.em.fork();
  await holder.begin();
  try {
    await holder.execute('select id from wallets where id=? for update', [wallet.walletId]);
    const response = await http('/wagering/transactions', body, key);
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'INFRASTRUCTURE_UNAVAILABLE',
    );
  } finally {
    await holder.rollback();
  }
  const recovered = await http('/wagering/transactions', body, key);
  expect(recovered.status).toBe(200);
  expect(((await recovered.json()) as { balance: { amount: string } }).balance.amount).toBe(
    '90.00',
  );
}, 15000);
