import { closePool, testConnection } from './db.js';

async function main(): Promise<void> {
  const ok = await testConnection();
  await closePool();

  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  console.error('Database connectivity test crashed:', err);
  await closePool();
  process.exit(1);
});
