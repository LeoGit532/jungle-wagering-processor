import { expect, test } from 'bun:test';
import { Money } from '../../src/domain/money';
import { Wallet, WalletLedgerEntry } from '../../src/domain/wallet';
const money = (amount: string, currency = 'BRL') => Money.from({ amount, currency });
const at = '2026-10-21T12:00:00.000Z';
const open = () =>
  Wallet.open({ id: 'wallet', playerId: 'player', initialBalance: money('100'), at });
test('debit and credit produce balanced ledger and increment version', () => {
  const wallet = open();
  const debit = wallet.debit(money('80'), 'bet', 'entry1', at);
  expect(wallet.snapshot.balance.toString()).toBe('20.00');
  expect(wallet.snapshot.version).toBe(2);
  expect(debit.isBalanced()).toBe(true);
  const credit = wallet.credit(money('10'), 'win', 'entry2', at);
  expect(credit.isBalanced()).toBe(true);
  expect(wallet.snapshot.balance.toString()).toBe('30.00');
  expect(wallet.snapshot.version).toBe(3);
});
test('failed debit preserves state', () => {
  const wallet = open();
  expect(() => wallet.debit(money('101'), 'bet', 'entry', at)).toThrow('INSUFFICIENT_FUNDS');
  expect(wallet.snapshot.balance.toString()).toBe('100.00');
  expect(wallet.snapshot.version).toBe(1);
});
test('currency mismatch and zero movement preserve state', () => {
  const wallet = open();
  expect(() => wallet.credit(money('1', 'USD'), 'win', 'entry', at)).toThrow('CURRENCY_MISMATCH');
  expect(() => wallet.debit(money('0'), 'bet', 'entry', at)).toThrow('INVALID_MOVEMENT_AMOUNT');
  expect(wallet.snapshot.version).toBe(1);
});
test('ledger rejects incorrect arithmetic', () => {
  expect(() =>
    WalletLedgerEntry.create({
      id: 'e',
      walletId: 'w',
      transactionId: 't',
      direction: 'DEBIT',
      money: money('10'),
      balanceBefore: money('100'),
      balanceAfter: money('99'),
      createdAt: at,
    }),
  ).toThrow('UNBALANCED_LEDGER');
});
test('rehydration copies and freezes snapshot', () => {
  const state = { ...open().snapshot };
  const wallet = Wallet.rehydrate(state);
  state.version = 99;
  expect(wallet.snapshot.version).toBe(1);
  expect(Object.isFrozen(wallet.snapshot)).toBe(true);
});
