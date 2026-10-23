import type { Money, MoneyProps } from '../../domain/money';
import type { Wallet } from '../../domain/wallet';
import type { FailureCode, WagerStatus, WagerTransaction } from '../../domain/wager-transaction';
export interface InboxContext {
  consumerName: string;
  messageId: string;
  payloadHash: string;
}
export interface FinancialResponse {
  transactionId: string;
  status: WagerStatus;
  balance: MoneyProps;
  failureCode?: FailureCode;
  idempotentReplay: boolean;
}
export interface WageringPort {
  recordFailure?(transaction: WagerTransaction, inbox?: InboxContext): Promise<FinancialResponse>;
  openWallet(playerId: string, money: Money): Promise<Wallet>;
  submit(transaction: WagerTransaction, inbox?: InboxContext): Promise<FinancialResponse>;
}
export interface ProviderIdentityPort {
  assertProvider(providerId: string): Promise<void>;
}
export interface ProcessingObservation {
  response?: FinancialResponse;
  error?: unknown;
  milliseconds: number;
  walletId: string;
  providerId: string;
}
export type ProcessingObserver = (observation: ProcessingObservation) => void;
