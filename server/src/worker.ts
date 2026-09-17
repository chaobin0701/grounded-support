import 'reflect-metadata';
import { PgBoss } from 'pg-boss';

async function bootstrap(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const boss = new PgBoss(connectionString);
  boss.on('error', (error) => console.error('Worker queue error:', error));
  await boss.start();
  await boss.createQueue('document-ingest');
  console.log('Worker ready; document processing will be added in a later milestone.');

  const shutdown = async (): Promise<void> => {
    await boss.stop();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

void bootstrap();
