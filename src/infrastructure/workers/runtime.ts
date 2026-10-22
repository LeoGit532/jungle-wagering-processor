import type { MikroORM } from "@mikro-orm/postgresql";
import { instrumentedWagering } from "../instrumented-wagering";
import { WagerStore } from "../persistence/wager-store";
import { SqsGateway } from "../messaging/sqs";
import { OutboxPublisher } from "./outbox";
import { WagerConsumer } from "./consumer";
import { log } from "../telemetry";
export class WorkerRuntime {
  private stopping = false;
  private tasks: Promise<void>[] = [];
  constructor(
    private readonly orm: MikroORM,
    private readonly broker: SqsGateway,
  ) {}
  start(): void {
    const store = new WagerStore(this.orm);
    const consumer = new WagerConsumer(
      this.broker,
      instrumentedWagering(store),
    );
    const publisher = new OutboxPublisher(this.orm, this.broker);
    this.tasks = [
      this.loop(() => this.consumeMessages(consumer), 50),
      this.loop(async () => {
        await publisher.tick();
      }, 250),
      this.loop(async () => {
        await store.retryDueReferences();
      }, 1000),
    ];
  }
  private async consumeMessages(consumer: WagerConsumer): Promise<void> {
    const { requests } = await this.broker.queues();
    const messages = await this.broker.receive(requests);
    for (const message of messages) {
      if (this.stopping) {
        await this.broker.visibility(requests, message, 0);
      } else {
        await consumer.handle(requests, message);
      }
    }
  }

  private async loop(
    tick: () => Promise<unknown>,
    delay: number,
  ): Promise<void> {
    while (!this.stopping) {
      try {
        await tick();
      } catch {
        log("worker_retry", { code: "INFRASTRUCTURE_UNAVAILABLE" });
      }
      if (!this.stopping) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  async stop(): Promise<void> {
    this.stopping = true;
    await Promise.allSettled(this.tasks);
  }
}
