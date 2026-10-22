import { expect, test } from 'bun:test';
import { Money } from '../../src/domain/money';
import { Wallet } from '../../src/domain/wallet';
import { WagerTransaction, type WagerKind } from '../../src/domain/wager-transaction';
import { applyWager } from '../../src/domain/apply-wager';
const at = '2026-10-21T12:00:00.000Z';
const money = (amount: string) => Money.from({ amount, currency: 'BRL' });
const createWallet = () =>
  Wallet.open({ id: 'w', playerId: 'p', initialBalance: money('100'), at });
const createTransaction = (kind: WagerKind, amount = '10', ref?: string) =>
  WagerTransaction.create({
    id: kind,
    providerId: 'provider',
    externalTransactionId: kind,
    idempotencyKey: kind,
    payloadHash: 'hash',
    walletId: 'w',
    playerId: 'p',
    roundId: 'round',
    gameId: 'game',
    kind,
    money: money(amount),
    createdAt: at,
    referenceExternalTransactionId: ref,
  });
const applyTransaction = (
  transaction: WagerTransaction,
  wallet: Wallet,
  reference?: WagerTransaction,
  alreadyReversed = false,
) =>
  applyWager({
    transaction: transaction,
    wallet: wallet,
    reference: reference,
    alreadyReversed,
    entryId: transaction.snapshot.id,
    at,
  });
test('BET and WIN apply opposite directions', () => {
  const wallet = createWallet();
  expect(applyTransaction(createTransaction('BET'), wallet)?.state.direction).toBe('DEBIT');
  expect(applyTransaction(createTransaction('WIN', '20'), wallet)?.state.direction).toBe('CREDIT');
  expect(wallet.snapshot.balance.toString()).toBe('110.00');
});
test('LOSS produces no ledger or wallet version change', () => {
  const wallet = createWallet();
  const transaction = createTransaction('LOSS', '0');
  expect(applyTransaction(transaction, wallet)).toBeUndefined();
  expect(wallet.snapshot.version).toBe(1);
  expect(transaction.snapshot.status).toBe('PROCESSED');
});
test('insufficient bet rejects without movement', () => {
  const wallet = createWallet();
  const transaction = createTransaction('BET', '101');
  expect(applyTransaction(transaction, wallet)).toBeUndefined();
  expect(transaction.snapshot.failureCode).toBe('INSUFFICIENT_FUNDS');
  expect(wallet.snapshot.version).toBe(1);
});
test.each(['REFUND', 'ROLLBACK'] as const)('%s reverses processed BET', (kind) => {
  const wallet = createWallet();
  const bet = createTransaction('BET');
  applyTransaction(bet, wallet);
  const transaction = createTransaction(kind, '10', 'BET');
  expect(applyTransaction(transaction, wallet, bet)?.state.direction).toBe('CREDIT');
  expect(wallet.snapshot.balance.toString()).toBe('100.00');
});
test('rollback of WIN debits; insufficient reversal has distinct failure', () => {
  const wallet = createWallet();
  const win = createTransaction('WIN', '120');
  applyTransaction(win, wallet);
  applyTransaction(createTransaction('BET', '200'), wallet);
  const rollback = createTransaction('ROLLBACK', '120', 'WIN');
  expect(applyTransaction(rollback, wallet, win)).toBeUndefined();
  expect(rollback.snapshot.failureCode).toBe('REVERSAL_INSUFFICIENT_FUNDS');
  expect(wallet.snapshot.balance.toString()).toBe('20.00');
});
test('pending reference can later complete', () => {
  const wallet = createWallet();
  const refund = createTransaction('REFUND', '10', 'BET');
  applyTransaction(refund, wallet);
  expect(refund.snapshot.status).toBe('PENDING_REFERENCE');
  const bet = createTransaction('BET');
  applyTransaction(bet, wallet);
  applyTransaction(refund, wallet, bet);
  expect(refund.snapshot.status).toBe('PROCESSED');
});
test('duplicate reversal rejects with no movement', () => {
  const wallet = createWallet();
  const bet = createTransaction('BET');
  applyTransaction(bet, wallet);
  const refund = createTransaction('REFUND', '10', 'BET');
  applyTransaction(refund, wallet, bet, true);
  expect(refund.snapshot.failureCode).toBe('ALREADY_REVERSED');
  expect(wallet.snapshot.balance.toString()).toBe('90.00');
});
test('partial reversal rejects', () => {
  const wallet = createWallet();
  const bet = createTransaction('BET');
  applyTransaction(bet, wallet);
  const transaction = createTransaction('REFUND', '5', 'BET');
  applyTransaction(transaction, wallet, bet);
  expect(transaction.snapshot.failureCode).toBe('REVERSAL_AMOUNT_MISMATCH');
});
test('refund of WIN rejects', () => {
  const wallet = createWallet();
  const win = createTransaction('WIN');
  applyTransaction(win, wallet);
  const transaction = createTransaction('REFUND', '10', 'WIN');
  applyTransaction(transaction, wallet, win);
  expect(transaction.snapshot.failureCode).toBe('INVALID_REFERENCE_KIND');
});
test('cross round reference rejects', () => {
  const wallet = createWallet();
  const bet = createTransaction('BET');
  const other = WagerTransaction.rehydrate({
    ...bet.snapshot,
    status: 'PROCESSED',
    roundId: 'other',
  });
  const transaction = createTransaction('REFUND', '10', 'BET');
  applyTransaction(transaction, wallet, other);
  expect(transaction.snapshot.failureCode).toBe('REFERENCE_MISMATCH');
});
test('terminal states cannot transition again', () => {
  for (const status of ['PROCESSED', 'REJECTED', 'FAILED'] as const) {
    const transaction = WagerTransaction.rehydrate({
      ...createTransaction('BET').snapshot,
      status,
    });
    expect(() => transaction.markPendingReference()).toThrow('INVALID_TRANSACTION_STATE');
    expect(() => transaction.reject('INSUFFICIENT_FUNDS')).toThrow();
    expect(() => transaction.markProcessed(undefined, at)).toThrow();
    expect(() => transaction.fail('INFRASTRUCTURE_FAILURE')).toThrow();
  }
});
test('required reference and payload comparison', () => {
  expect(() => createTransaction('REFUND')).toThrow('REFERENCE_REQUIRED');
  const transaction = createTransaction('BET');
  expect(transaction.matchesPayload('hash')).toBe(true);
  expect(transaction.matchesPayload('different')).toBe(false);
});
