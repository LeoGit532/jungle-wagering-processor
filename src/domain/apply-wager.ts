import { DomainError } from './money';
import { Wallet, WalletLedgerEntry, type WalletState } from './wallet';
import {
  WagerTransaction,
  type WagerState,
  type FailureCode,
  type WagerKind,
} from './wager-transaction';
interface ApplyWagerInput {
  transaction: WagerTransaction;
  wallet: Wallet;
  reference?: WagerTransaction;
  alreadyReversed: boolean;
  entryId: string;
  at: string;
}
/** Persist these changes under the wallet lock, in the same SQL transaction. */
export function applyWager(input: ApplyWagerInput): WalletLedgerEntry | undefined {
  const { transaction, wallet, reference, at } = input;
  if (transaction.isTerminal()) {
    throw new DomainError('INVALID_TRANSACTION_STATE');
  }
  if (!matchesWallet(transaction.snapshot, wallet.snapshot)) {
    transaction.reject('REFERENCE_MISMATCH');
    return;
  }
  if (transaction.requiresReference()) {
    if (!reference || !reference.isTerminal()) {
      transaction.markPendingReference();
      return;
    }
    const failure = validateReference(
      transaction.snapshot,
      reference.snapshot,
      input.alreadyReversed,
    );
    if (failure) {
      transaction.reject(failure);
      return;
    }
  }
  if (!transaction.affectsBalance()) {
    transaction.markProcessed(reference?.snapshot.id, at);
    return;
  }
  const direction = transaction.ledgerDirectionFor(reference);
  const { money, kind, id } = transaction.snapshot;
  if (direction === 'DEBIT' && wallet.snapshot.balance.isLessThan(money)) {
    transaction.reject(kind === 'BET' ? 'INSUFFICIENT_FUNDS' : 'REVERSAL_INSUFFICIENT_FUNDS');
    return;
  }
  const entry =
    direction === 'DEBIT'
      ? wallet.debit(money, id, input.entryId, at)
      : wallet.credit(money, id, input.entryId, at);
  transaction.markProcessed(reference?.snapshot.id, at);
  return entry;
}
function matchesWallet(transaction: WagerState, wallet: WalletState): boolean {
  return (
    transaction.walletId === wallet.id &&
    transaction.playerId === wallet.playerId &&
    transaction.money.currency === wallet.balance.currency
  );
}
function matchesReference(transaction: WagerState, reference: WagerState): boolean {
  return (
    reference.providerId === transaction.providerId &&
    reference.externalTransactionId === transaction.referenceExternalTransactionId &&
    reference.playerId === transaction.playerId &&
    reference.walletId === transaction.walletId &&
    reference.roundId === transaction.roundId &&
    reference.money.currency === transaction.money.currency
  );
}
function allowedReferenceKinds(kind: WagerKind): readonly WagerKind[] {
  switch (kind) {
    case 'ROLLBACK':
      return ['BET', 'WIN', 'REFUND'];
    default:
      return ['BET'];
  }
}
function validateReference(
  transaction: WagerState,
  reference: WagerState,
  alreadyReversed: boolean,
): FailureCode | undefined {
  if (!matchesReference(transaction, reference)) {
    return 'REFERENCE_MISMATCH';
  }
  if (reference.status !== 'PROCESSED') {
    return 'REFERENCE_REJECTED';
  }
  if (!allowedReferenceKinds(transaction.kind).includes(reference.kind)) {
    return 'INVALID_REFERENCE_KIND';
  }
  const isReversal = transaction.kind === 'REFUND' || transaction.kind === 'ROLLBACK';
  if (isReversal && !transaction.money.equals(reference.money)) {
    return 'REVERSAL_AMOUNT_MISMATCH';
  }
  if (isReversal && alreadyReversed) {
    return 'ALREADY_REVERSED';
  }
}
