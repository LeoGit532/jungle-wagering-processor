import 'reflect-metadata';
import { openDatabase } from './infrastructure/persistence/orm';
import { createApplication } from './bootstrap/create-app';
import { SqsGateway } from './infrastructure/messaging/sqs';
import { WorkerRuntime } from './infrastructure/workers/runtime';
async function bootstrap(): Promise<void> {
  const orm = await openDatabase();
  const broker = new SqsGateway();
  const app = await createApplication(orm, () => broker.ready());
  const workers = new WorkerRuntime(orm, broker);
  if (process.env.WORKERS_ENABLED !== 'false') {
    workers.start();
  }
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
  let stopping = false;
  const stop = async () => {
    if (stopping) {
      return;
    }
    stopping = true;
    await workers.stop();
    await app.close();
    broker.close();
    await orm.close();
  };
  // Own lifecycle so the ORM remains open until messages already in flight finish.
  process.once('SIGTERM', () => void stop());
  process.once('SIGINT', () => void stop());
}
void bootstrap().catch(() => {
  console.error(JSON.stringify({ event: 'startup_failed', code: 'INFRASTRUCTURE_UNAVAILABLE' }));
  process.exitCode = 1;
});
