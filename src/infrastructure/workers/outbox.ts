import type { MikroORM } from "@mikro-orm/postgresql";
import type { SqsGateway } from "../messaging/sqs";
import { gauge, metric, log } from "../telemetry";
export class OutboxPublisher {
  constructor(
    private readonly orm: MikroORM,
    private readonly broker: Pick<SqsGateway, "publish">,
  ) {}
  async tick(): Promise<boolean> {
    return this.orm.em.fork().transactional(async (entityManager) => {
      const [outboxMessage] = await entityManager.execute<
        {
          id: string;
          payload: Record<string, unknown>;
          attempts: number;
          occurred_at: Date;
        }[]
      >(
        "select id,payload,attempts,occurred_at from outbox_messages where published_at is null and (next_attempt_at is null or next_attempt_at<=now()) order by occurred_at,id limit 1 for update skip locked",
      );
      if (!outboxMessage) {
        return false;
      }
      gauge(
        "wager_outbox_lag_seconds",
        Math.max(
          0,
          (Date.now() - new Date(outboxMessage.occurred_at).getTime()) / 1000,
        ),
      );
      try {
        await this.broker.publish(outboxMessage.payload);
      } catch {
        metric("wager_retries_total");
        await entityManager.execute(
          "update outbox_messages set attempts=attempts+1,next_attempt_at=? where id=?",
          [
            new Date(
              Date.now() +
                Math.min(
                  60000,
                  1000 * 2 ** Math.min(outboxMessage.attempts, 6),
                ),
            ),
            outboxMessage.id,
          ],
        );
        log("outbox_retry", { code: "BROKER_UNAVAILABLE" });
        return false;
      }
      await entityManager.execute(
        "update outbox_messages set published_at=now() where id=?",
        [outboxMessage.id],
      );
      metric("wager_outbox_published_total");
      return true;
    });
  }
}
