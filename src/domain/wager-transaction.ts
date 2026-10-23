import { DomainError, Money } from './money';
import type { LedgerDirection } from './wallet';
export type WagerKind = 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK';
export type WagerStatus = 'PENDING' | 'PENDING_REFERENCE' | 'PROCESSED' | 'REJECTED' | 'FAILED';
export type FailureCode =
  | 'BALANCE_LIMIT_EXCEEDED'
  | 'INSUFFICIENT_FUNDS'
  | 'REVERSAL_INSUFFICIENT_FUNDS'
  | 'REFERENCE_NOT_FOUND'
  | 'REFERENCE_REJECTED'
  | 'REFERENCE_MISMATCH'
  | 'INVALID_REFERENCE_KIND'
  | 'REVERSAL_AMOUNT_MISMATCH'
  | 'ALREADY_REVERSED'
  | 'INFRASTRUCTURE_FAILURE';
export interface WagerState {
  readonly id: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerKind;
  readonly money: Money;
  readonly createdAt: string;
  readonly referenceExternalTransactionId?: string;
  readonly status: WagerStatus;
  readonly referenceTransactionId?: string;
  readonly failureCode?: FailureCode;
  readonly processedAt?: string;
}
export class WagerTransaction {
  private constructor(private state: Readonly<WagerState>) {}
  static create(
    props: Omit<WagerState, 'status' | 'referenceTransactionId' | 'failureCode' | 'processedAt'>,
  ): WagerTransaction {
    if (!['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'].includes(props.kind)) {
      throw new DomainError('INVALID_KIND');
    }
    for (const field of [
      'id',
      'providerId',
      'externalTransactionId',
      'idempotencyKey',
      'payloadHash',
      'walletId',
      'playerId',
      'roundId',
      'gameId',
    ] as const) {
      if (typeof props[field] !== 'string' || !props[field].trim()) {
        throw new DomainError('INVALID_IDENTITY');
      }
    }
    if (
      (props.kind === 'REFUND' || props.kind === 'ROLLBACK') &&
      !props.referenceExternalTransactionId?.trim()
    ) {
      throw new DomainError('REFERENCE_REQUIRED');
    }
    if (props.referenceExternalTransactionId === props.externalTransactionId) {
      throw new DomainError('SELF_REFERENCE');
    }
    if (props.kind !== 'LOSS' && !props.money.isPositive()) {
      throw new DomainError('INVALID_MOVEMENT_AMOUNT');
    }
    if (props.money.isNegative() || (props.kind === 'LOSS' && !props.money.isZero())) {
      throw new DomainError('INVALID_LOSS_AMOUNT');
    }
    return WagerTransaction.rehydrate({ ...props, status: 'PENDING' });
  }
  static rehydrate(state: WagerState): WagerTransaction {
    return new WagerTransaction(Object.freeze({ ...state }));
  }
  get snapshot(): Readonly<WagerState> {
    return this.state;
  }
  isTerminal(): boolean {
    return ['PROCESSED', 'REJECTED', 'FAILED'].includes(this.state.status);
  }
  affectsBalance(): boolean {
    return this.state.kind !== 'LOSS';
  }
  requiresReference(): boolean {
    return !!this.state.referenceExternalTransactionId;
  }
  matchesPayload(hash: string): boolean {
    return this.state.payloadHash === hash;
  }
  markPendingReference(): void {
    this.assertMutable();
    this.state = Object.freeze({ ...this.state, status: 'PENDING_REFERENCE' });
  }
  markProcessed(referenceTransactionId: string | undefined, at: string): void {
    this.assertMutable();
    this.state = Object.freeze({
      ...this.state,
      status: 'PROCESSED',
      referenceTransactionId,
      processedAt: at,
    });
  }
  reject(code: FailureCode): void {
    this.assertMutable();
    this.state = Object.freeze({
      ...this.state,
      status: 'REJECTED',
      failureCode: code,
    });
  }
  fail(code: FailureCode): void {
    this.assertMutable();
    this.state = Object.freeze({
      ...this.state,
      status: 'FAILED',
      failureCode: code,
    });
  }
  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    if (this.state.kind === 'LOSS') {
      throw new DomainError('NO_BALANCE_EFFECT');
    }
    if (this.state.kind === 'BET') {
      return 'DEBIT';
    }
    if (this.state.kind !== 'ROLLBACK') {
      return 'CREDIT';
    }
    if (!reference) {
      throw new DomainError('REFERENCE_REQUIRED');
    }
    return reference.snapshot.kind === 'BET' ? 'CREDIT' : 'DEBIT';
  }
  private assertMutable(): void {
    if (this.isTerminal()) {
      throw new DomainError('INVALID_TRANSACTION_STATE');
    }
  }
}
