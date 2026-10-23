import { openDatabase } from './orm';
async function main(): Promise<void> {
  const direction = process.argv[2] ?? 'up';
  if (!['up', 'down'].includes(direction)) {
    throw new Error('Use up or down');
  }
  const orm = await openDatabase();
  try {
    if (direction === 'down') {
      await orm.getMigrator().down();
    } else {
      await orm.getMigrator().up();
    }
  } finally {
    await orm.close();
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
