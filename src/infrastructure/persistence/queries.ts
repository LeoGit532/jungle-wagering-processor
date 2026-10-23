import type { MikroORM } from '@mikro-orm/postgresql';
import type {
  WalletResponse,
  LedgerEntryResponse,
  LedgerPageResponse,
  TransactionResponse,
  ReconciliationResponse,
} from '../../application/ports/financial-queries';
import type { LedgerDirection } from '../../domain/wallet-ledger-entry';
import type { WagerKind, WagerStatus } from '../../domain/wager-transaction';
import { ApplicationError, requireUuid } from '../../application/contracts';
import { Money } from '../../domain/money';
import { WalletRow } from './entities';
import { metric, log } from '../telemetry';
import { decodeLedgerCursor, encodeLedgerCursor, ledgerPageLimit } from './ledger-cursor';
interface LedgerRow {
  id: string;
  wallet_id: string;
  transaction_id: string;
  direction: LedgerDirection;
  amount: string;
  currency: string;
  balance_before: string;
  balance_after: string;
  created_at: string;
}
interface TransactionRow {
  id: string;
  state: Record<string, unknown>;
  response: Record<string, unknown>;
  kind: WagerKind | 'OPENING';
  status: WagerStatus;
  amount: string;
  currency: string;
}
export class FinancialQueries {
  constructor(private readonly orm: MikroORM) {}
  async wallet(id: string): Promise<WalletResponse> {
    const walletRow = await this.orm.em.fork().findOne(WalletRow, { id: requireUuid(id) });
    if (!walletRow) {
      throw new ApplicationError('WALLET_NOT_FOUND', 404);
    }
    return {
      id: walletRow.id,
      playerId: walletRow.playerId,
      balance: { amount: walletRow.balance, currency: walletRow.currency },
      version: walletRow.version,
    };
  }
  async transaction(id: string, providerId?: string): Promise<TransactionResponse> {
    const condition = providerId ? 'provider_id=? and external_transaction_id=?' : 'id=?';
    const parameters = providerId ? [providerId, id] : [requireUuid(id)];
    const [transactionRow] = await this.orm.em.fork().execute<TransactionRow[]>(
      `select id, state, response, kind, status, amount, currency
        from wager_transactions where ${condition}`,
      parameters,
    );
    if (!transactionRow) {
      throw new ApplicationError('TRANSACTION_NOT_FOUND', 404);
    }
    return {
      ...transactionRow.state,
      id: transactionRow.id,
      kind: transactionRow.kind,
      status: transactionRow.status,
      money: {
        amount: transactionRow.amount,
        currency: transactionRow.currency,
      },
      result: transactionRow.response,
    };
  }
  async ledger(walletId: string, cursor?: string, rawLimit?: string): Promise<LedgerPageResponse> {
    requireUuid(walletId);
    await this.wallet(walletId);
    const limit = ledgerPageLimit(rawLimit);
    const anchor = decodeLedgerCursor(walletId, cursor);
    const cursorCondition = anchor ? 'and (created_at,id) > (?::timestamptz,?::uuid)' : '';
    const parameters = anchor ? [walletId, anchor.at, anchor.id, limit + 1] : [walletId, limit + 1];
    const entries = await this.orm.em.fork().execute<LedgerRow[]>(
      `select id,wallet_id,transaction_id,direction,amount,currency,balance_before,balance_after,
         to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') created_at
       from wallet_ledger where wallet_id=? ${cursorCondition}
       order by created_at,id limit ?`,
      parameters,
    );
    const page = entries.slice(0, limit);
    const lastEntry = page.at(-1);
    return {
      items: page.map(ledgerEntryResponse),
      nextCursor:
        entries.length > limit && lastEntry
          ? encodeLedgerCursor(walletId, {
              id: lastEntry.id,
              at: lastEntry.created_at,
            })
          : null,
    };
  }
  async reconcile(walletId: string): Promise<ReconciliationResponse> {
    requireUuid(walletId);
    return this.orm.em.fork().transactional(async (entityManager) => {
      const [walletRow] = await entityManager.execute<
        {
          balance: string;
          currency: string;
        }[]
      >('select balance,currency from wallets where id=? for update', [walletId]);
      if (!walletRow) {
        throw new ApplicationError('WALLET_NOT_FOUND', 404);
      }
      const [ledgerTotal] = await entityManager.execute<
        {
          balance: string;
          count: string;
        }[]
      >(
        `select coalesce(sum(case when direction='CREDIT' then amount else -amount end),0)::numeric(30,2)::text balance,
           count(*)::text count from wallet_ledger where wallet_id=?`,
        [walletId],
      );
      const storedBalance = Money.from({
        amount: walletRow.balance,
        currency: walletRow.currency,
      });
      const calculatedBalance = Money.from({
        amount: ledgerTotal!.balance,
        currency: walletRow.currency,
      });
      const difference = storedBalance.subtract(calculatedBalance);
      if (!difference.isZero()) {
        metric('wager_reconciliation_mismatches_total');
        log('reconciliation_mismatch', {
          walletId,
          code: 'LEDGER_BALANCE_MISMATCH',
        });
      }
      return {
        walletId,
        storedBalance: storedBalance.toJSON(),
        calculatedBalance: calculatedBalance.toJSON(),
        difference: difference.toJSON(),
        consistent: difference.isZero(),
        checkedEntries: Number(ledgerTotal!.count),
      };
    });
  }
}
function ledgerEntryResponse(entry: LedgerRow): LedgerEntryResponse {
  return {
    id: entry.id,
    walletId: entry.wallet_id,
    transactionId: entry.transaction_id,
    direction: entry.direction,
    money: { amount: entry.amount, currency: entry.currency },
    balanceBefore: { amount: entry.balance_before, currency: entry.currency },
    balanceAfter: { amount: entry.balance_after, currency: entry.currency },
    createdAt: entry.created_at,
  };
}
