import { DomainError, Money } from "./money";
export type LedgerDirection = "DEBIT" | "CREDIT";
export interface LedgerState {
  readonly id: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly money: Money;
  readonly balanceBefore: Money;
  readonly balanceAfter: Money;
  readonly createdAt: string;
}
export class WalletLedgerEntry {
  private constructor(public readonly state: Readonly<LedgerState>) {
    Object.freeze(this);
  }
  static create(state: LedgerState): WalletLedgerEntry {
    if (!state.money.isPositive()) {
      throw new DomainError("INVALID_LEDGER_AMOUNT");
    }
    if (state.balanceBefore.isNegative() || state.balanceAfter.isNegative()) {
      throw new DomainError("NEGATIVE_BALANCE");
    }
    const entry = WalletLedgerEntry.rehydrate(state);
    if (!entry.isBalanced()) {
      throw new DomainError("UNBALANCED_LEDGER");
    }
    return entry;
  }
  static rehydrate(state: LedgerState): WalletLedgerEntry {
    return new WalletLedgerEntry(Object.freeze({ ...state }));
  }
  isBalanced(): boolean {
    const expected =
      this.state.direction === "DEBIT"
        ? this.state.balanceBefore.subtract(this.state.money)
        : this.state.balanceBefore.add(this.state.money);
    return expected.equals(this.state.balanceAfter);
  }
}
