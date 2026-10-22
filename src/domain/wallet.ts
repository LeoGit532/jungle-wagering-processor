import { DomainError, Money } from "./money";
import { WalletLedgerEntry, type LedgerDirection } from "./wallet-ledger-entry";
export {
  WalletLedgerEntry,
  type LedgerDirection,
  type LedgerState,
} from "./wallet-ledger-entry";
export interface WalletState {
  readonly id: string;
  readonly playerId: string;
  readonly balance: Money;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export class Wallet {
  private constructor(private state: WalletState) {}
  static open(props: {
    id: string;
    playerId: string;
    initialBalance: Money;
    at: string;
  }): Wallet {
    if (props.initialBalance.isNegative()) {
      throw new DomainError("NEGATIVE_BALANCE");
    }
    return Wallet.rehydrate({
      id: props.id,
      playerId: props.playerId,
      balance: props.initialBalance,
      version: 1,
      createdAt: props.at,
      updatedAt: props.at,
    });
  }
  static rehydrate(state: WalletState): Wallet {
    return new Wallet(Object.freeze({ ...state }));
  }
  get snapshot(): Readonly<WalletState> {
    return this.state;
  }
  debit(
    money: Money,
    transactionId: string,
    entryId: string,
    at: string,
  ): WalletLedgerEntry {
    return this.move("DEBIT", money, transactionId, entryId, at);
  }
  credit(
    money: Money,
    transactionId: string,
    entryId: string,
    at: string,
  ): WalletLedgerEntry {
    return this.move("CREDIT", money, transactionId, entryId, at);
  }
  private move(
    direction: LedgerDirection,
    money: Money,
    transactionId: string,
    entryId: string,
    at: string,
  ): WalletLedgerEntry {
    if (!money.isPositive()) {
      throw new DomainError("INVALID_MOVEMENT_AMOUNT");
    }
    const before = this.state.balance;
    const after =
      direction === "DEBIT" ? before.subtract(money) : before.add(money);
    if (after.isNegative()) {
      throw new DomainError("INSUFFICIENT_FUNDS");
    }
    const entry = WalletLedgerEntry.create({
      id: entryId,
      walletId: this.state.id,
      transactionId,
      direction,
      money,
      balanceBefore: before,
      balanceAfter: after,
      createdAt: at,
    });
    this.state = Object.freeze({
      ...this.state,
      balance: after,
      version: this.state.version + 1,
      updatedAt: at,
    });
    return entry;
  }
}
