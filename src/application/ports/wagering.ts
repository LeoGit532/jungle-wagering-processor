import type { Money, MoneyProps } from "../../domain/money";
import type { Wallet } from "../../domain/wallet";
import type { WagerTransaction } from "../../domain/wager-transaction";
export interface InboxContext {
  consumerName: string;
  messageId: string;
  payloadHash: string;
}
export interface FinancialResponse {
  transactionId: string;
  status: string;
  balance: MoneyProps;
  failureCode?: string;
  idempotentReplay: boolean;
}
export interface WageringPort {
  openWallet(playerId: string, money: Money): Promise<Wallet>;
  submit(
    transaction: WagerTransaction,
    inbox?: InboxContext,
  ): Promise<FinancialResponse>;
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
