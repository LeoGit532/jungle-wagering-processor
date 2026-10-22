import { openDatabase } from '../../src/infrastructure/persistence/orm';
import { WagerStore } from '../../src/infrastructure/persistence/wager-store';
import { Wagering } from '../../src/application/wagering';
import { SqsGateway } from '../../src/infrastructure/messaging/sqs';
import { WagerConsumer } from '../../src/infrastructure/workers/consumer';
async function main(): Promise<void> {
  const orm = await openDatabase();
  const app = new Wagering(new WagerStore(orm));
  process.stdout.write('READY\n');
  await new Promise<void>((resolve) => process.stdin.once('data', () => resolve()));
  try {
    if (process.env.TEST_MODE === 'crash-after-commit') {
      const broker = new SqsGateway(process.env.TEST_PREFIX);
      broker.ack = async () => {
        process.exit(86);
      };
      await new WagerConsumer(broker, app).handle(
        process.env.TEST_QUEUE!,
        JSON.parse(process.env.TEST_MESSAGE!),
      );
      broker.close();
    } else {
      const inputs = JSON.parse(process.env.TEST_INPUTS!) as {
        body: unknown;
        key: string;
      }[];
      await Promise.all(inputs.map((input) => app.submit(input.body, input.key)));
    }
  } finally {
    await orm.close();
  }
}
void main().catch(() => {
  console.error('PROCESS_WORKER_FAILED');
  process.exitCode = 1;
});
