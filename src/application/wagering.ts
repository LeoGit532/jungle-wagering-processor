import { WagerTransaction } from '../domain/wager-transaction';
import { parseWager, parseWallet, hashPayload, requireIdentifier } from './contracts';
import type {
  FinancialResponse,
  InboxContext,
  ProcessingObserver,
  ProviderIdentityPort,
  WageringPort,
} from './ports/wagering';
export type {
  FinancialResponse,
  InboxContext,
  ProviderIdentityPort,
  WageringPort,
} from './ports/wagering';
/** Replace with an external IdP adapter when authentication is enabled. */
export class DevelopmentProviderIdentity implements ProviderIdentityPort {
  async assertProvider(_providerId: string): Promise<void> {}
}
export class Wagering {
  constructor(
    private readonly store: WageringPort,
    private readonly identity: ProviderIdentityPort = new DevelopmentProviderIdentity(),
    private readonly observe: ProcessingObserver = () => {},
  ) {}
  async recordFailure(
    body: unknown,
    key: unknown,
    inbox?: InboxContext,
  ): Promise<FinancialResponse> {
    if (!this.store.recordFailure) throw new Error('Failure audit adapter unavailable');
    const idempotencyKey = requireIdentifier(key);
    const data = parseWager(body);
    await this.identity.assertProvider(data.providerId);
    const transaction = WagerTransaction.create({
      ...data,
      id: crypto.randomUUID(),
      idempotencyKey,
      payloadHash: hashPayload({ ...data, money: data.money.toJSON() }),
      createdAt: new Date().toISOString(),
    });
    return this.store.recordFailure(transaction, inbox);
  }
  async openWallet(body: unknown) {
    const { playerId, initialBalance } = parseWallet(body);
    const wallet = await this.store.openWallet(playerId, initialBalance);
    const { id, balance, version } = wallet.snapshot;
    return { id, playerId, balance: balance.toJSON(), version };
  }
  async submit(body: unknown, key: unknown, inbox?: InboxContext): Promise<FinancialResponse> {
    const idempotencyKey = requireIdentifier(key);
    const data = parseWager(body);
    await this.identity.assertProvider(data.providerId);
    const hash = hashPayload({ ...data, money: data.money.toJSON() });
    const startedAt = performance.now();
    try {
      const transaction = WagerTransaction.create({
        ...data,
        id: crypto.randomUUID(),
        idempotencyKey,
        payloadHash: hash,
        createdAt: new Date().toISOString(),
      });
      const response = await this.store.submit(transaction, inbox);
      this.observe({
        response,
        milliseconds: performance.now() - startedAt,
        walletId: data.walletId,
        providerId: data.providerId,
      });
      return response;
    } catch (error) {
      this.observe({
        error,
        milliseconds: performance.now() - startedAt,
        walletId: data.walletId,
        providerId: data.providerId,
      });
      throw error;
    }
  }
}
