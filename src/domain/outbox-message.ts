import { immutableCopy } from './immutable';
import { DomainError } from './errors';
export interface EventEnvelope {
  eventId: string;
  aggregateId: string;
  eventType: string;
  occurredAt: string;
}
export interface OutboxState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: string;
  attempts: number;
  nextAttemptAt?: string;
  publishedAt?: string;
}
export class OutboxMessage {
  private constructor(private state: Readonly<OutboxState>) {}
  static enqueue(event: { toJSON(): EventEnvelope }): OutboxMessage {
    const envelope = event.toJSON();
    if (!envelope.eventId || !envelope.aggregateId || !envelope.eventType)
      throw new DomainError('INVALID_OUTBOX_EVENT');
    return OutboxMessage.rehydrate({
      id: envelope.eventId,
      aggregateId: envelope.aggregateId,
      eventType: envelope.eventType,
      payload: { ...envelope },
      occurredAt: envelope.occurredAt,
      attempts: 0,
    });
  }
  static rehydrate(state: OutboxState): OutboxMessage {
    return new OutboxMessage(immutableCopy(state));
  }
  get snapshot(): Readonly<OutboxState> {
    return this.state;
  }
  isPending(): boolean {
    return this.state.publishedAt === undefined;
  }
  isDue(now: Date): boolean {
    return (
      this.isPending() &&
      (!this.state.nextAttemptAt || Date.parse(this.state.nextAttemptAt) <= now.getTime())
    );
  }
  markPublished(now: Date): void {
    this.assertPending();
    this.state = Object.freeze({ ...this.state, publishedAt: now.toISOString() });
  }
  scheduleRetry(now: Date): void {
    this.assertPending();
    const delay = Math.min(60_000, 1_000 * 2 ** Math.min(this.state.attempts, 6));
    this.state = Object.freeze({
      ...this.state,
      attempts: this.state.attempts + 1,
      nextAttemptAt: new Date(now.getTime() + delay).toISOString(),
    });
  }
  private assertPending(): void {
    if (!this.isPending()) throw new DomainError('OUTBOX_ALREADY_PUBLISHED');
  }
}
