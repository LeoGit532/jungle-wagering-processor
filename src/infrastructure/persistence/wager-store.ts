import { InboxMessage } from '../../domain/inbox-message';
import { OutboxMessage } from '../../domain/outbox-message';
import { LockMode } from '@mikro-orm/core';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type {
  FinancialResponse,
  InboxContext,
  WageringPort,
} from '../../application/ports/wagering';
import { DomainError, Money, type MoneyProps } from '../../domain/money';
import { Wallet, WalletLedgerEntry } from '../../domain/wallet';
import { WagerTransaction, type WagerState } from '../../domain/wager-transaction';
import { applyWager } from '../../domain/apply-wager';
import {
  WalletBalanceChanged,
  WagerTransactionProcessed,
  WagerTransactionFailed,
  WagerTransactionRejected,
  WagerTransactionPendingReference,
} from '../../domain/events';
import { WalletRow } from './entities';
import { context, metric, log } from '../telemetry';
interface StoredWagerState extends Omit<WagerState, 'money'> {
  money: MoneyProps;
}
interface StoredTransaction {
  id: string;
  payload_hash: string;
  state: StoredWagerState;
  response: FinancialResponse;
}
interface PendingReferenceRow {
  state: StoredWagerState;
  reference_attempts: number;
  next_reference_at: Date;
  created_at: Date;
  database_now: Date;
}
interface ApplyOptions {
  expireMissingReference?: boolean;
  publishPendingEvent?: boolean;
}
interface StoredEvent {
  toJSON(): {
    eventId: string;
    aggregateId: string;
    eventType: string;
    occurredAt: string;
  };
}
const MAX_REFERENCE_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_REFERENCE_BACKOFF_MS = 60 * 60 * 1000;
export class WagerStore implements WageringPort {
  constructor(private readonly orm: MikroORM) {}
  async openWallet(playerId: string, initialBalance: Money): Promise<Wallet> {
    const createdAt = new Date().toISOString();
    const wallet = Wallet.open({
      id: crypto.randomUUID(),
      playerId,
      initialBalance,
      at: createdAt,
    });
    await this.withTransaction(async (entityManager) => {
      const walletRow = this.createWalletRow(entityManager, wallet);
      entityManager.persist(walletRow);
      await entityManager.flush();
      if (initialBalance.isPositive()) {
        await this.recordOpening(entityManager, wallet, createdAt);
      }
    });
    return wallet;
  }
  async submit(input: WagerTransaction, inbox?: InboxContext): Promise<FinancialResponse> {
    return this.persistSubmission(input, inbox);
  }
  async recordFailure(input: WagerTransaction, inbox?: InboxContext): Promise<FinancialResponse> {
    return this.persistSubmission(input, inbox, 'INFRASTRUCTURE_FAILURE');
  }
  private async persistSubmission(
    input: WagerTransaction,
    inbox?: InboxContext,
    failureCode?: 'INFRASTRUCTURE_FAILURE',
  ): Promise<FinancialResponse> {
    const transaction = WagerTransaction.rehydrate(input.snapshot);
    if (transaction.snapshot.status !== 'PENDING') {
      throw new DomainError('NEW_TRANSACTION_REQUIRED');
    }
    return this.withTransaction(async (entityManager) => {
      const walletRow = await this.lockWallet(entityManager, transaction.snapshot.walletId);
      if (!walletRow) {
        throw new DomainError('WALLET_NOT_FOUND');
      }
      if (inbox) {
        await this.receiveInbox(entityManager, inbox);
      }
      const isNew = await this.insertTransaction(entityManager, transaction);
      let response: FinancialResponse;
      if (!isNew) {
        response = await this.replayTransaction(entityManager, transaction);
      } else if (failureCode) {
        transaction.fail(failureCode);
        response = this.financialResponse(transaction, this.rehydrateWallet(walletRow));
        await this.saveOutcome(entityManager, transaction, response);
        await this.enqueueOutcomeEvent(entityManager, transaction);
      } else {
        response = await this.applyTransaction(entityManager, transaction, walletRow);
      }
      if (inbox) {
        await this.completeInbox(entityManager, inbox);
      }
      return response;
    });
  }
  async retryReference(id: string, requestedNow?: Date, maxAttempts = 10): Promise<boolean> {
    const [transactionRow] = await this.orm.em.fork().execute<
      {
        wallet_id: string;
      }[]
    >('select wallet_id from wager_transactions where id=?', [id]);
    if (!transactionRow) {
      return false;
    }
    return this.withTransaction(async (entityManager) => {
      const walletRow = await this.lockWallet(entityManager, transactionRow.wallet_id);
      if (!walletRow) {
        return false;
      }
      const pending = await this.findPendingReference(entityManager, id);
      if (!pending) {
        return false;
      }
      const now = requestedNow ?? new Date(pending.database_now);
      if (
        pending.state.status !== 'PENDING_REFERENCE' ||
        new Date(pending.next_reference_at) > now
      ) {
        return false;
      }
      const transaction = this.rehydrateTransaction(pending.state);
      const attempts = pending.reference_attempts + 1;
      const referenceAge = now.getTime() - new Date(pending.created_at).getTime();
      await this.scheduleReferenceRetry(entityManager, id, attempts, now);
      await this.applyTransaction(entityManager, transaction, walletRow, {
        expireMissingReference: attempts >= maxAttempts || referenceAge >= MAX_REFERENCE_AGE_MS,
        publishPendingEvent: false,
      });
      metric('wager_reference_retries_total');
      log('reference_retry', {
        transactionId: id,
        walletId: walletRow.id,
        status: transaction.snapshot.status,
      });
      return true;
    });
  }
  async retryDueReferences(limit = 20): Promise<number> {
    const pending = await this.orm.em.fork().execute<
      {
        id: string;
      }[]
    >(
      `select id from wager_transactions
       where status='PENDING_REFERENCE' and next_reference_at<=now()
       order by next_reference_at,id limit ?`,
      [limit],
    );
    let processedCount = 0;
    for (const transaction of pending) {
      if (await this.retryReference(transaction.id)) {
        processedCount++;
      }
    }
    return processedCount;
  }
  private withTransaction<T>(operation: (entityManager: EntityManager) => Promise<T>): Promise<T> {
    return this.orm.em
      .fork()
      .transactional(async (entityManager) => {
        await entityManager.execute("SET LOCAL lock_timeout='5s'");
        await entityManager.execute("SET LOCAL statement_timeout='15s'");
        return operation(entityManager);
      })
      .catch((error: unknown) => {
        const code = (error as { code?: string }).code;
        if (code && ['40001', '40P01', '55P03'].includes(code)) {
          metric('wager_lock_conflicts_total');
        }
        throw error;
      });
  }
  private lockWallet(entityManager: EntityManager, walletId: string): Promise<WalletRow | null> {
    return entityManager.findOne(
      WalletRow,
      { id: walletId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
  }
  private createWalletRow(entityManager: EntityManager, wallet: Wallet): WalletRow {
    const { id, playerId, balance, version, createdAt, updatedAt } = wallet.snapshot;
    return entityManager.create(WalletRow, {
      id,
      playerId,
      currency: balance.currency,
      balance: balance.toString(),
      version,
      createdAt: new Date(createdAt),
      updatedAt: new Date(updatedAt),
    });
  }
  private rehydrateWallet(walletRow: WalletRow): Wallet {
    return Wallet.rehydrate({
      id: walletRow.id,
      playerId: walletRow.playerId,
      balance: Money.from({
        amount: walletRow.balance,
        currency: walletRow.currency,
      }),
      version: walletRow.version,
      createdAt: walletRow.createdAt.toISOString(),
      updatedAt: walletRow.updatedAt.toISOString(),
    });
  }
  private rehydrateTransaction(state: StoredWagerState): WagerTransaction {
    return WagerTransaction.rehydrate({
      ...state,
      money: Money.from(state.money),
    });
  }
  private serializeTransaction(transaction: WagerTransaction): string {
    return JSON.stringify({
      ...transaction.snapshot,
      money: transaction.snapshot.money.toJSON(),
    });
  }
  private async recordOpening(
    entityManager: EntityManager,
    wallet: Wallet,
    createdAt: string,
  ): Promise<void> {
    const { id: walletId, balance } = wallet.snapshot;
    const transactionId = crypto.randomUUID();
    await entityManager.execute(
      `insert into wager_transactions
       (id,provider_id,external_transaction_id,idempotency_key,payload_hash,wallet_id,kind,status,amount,currency,state)
       values (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        transactionId,
        '__internal__',
        transactionId,
        'opening:' + transactionId,
        'internal',
        walletId,
        'OPENING',
        'PROCESSED',
        balance.toString(),
        balance.currency,
        JSON.stringify({ id: transactionId, kind: 'OPENING', walletId }),
      ],
    );
    const entry = WalletLedgerEntry.create({
      id: crypto.randomUUID(),
      walletId,
      transactionId,
      direction: 'CREDIT',
      money: balance,
      balanceBefore: Money.zero(balance.currency),
      balanceAfter: balance,
      createdAt,
    });
    await this.appendLedger(entityManager, entry);
    await this.enqueueEvent(
      entityManager,
      WalletBalanceChanged.from(entry.state, 1, transactionId),
    );
  }
  private async receiveInbox(entityManager: EntityManager, inbox: InboxContext): Promise<void> {
    const message = InboxMessage.receive({ ...inbox, receivedAt: new Date().toISOString() });
    await entityManager.execute(
      'insert into inbox_messages(consumer_name,message_id,payload_hash,received_at) values (?,?,?,?) on conflict do nothing',
      [inbox.consumerName, inbox.messageId, inbox.payloadHash, message.snapshot.receivedAt],
    );
    const saved = await this.readInbox(entityManager, inbox);
    if (!saved.matchesPayload(inbox.payloadHash)) {
      throw new DomainError('INBOX_PAYLOAD_CONFLICT');
    }
  }

  private async readInbox(
    entityManager: EntityManager,
    inbox: InboxContext,
  ): Promise<InboxMessage> {
    const [row] = await entityManager.execute<
      { payload_hash: string; received_at: Date; processed_at: Date | null }[]
    >(
      'select payload_hash,received_at,processed_at from inbox_messages where consumer_name=? and message_id=? for update',
      [inbox.consumerName, inbox.messageId],
    );
    if (!row) {
      throw new DomainError('INBOX_NOT_FOUND');
    }
    return InboxMessage.rehydrate({
      ...inbox,
      payloadHash: row.payload_hash,
      receivedAt: new Date(row.received_at).toISOString(),
      processedAt: row.processed_at ? new Date(row.processed_at).toISOString() : undefined,
    });
  }

  private async completeInbox(entityManager: EntityManager, inbox: InboxContext): Promise<void> {
    const message = await this.readInbox(entityManager, inbox);
    if (message.isProcessed()) {
      return;
    }
    message.markProcessed(new Date().toISOString());
    await entityManager.execute(
      'update inbox_messages set processed_at=? where consumer_name=? and message_id=?',
      [message.snapshot.processedAt, inbox.consumerName, inbox.messageId],
    );
  }

  private async insertTransaction(
    entityManager: EntityManager,
    transaction: WagerTransaction,
  ): Promise<boolean> {
    const state = transaction.snapshot;
    const inserted = await entityManager.execute<
      {
        id: string;
      }[]
    >(
      `insert into wager_transactions
       (id,provider_id,external_transaction_id,idempotency_key,payload_hash,wallet_id,kind,status,amount,currency,state)
       values (?,?,?,?,?,?,?,?,?,?,?) on conflict do nothing returning id`,
      [
        state.id,
        state.providerId,
        state.externalTransactionId,
        state.idempotencyKey,
        state.payloadHash,
        state.walletId,
        state.kind,
        'PENDING',
        state.money.toString(),
        state.money.currency,
        this.serializeTransaction(transaction),
      ],
    );
    return inserted.length > 0;
  }
  private async replayTransaction(
    entityManager: EntityManager,
    transaction: WagerTransaction,
  ): Promise<FinancialResponse> {
    const state = transaction.snapshot;
    const matches = await entityManager.execute<StoredTransaction[]>(
      `select id,payload_hash,state,response from wager_transactions
       where idempotency_key=? or (provider_id=? and external_transaction_id=?)`,
      [state.idempotencyKey, state.providerId, state.externalTransactionId],
    );
    const saved = matches[0];
    if (
      matches.length !== 1 ||
      !saved ||
      saved.state.idempotencyKey !== state.idempotencyKey ||
      saved.payload_hash !== state.payloadHash
    ) {
      throw new DomainError('IDEMPOTENCY_CONFLICT');
    }
    return { ...saved.response, idempotentReplay: true };
  }
  private async applyTransaction(
    entityManager: EntityManager,
    transaction: WagerTransaction,
    walletRow: WalletRow,
    options: ApplyOptions = {},
  ): Promise<FinancialResponse> {
    const wallet = this.rehydrateWallet(walletRow);
    const reference = await this.findReference(entityManager, transaction);
    const alreadyReversed = await this.hasProcessedReversal(entityManager, transaction, reference);
    const entry = applyWager({
      transaction,
      wallet,
      reference,
      alreadyReversed,
      entryId: crypto.randomUUID(),
      at: new Date().toISOString(),
    });
    if (transaction.snapshot.status === 'PENDING_REFERENCE' && options.expireMissingReference) {
      transaction.reject('REFERENCE_NOT_FOUND');
    }
    if (entry) {
      await this.persistMovement(entityManager, wallet, walletRow, entry, transaction.snapshot.id);
    }
    const response = this.financialResponse(transaction, wallet);
    await this.saveOutcome(entityManager, transaction, response);
    if (
      transaction.snapshot.status !== 'PENDING_REFERENCE' ||
      options.publishPendingEvent !== false
    ) {
      await this.enqueueOutcomeEvent(entityManager, transaction);
    }
    return response;
  }
  private async findReference(
    entityManager: EntityManager,
    transaction: WagerTransaction,
  ): Promise<WagerTransaction | undefined> {
    const { providerId, referenceExternalTransactionId } = transaction.snapshot;
    if (!referenceExternalTransactionId) {
      return;
    }
    const [reference] = await entityManager.execute<
      {
        state: StoredWagerState;
      }[]
    >('select state from wager_transactions where provider_id=? and external_transaction_id=?', [
      providerId,
      referenceExternalTransactionId,
    ]);
    if (reference && (reference.state.kind as string) !== 'OPENING') {
      return this.rehydrateTransaction(reference.state);
    }
  }
  private async hasProcessedReversal(
    entityManager: EntityManager,
    transaction: WagerTransaction,
    reference?: WagerTransaction,
  ): Promise<boolean> {
    if (!reference) {
      return false;
    }
    const reversals = await entityManager.execute<
      {
        id: string;
      }[]
    >(
      `select id from wager_transactions
       where reference_transaction_id=? and kind=? and status='PROCESSED'`,
      [reference.snapshot.id, transaction.snapshot.kind],
    );
    return reversals.length > 0;
  }
  private async persistMovement(
    entityManager: EntityManager,
    wallet: Wallet,
    walletRow: WalletRow,
    entry: WalletLedgerEntry,
    transactionId: string,
  ): Promise<void> {
    walletRow.balance = wallet.snapshot.balance.toString();
    walletRow.version = wallet.snapshot.version;
    walletRow.updatedAt = new Date(wallet.snapshot.updatedAt);
    await entityManager.flush();
    await this.appendLedger(entityManager, entry);
    const correlationId = context.getStore()?.correlationId ?? transactionId;
    await this.enqueueEvent(
      entityManager,
      WalletBalanceChanged.from(entry.state, walletRow.version, correlationId),
    );
  }
  private financialResponse(transaction: WagerTransaction, wallet: Wallet): FinancialResponse {
    return {
      transactionId: transaction.snapshot.id,
      status: transaction.snapshot.status,
      balance: wallet.snapshot.balance.toJSON(),
      failureCode: transaction.snapshot.failureCode,
      idempotentReplay: false,
    };
  }
  private async saveOutcome(
    entityManager: EntityManager,
    transaction: WagerTransaction,
    response: FinancialResponse,
  ): Promise<void> {
    await entityManager.execute(
      'update wager_transactions set status=?,reference_transaction_id=?,state=?,response=? where id=?',
      [
        transaction.snapshot.status,
        transaction.snapshot.referenceTransactionId ?? null,
        this.serializeTransaction(transaction),
        JSON.stringify(response),
        transaction.snapshot.id,
      ],
    );
  }
  private async enqueueOutcomeEvent(
    entityManager: EntityManager,
    transaction: WagerTransaction,
  ): Promise<void> {
    const state = transaction.snapshot;
    switch (state.status) {
      case 'PROCESSED':
        await this.enqueueEvent(
          entityManager,
          WagerTransactionProcessed.from(state, context.getStore()?.correlationId ?? state.id),
        );
        break;
      case 'FAILED':
        await this.enqueueEvent(
          entityManager,
          WagerTransactionFailed.from(state, context.getStore()?.correlationId ?? state.id),
        );
        break;
      case 'REJECTED':
        await this.enqueueEvent(
          entityManager,
          WagerTransactionRejected.from(state, context.getStore()?.correlationId ?? state.id),
        );
        break;
      default:
        await this.enqueueEvent(
          entityManager,
          WagerTransactionPendingReference.from(
            state,
            context.getStore()?.correlationId ?? state.id,
          ),
        );
    }
  }
  private async appendLedger(
    entityManager: EntityManager,
    entry: WalletLedgerEntry,
  ): Promise<void> {
    const state = entry.state;
    await entityManager.execute(
      `insert into wallet_ledger
       (id,wallet_id,transaction_id,direction,amount,currency,balance_before,balance_after,created_at)
       values (?,?,?,?,?,?,?,?,?)`,
      [
        state.id,
        state.walletId,
        state.transactionId,
        state.direction,
        state.money.toString(),
        state.money.currency,
        state.balanceBefore.toString(),
        state.balanceAfter.toString(),
        state.createdAt,
      ],
    );
  }
  private async enqueueEvent(entityManager: EntityManager, event: StoredEvent): Promise<void> {
    const message = OutboxMessage.enqueue(event);
    const state = message.snapshot;
    await entityManager.execute(
      'insert into outbox_messages(id,aggregate_id,event_type,payload,occurred_at) values (?,?,?,?,?)',
      [
        state.id,
        state.aggregateId,
        state.eventType,
        JSON.stringify(state.payload),
        state.occurredAt,
      ],
    );
  }

  private async findPendingReference(
    entityManager: EntityManager,
    id: string,
  ): Promise<PendingReferenceRow | undefined> {
    const [pending] = await entityManager.execute<PendingReferenceRow[]>(
      `select state,reference_attempts,next_reference_at,created_at,clock_timestamp() database_now
       from wager_transactions where id=? for update`,
      [id],
    );
    return pending;
  }
  private async scheduleReferenceRetry(
    entityManager: EntityManager,
    id: string,
    attempts: number,
    now: Date,
  ): Promise<void> {
    const delay = Math.min(MAX_REFERENCE_BACKOFF_MS, 1000 * 2 ** Math.min(attempts, 12));
    await entityManager.execute(
      'update wager_transactions set reference_attempts=?,next_reference_at=? where id=?',
      [attempts, new Date(now.getTime() + delay), id],
    );
  }
}
