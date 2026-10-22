import type { LedgerState } from "./wallet";
import type { WagerState } from "./wager-transaction";
interface EventProps<T> {
  eventId: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: string;
  data: T;
}
export abstract class IntegrationEvent<T> {
  abstract readonly eventType: string;
  readonly version = 1;
  protected constructor(protected readonly props: EventProps<T>) {}
  toJSON() {
    return { ...this.props, eventType: this.eventType, version: this.version };
  }
}
export class WalletBalanceChanged extends IntegrationEvent<
  Record<string, unknown>
> {
  readonly eventType = "WalletBalanceChanged";
  static from(entry: LedgerState, version: number, correlationId: string) {
    return new WalletBalanceChanged({
      eventId: crypto.randomUUID(),
      aggregateId: entry.walletId,
      correlationId,
      occurredAt: entry.createdAt,
      data: {
        walletId: entry.walletId,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        walletVersion: version,
      },
    });
  }
}
abstract class WagerEvent extends IntegrationEvent<Record<string, unknown>> {
  protected static props(
    state: WagerState,
    correlationId: string,
  ): EventProps<Record<string, unknown>> {
    return {
      eventId: crypto.randomUUID(),
      aggregateId: state.walletId,
      correlationId,
      occurredAt: new Date().toISOString(),
      data: {
        transactionId: state.id,
        status: state.status,
        failureCode: state.failureCode,
      },
    };
  }
}
export class WagerTransactionProcessed extends WagerEvent {
  readonly eventType = "WagerTransactionProcessed";
  static from(state: WagerState, correlationId: string) {
    return new WagerTransactionProcessed(this.props(state, correlationId));
  }
}
export class WagerTransactionRejected extends WagerEvent {
  readonly eventType = "WagerTransactionRejected";
  static from(state: WagerState, correlationId: string) {
    return new WagerTransactionRejected(this.props(state, correlationId));
  }
}
export class WagerTransactionPendingReference extends WagerEvent {
  readonly eventType = "WagerTransactionPendingReference";
  static from(state: WagerState, correlationId: string) {
    return new WagerTransactionPendingReference(
      this.props(state, correlationId),
    );
  }
}
