import { openDatabase } from './infrastructure/persistence/orm';
import { SqsGateway } from './infrastructure/messaging/sqs';
import { WorkerRuntime } from './infrastructure/workers/runtime';
async function main(): Promise<void> {
  const orm = await openDatabase();
  const broker = new SqsGateway();
  const runtime = new WorkerRuntime(orm, broker);
  runtime.start();
  let stopping = false;
  const stop = async () => {
    if (stopping) {
      return;
    }
    stopping = true;
    await runtime.stop();
    broker.close();
    await orm.close();
  };
  process.once('SIGTERM', () => void stop());
  process.once('SIGINT', () => void stop());
}
void main().catch(() => {
  console.error(
    JSON.stringify({ event: 'worker_startup_failed', code: 'INFRASTRUCTURE_UNAVAILABLE' }),
  );
  process.exitCode = 1;
});
