import type { MoneyProps } from '../../domain/money';
import type { WagerKind, WagerStatus } from '../../domain/wager-transaction';
import type { LedgerDirection } from '../../domain/wallet-ledger-entry';

export interface WalletResponse {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}

export interface LedgerEntryResponse {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  createdAt: string;
}

export interface LedgerPageResponse {
  items: LedgerEntryResponse[];
  nextCursor: string | null;
}

export interface TransactionResponse extends Record<string, unknown> {
  id: string;
  kind: WagerKind | 'OPENING';
  status: WagerStatus;
  money: MoneyProps;
  result: Record<string, unknown>;
}

export interface ReconciliationResponse {
  walletId: string;
  storedBalance: MoneyProps;
  calculatedBalance: MoneyProps;
  difference: MoneyProps;
  consistent: boolean;
  checkedEntries: number;
}
