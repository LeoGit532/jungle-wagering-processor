import type { MikroORM } from '@mikro-orm/postgresql';
import type { SqsGateway } from '../messaging/sqs';
import { OutboxMessage } from '../../domain/outbox-message';
import { gauge, metric, log } from '../telemetry';
interface OutboxRow {
  id: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  occurred_at: Date;
  next_attempt_at: Date | null;
  database_now: Date;
}
export class OutboxPublisher {
  constructor(
    private readonly orm: MikroORM,
    private readonly broker: Pick<SqsGateway, 'publish'>,
  ) {}
  async tick(): Promise<boolean> {
    await this.measureBacklog();
    return this.orm.em.fork().transactional(async (entityManager) => {
      const [row] = await entityManager.execute<OutboxRow[]>(
        `select id,aggregate_id,event_type,payload,attempts,occurred_at,next_attempt_at,clock_timestamp() database_now from outbox_messages where published_at is null and (next_attempt_at is null or next_attempt_at<=now()) order by occurred_at,id limit 1 for update skip locked`,
      );
      if (!row) return false;
      const message = OutboxMessage.rehydrate({
        id: row.id,
        aggregateId: row.aggregate_id,
        eventType: row.event_type,
        payload: row.payload,
        attempts: row.attempts,
        occurredAt: new Date(row.occurred_at).toISOString(),
        nextAttemptAt: row.next_attempt_at
          ? new Date(row.next_attempt_at).toISOString()
          : undefined,
      });
      try {
        await this.broker.publish({ ...message.snapshot.payload });
      } catch {
        message.scheduleRetry(new Date(row.database_now));
        await entityManager.execute(
          'update outbox_messages set attempts=?,next_attempt_at=? where id=?',
          [message.snapshot.attempts, message.snapshot.nextAttemptAt, row.id],
        );
        metric('wager_retries_total');
        log('outbox_retry', { code: 'BROKER_UNAVAILABLE' });
        return false;
      }
      message.markPublished(new Date());
      await entityManager.execute('update outbox_messages set published_at=? where id=?', [
        message.snapshot.publishedAt,
        row.id,
      ]);
      metric('wager_outbox_published_total');
      return true;
    });
  }
  private async measureBacklog(): Promise<void> {
    const [backlog] = await this.orm.em
      .fork()
      .execute<
        { lag: string; count: string }[]
      >('select coalesce(extract(epoch from clock_timestamp()-min(occurred_at)),0)::text lag,count(*)::text count from outbox_messages where published_at is null');
    gauge('wager_outbox_lag_seconds', Math.max(0, Number(backlog?.lag ?? 0)));
    gauge('wager_outbox_pending', Number(backlog?.count ?? 0));
  }
}
