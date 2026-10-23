import { DomainError, Money } from './money';
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
/**
 * Fluxo: validar contexto -> resolver referência -> decidir movimento -> concluir.
 * Altera os objetos de domínio recebidos e devolve um lançamento, quando houver.
 * undefined também pode significar rejeição, espera por referência ou LOSS:
 * consulte transaction.snapshot.status para distinguir esses resultados.
 *
 * Este método não grava no banco. O chamador deve carregar os dados, inclusive
 * alreadyReversed, sob o lock da carteira e persistir tudo na mesma transação SQL.
 */
export function applyWager(input: ApplyWagerInput): WalletLedgerEntry | undefined {
  const { transaction, wallet, reference, at } = input;
  // Replay deve ser resolvido pela idempotência antes de chegar aqui.
  // Uma operação terminal nunca pode aplicar seus efeitos novamente.
  if (transaction.isTerminal()) {
    throw new DomainError('INVALID_TRANSACTION_STATE');
  }
  // Evita movimentar carteira, jogador ou moeda diferentes dos solicitados.
  if (!matchesWallet(transaction.snapshot, wallet.snapshot)) {
    transaction.reject('REFERENCE_MISMATCH');
    return;
  }
  if (transaction.requiresReference()) {
    // Mensagens podem chegar fora de ordem. Aguarda sem mexer no saldo;
    // o worker de referências retomará a operação, com tentativas/TTL limitados.
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
  // LOSS registra o resultado da rodada sem débito/crédito, ledger ou nova versão.
  if (!transaction.affectsBalance()) {
    transaction.markProcessed(reference?.snapshot.id, at);
    return;
  }
  // BET debita; WIN/REFUND creditam. ROLLBACK faz o movimento inverso
  // ao da referência: desfazer um WIN, por exemplo, exige um débito.
  const direction = transaction.ledgerDirectionFor(reference);
  const { money, kind, id } = transaction.snapshot;
  // Rejeições esperadas ficam registradas na transação, sem lançar exceção.
  // O código distingue falta de saldo na aposta de falta de saldo na reversão.
  if (direction === 'DEBIT' && wallet.snapshot.balance.isLessThan(money)) {
    transaction.reject(kind === 'BET' ? 'INSUFFICIENT_FUNDS' : 'REVERSAL_INSUFFICIENT_FUNDS');
    return;
  }
  if (
    direction === 'CREDIT' &&
    Money.maximum(money.currency).isLessThan(wallet.snapshot.balance.add(money))
  ) {
    transaction.reject('BALANCE_LIMIT_EXCEEDED');
    return;
  }
  // Todas as regras passaram: gera exatamente um movimento e conclui a operação.
  // Se a persistência falhar depois, a transação SQL deve desfazer o conjunto.
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
// O ID externo sozinho não basta: a referência precisa pertencer ao mesmo
// provedor, jogador, carteira, rodada e moeda.
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
// Primeiro confere vínculo/status/tipo; em reversões exige valor integral
// e ausência de reversão processada do mesmo tipo. A constraint SQL também
// protege essa unicidade entre instâncias concorrentes.
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
