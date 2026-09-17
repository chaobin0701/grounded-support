import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { PoolClient } from 'pg';

export const DOCUMENT_INGEST_QUEUE = 'document-ingest';

@Injectable()
export class DocumentQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly boss = new PgBoss(process.env.DATABASE_URL!);

  async onModuleInit(): Promise<void> {
    await this.boss.start();
    await this.boss.createQueue(DOCUMENT_INGEST_QUEUE);
  }

  async onModuleDestroy(): Promise<void> {
    await this.boss.stop();
  }

  async enqueue(client: PoolClient, documentId: number): Promise<void> {
    const jobId = await this.boss.send(DOCUMENT_INGEST_QUEUE, { documentId }, {
      retryLimit: 2,
      retryDelay: 5,
      retryBackoff: true,
      db: { executeSql: (sql, values) => client.query(sql, values) },
    });
    if (!jobId) throw new Error('Failed to enqueue document');
  }
}
