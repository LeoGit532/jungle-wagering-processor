import { openDatabase } from '../../src/infrastructure/persistence/orm';
import { WagerStore } from '../../src/infrastructure/persistence/wager-store';
import { Wagering } from '../../src/application/wagering';
import { SqsGateway } from '../../src/infrastructure/messaging/sqs';
import { WorkerRuntime } from '../../src/infrastructure/workers/runtime';
import { OutboxPublisher } from '../../src/infrastructure/workers/outbox';
async function main(): Promise<void> {
  const orm = await openDatabase();
  const broker = new SqsGateway(process.env.TEST_PREFIX);
  const store = new WagerStore(orm);
  if (process.env.TEST_MODE === 'graceful') {
    const submit = WagerStore.prototype.submit;
    WagerStore.prototype.submit = async function (transaction, inbox) {
      process.stdout.write('IN_FLIGHT\n');
      await Bun.sleep(800);
      return submit.call(this, transaction, inbox);
    };
    const runtime = new WorkerRuntime(orm, broker);
    let stopping = false;
    process.once('SIGTERM', () => {
      if (stopping) return;
      stopping = true;
      void runtime.stop().then(async () => {
        broker.close();
        await orm.close();
        process.stdout.write('STOPPED\n');
      });
    });
    process.stdout.write('READY\n');
    await new Promise<void>((resolve) => process.stdin.once('data', () => resolve()));
    runtime.start();
    return;
  }
  process.stdout.write('READY\n');
  await new Promise<void>((resolve) => process.stdin.once('data', () => resolve()));
  if (process.env.TEST_MODE === 'commit-before-publish') {
    const body = JSON.parse(process.env.TEST_BODY!);
    await new Wagering(store).submit(body, body.externalTransactionId);
    process.exit(87);
  }
  if (process.env.TEST_MODE === 'publish-before-mark') {
    await new OutboxPublisher(orm, {
      publish: async (envelope) => {
        const { events } = await broker.queues();
        await broker.send(events, envelope, String(envelope.aggregateId), crypto.randomUUID());
        process.exit(88);
      },
    }).tick();
  }
  broker.close();
  await orm.close();
}
void main().catch(() => {
  process.stderr.write('RESILIENCE_WORKER_FAILED\n');
  process.exitCode = 1;
});
