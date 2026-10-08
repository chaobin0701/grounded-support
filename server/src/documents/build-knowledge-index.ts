import { Pool } from 'pg';
import { AppConfigService } from '../config/config.service';
import { buildChunks, searchTokens } from './build-chunks';
import { knowledgeConfigSchema } from './knowledge-config';
import { indexInputSchema } from './knowledge-index.service';
import { embeddingProfileSchema } from './profile-embedding';
import { embedForProfile } from './embedding-runtime';

export async function buildKnowledgeIndex(pool: Pool, versionId: number, runtime: AppConfigService): Promise<void> {
  if (!Number.isSafeInteger(versionId) || versionId < 1) throw new Error('Invalid version ID');
  const client = await pool.connect();
  // Transaction-scoped advisory lock serializes retries. A crashed worker releases it.
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(73191, $1::int)', [versionId]);
    const row = (await client.query('SELECT * FROM knowledge_index_versions WHERE id=$1 FOR UPDATE', [versionId])).rows[0];
    if (!row || row.status !== 'building') { await client.query('COMMIT'); return; }
    const config = knowledgeConfigSchema.parse(row.config);
    const inputs = indexInputSchema.parse(row.input_snapshot);
    const profile = config.indexMode === 'high_quality' ? embeddingProfileSchema.parse(row.embedding_snapshot) : null;
    await client.query('DELETE FROM index_chunks WHERE version_id=$1', [versionId]);
    let count = 0;
    for (const input of inputs) {
      const chunks = buildChunks(input.blocks, config);
      const searchable = chunks.filter((chunk) => chunk.kind !== 'parent');
      const vectors = profile ? await embedForProfile(client, runtime, profile, searchable.map((chunk) => chunk.kind === 'faq' ? chunk.headingPath : `${chunk.headingPath}\n${chunk.content}`)) : [];
      const parents = new Map<number, number>();
      let vectorIndex = 0;
      for (const chunk of chunks) {
        const searchContent = chunk.kind === 'faq' ? chunk.headingPath : `${chunk.headingPath}\n${chunk.content}`;
        const inserted = (await client.query(`INSERT INTO index_chunks
          (version_id,document_id,ordinal,kind,parent_chunk_id,heading_path,content,search_content,search_vector,source_locator,document_title,original_filename)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,to_tsvector('simple',$9),$10,$11,$12) RETURNING id::int`,
        [versionId, input.documentId, chunk.ordinal, chunk.kind,
          chunk.parentOrdinal === null ? null : parents.get(chunk.parentOrdinal), chunk.headingPath,
          chunk.content, searchContent, searchTokens(searchContent), JSON.stringify(chunk.sourceLocator),input.documentTitle,input.originalFilename])).rows[0];
        if (chunk.kind === 'parent') parents.set(chunk.ordinal, inserted.id);
        else if (profile) {
          await client.query('INSERT INTO chunk_embeddings(chunk_id,embedding,dimensions) VALUES ($1,$2::vector,$3)',
            [inserted.id, `[${vectors[vectorIndex++].join(',')}]`, profile.dimensions]);
        }
        count++;
      }
    }
    await client.query("UPDATE knowledge_index_versions SET status='ready',chunk_count=$2,error_message=NULL,finished_at=now() WHERE id=$1", [versionId, count]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    // Do not persist SDK payloads, credentials or input content in errors.
    await client.query("UPDATE knowledge_index_versions SET status='failed',error_message='Index build failed; check worker configuration and retry',finished_at=now() WHERE id=$1 AND status <> 'ready'", [versionId]);
    throw new Error('Knowledge index build failed', { cause: error });
  } finally { client.release(); }
}
