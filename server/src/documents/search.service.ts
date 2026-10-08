import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import { EmbeddingService } from './embedding.service';
import { fuseSearchResults, SearchHit } from './fuse-search-results';
import { VersionSearchService } from './version-search.service';
import { knowledgeConfigSchema } from './knowledge-config';
import { AppConfigService } from '../config/config.service';
import { embeddingFingerprint, embeddingProfileSchema } from './profile-embedding';
import { embedForProfile } from './embedding-runtime';

@Injectable()
export class SearchService {
  constructor(private readonly database: DatabaseService, private readonly embeddings: EmbeddingService,
    private readonly versionSearch?: VersionSearchService, private readonly runtime?: AppConfigService) {}

  /**
   * Agent-facing search boundary. The diagnostic endpoint keeps detailed
   * lexical/vector fields for administrators, while tools only need the
   * retrieved evidence and a small amount of retrieval metadata.
   */
  async searchForAgent(query: string, limit = 5): Promise<{
    hits: SearchHit[];
    retrievalMode: 'hybrid' | 'lexical-only';
    vectorIndexedChunks: number;
  }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 8) {
      throw new BadRequestException('topK must be an integer between 1 and 8');
    }
    const bases = (await this.database.query<{ id: number; draft_config: unknown }>(
      `SELECT id::int,draft_config FROM knowledge_bases WHERE archived_at IS NULL AND enabled_for_chat
        AND active_index_version_id IS NULL ORDER BY id`,
    )).rows;
    const lexical: SearchHit[] = [];
    const vector: SearchHit[] = [];
    let vectorIndexedChunks = 0;
    for (const base of bases) {
      const configuredLimit = Math.min(limit, knowledgeConfigSchema.parse(base.draft_config).topK);
      const result = await this.recallTest(base.id, query, configuredLimit);
      lexical.push(...(result.lexicalResults ?? []));
      vector.push(...(result.vectorResults ?? []));
      vectorIndexedChunks += result.vectorIndexedChunks;
    }
    const liveHits = fuseSearchResults(lexical, vector, limit);
    const versioned = this.versionSearch ? await this.versionSearch.search(query, limit) : null;
    return {
      hits: versioned ? fuseSearchResults(liveHits, versioned.hits, limit) : liveHits,
      retrievalMode: vectorIndexedChunks || versioned?.vectorIndexedChunks ? 'hybrid' : 'lexical-only',
      vectorIndexedChunks: vectorIndexedChunks + (versioned?.vectorIndexedChunks ?? 0),
    };
  }

  async recallTest(knowledgeBaseId: number, rawQuery: unknown, limit: number, rawMode?: unknown) {
    if (typeof rawQuery !== 'string') throw new BadRequestException('query must be a search query');
    const query = rawQuery.trim();
    if (Array.from(query).length < 2 || Array.from(query).length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new BadRequestException('query must contain 2 to 200 characters and topK must be between 1 and 20');
    }
    if (rawMode !== undefined && !['fulltext', 'vector', 'hybrid'].includes(String(rawMode))) {
      throw new BadRequestException('retrievalMode must be fulltext, vector, or hybrid');
    }
    const base = (await this.database.query<{ draft_config: unknown }>(
      'SELECT draft_config FROM knowledge_bases WHERE id=$1 AND archived_at IS NULL', [knowledgeBaseId],
    )).rows[0];
    if (!base) throw new BadRequestException('Knowledge base not found');
    const config = knowledgeConfigSchema.parse(base.draft_config);
    const mode = rawMode === undefined ? config.retrievalMode : String(rawMode) as 'fulltext' | 'vector' | 'hybrid';
    let profile: ReturnType<typeof embeddingProfileSchema.parse> | undefined;
    if (config.indexMode === 'high_quality') {
      const row = (await this.database.query<{ config: unknown }>(
        'SELECT config FROM embedding_profiles WHERE id=$1 AND enabled', [config.embeddingProfileId],
      )).rows[0];
      if (!row) throw new BadRequestException('The selected embedding profile is unavailable');
      profile = embeddingProfileSchema.parse(row.config);
    }
    const fingerprint = profile ? embeddingFingerprint(profile) : this.embeddings.fingerprint;
    const dimensions = profile?.dimensions ?? 2048;
    const embeddingEnabled = profile !== undefined || this.embeddings.enabled;
    const started = performance.now();
    const candidateLimit = Math.max(limit * 4, 20);
    const lexicalResults = mode === 'vector' ? [] : (await this.database.query<SearchHit>(
      `WITH ranked AS (
         SELECT c.id::int AS "chunkId",d.id::int AS "documentId",d.title AS "documentTitle",
           d.original_filename AS "originalFilename",c.ordinal,c.heading_path AS "headingPath",c.content,
           c.source_start_line AS "sourceStartLine",c.source_end_line AS "sourceEndLine",
           GREATEST(word_similarity($1::text,c.content),word_similarity($1::text,c.heading_path),
             word_similarity($1::text,d.title),CASE WHEN position(lower($1::text) in lower(c.content))>0 THEN 1.0 ELSE 0.0 END) AS raw_score
         FROM document_chunks c JOIN documents d ON d.id=c.document_id
         WHERE d.knowledge_base_id=$2 AND d.archived_at IS NULL AND d.enabled_for_retrieval AND d.status='ready' AND d.source_type='file'
       ) SELECT "chunkId","documentId","documentTitle","originalFilename",ordinal,"headingPath",content,
           "sourceStartLine","sourceEndLine",round(raw_score::numeric,3)::float AS score
         FROM ranked WHERE raw_score >= $3 ORDER BY raw_score DESC,"documentId",ordinal LIMIT $4`,
      [query, knowledgeBaseId, config.lexicalThreshold, candidateLimit],
    )).rows;
    let vectorResults: SearchHit[] = [];
    let vectorIndexedChunks = 0;
    let embeddingCalls = 0;
    if (mode !== 'fulltext' && embeddingEnabled) {
      const coverage = await this.database.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM document_chunks c JOIN documents d ON d.id=c.document_id
         WHERE d.knowledge_base_id=$1 AND d.archived_at IS NULL AND d.enabled_for_retrieval AND d.status='ready' AND d.source_type='file'
           AND c.embedding IS NOT NULL AND c.embedding_fingerprint=$2 AND vector_dims(c.embedding)=$3`, [knowledgeBaseId, fingerprint, dimensions],
      );
      vectorIndexedChunks = coverage.rows[0]?.count ?? 0;
      if (vectorIndexedChunks) {
        let queryVector: number[];
        if (profile) {
          const runtime = this.runtime;
          if (!runtime) throw new BadRequestException('Embedding runtime configuration is unavailable');
          [queryVector] = await embedForProfile(this.database, runtime, profile, [query]);
        } else {
          [queryVector] = await this.embeddings.embed([query]);
        }
        embeddingCalls = 1;
        vectorResults = (await this.database.query<SearchHit>(
          `WITH compatible AS MATERIALIZED (
             SELECT c.* FROM document_chunks c JOIN documents d ON d.id=c.document_id
             WHERE d.knowledge_base_id=$2 AND d.archived_at IS NULL AND d.enabled_for_retrieval AND d.status='ready' AND d.source_type='file'
               AND c.embedding IS NOT NULL AND c.embedding_fingerprint=$3 AND vector_dims(c.embedding)=$5
           ) SELECT c.id::int AS "chunkId",d.id::int AS "documentId",d.title AS "documentTitle",
             d.original_filename AS "originalFilename",c.ordinal,c.heading_path AS "headingPath",c.content,
             c.source_start_line AS "sourceStartLine",c.source_end_line AS "sourceEndLine",
             round((1-(c.embedding <=> $1::vector))::numeric,3)::float AS score
           FROM compatible c JOIN documents d ON d.id=c.document_id
           ORDER BY c.embedding <=> $1::vector,d.id,c.ordinal LIMIT $4`,
          [`[${queryVector.join(',')}]`, knowledgeBaseId, fingerprint, candidateLimit, dimensions],
        )).rows.filter((hit) => hit.score >= config.vectorThreshold);
      }
    }
    const hits = mode === 'fulltext' ? lexicalResults.slice(0, limit)
      : mode === 'vector' ? vectorResults.slice(0, limit)
        : fuseSearchResults(lexicalResults, vectorResults, limit);
    const lexicalIds = new Set(lexicalResults.map((hit) => hit.chunkId));
    const vectorIds = new Set(vectorResults.map((hit) => hit.chunkId));
    return { query, retrievalMode: mode, hits: hits.map((hit) => ({ ...hit,
      matchType: lexicalIds.has(hit.chunkId) && vectorIds.has(hit.chunkId) ? '全文 + 向量'
        : vectorIds.has(hit.chunkId) ? '向量' : '全文',
    })), lexicalResults: lexicalResults.slice(0, limit), vectorResults: vectorResults.slice(0, limit),
      vectorIndexedChunks, embeddingCalls, durationMs: Math.round(performance.now() - started) };
  }

  async diagnose(rawQuery: unknown, limit: number, rawMinScore: unknown, forChat = false) {
    if (typeof rawQuery !== 'string') throw new BadRequestException('q must be a search query');
    const query = rawQuery.trim();
    if (Array.from(query).length < 2 || Array.from(query).length > 200) {
      throw new BadRequestException('q must contain 2 to 200 characters');
    }
    const minScore = rawMinScore === undefined ? 0.15 : Number(rawMinScore);
    if (typeof rawMinScore === 'object' || !Number.isFinite(minScore) || minScore < 0 || minScore > 1) {
      throw new BadRequestException('minScore must be between 0 and 1');
    }

    // Keep the original admin diagnostic route useful after default-base publication.
    if (!forChat && this.versionSearch) {
      const base = (await this.database.query<{ id: number }>(
        'SELECT id::int FROM knowledge_bases WHERE is_default AND archived_at IS NULL AND active_index_version_id IS NOT NULL',
      )).rows[0];
      if (base) {
        const result = await this.versionSearch.search(query, limit, base.id);
        return { query, minScore, embeddingModel: null, vectorIndexedChunks: result.vectorIndexedChunks,
          retrievalMode: result.retrievalMode, lexicalResults: result.lexicalResults,
          vectorResults: result.vectorResults, fusionResults: result.hits, results: result.hits };
      }
    }

    const candidateLimit = Math.max(limit * 4, 20);
    const lexicalResults = await this.searchLexical(query, minScore, candidateLimit, forChat);
    let vectorResults: SearchHit[] = [];
    let vectorIndexedChunks = 0;
    if (this.embeddings.enabled) {
      const coverage = await this.database.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM document_chunks c
         JOIN documents d ON d.id = c.document_id
         JOIN knowledge_bases kb ON kb.id = d.knowledge_base_id
         WHERE d.archived_at IS NULL AND d.enabled_for_retrieval AND d.status = 'ready'
           AND kb.archived_at IS NULL AND kb.active_index_version_id IS NULL
           AND (CASE WHEN $2::boolean THEN kb.enabled_for_chat ELSE kb.is_default END)
           AND c.embedding IS NOT NULL AND c.embedding_fingerprint = $1 AND vector_dims(c.embedding)=2048`,
        [this.embeddings.fingerprint, forChat],
      );
      vectorIndexedChunks = coverage.rows[0]?.count ?? 0;
      if (vectorIndexedChunks > 0) {
        const [queryVector] = await this.embeddings.embed([query]);
        vectorResults = await this.searchVector(queryVector, this.embeddings.fingerprint, candidateLimit, forChat);
      }
    }
    const fusionResults = fuseSearchResults(lexicalResults, vectorResults, limit);
    return {
      query,
      minScore,
      embeddingModel: this.embeddings.enabled ? this.embeddings.model : null,
      vectorIndexedChunks,
      retrievalMode: vectorIndexedChunks > 0 ? 'hybrid' : 'lexical-only',
      lexicalResults: lexicalResults.slice(0, limit),
      vectorResults: vectorResults.slice(0, limit),
      fusionResults,
      results: fusionResults,
    };
  }

  private async searchLexical(query: string, minScore: number, limit: number, forChat: boolean): Promise<SearchHit[]> {
    const result = await this.database.query<SearchHit>(
      `WITH ranked AS (
         SELECT c.id::int AS "chunkId", d.id::int AS "documentId",
                d.title AS "documentTitle", d.original_filename AS "originalFilename",
                c.ordinal, c.heading_path AS "headingPath", c.content,
                c.source_start_line AS "sourceStartLine", c.source_end_line AS "sourceEndLine",
                GREATEST(
                  word_similarity($1::text, c.content),
                  word_similarity($1::text, c.heading_path),
                  word_similarity($1::text, d.title),
                  CASE WHEN position(lower($1::text) in lower(c.content)) > 0 THEN 1.0 ELSE 0.0 END
                ) AS raw_score
         FROM document_chunks c JOIN documents d ON d.id = c.document_id
         JOIN knowledge_bases kb ON kb.id = d.knowledge_base_id
         WHERE d.archived_at IS NULL AND d.enabled_for_retrieval AND d.status = 'ready'
           AND kb.archived_at IS NULL AND kb.active_index_version_id IS NULL
           AND (CASE WHEN $4::boolean THEN kb.enabled_for_chat ELSE kb.is_default END)
       )
       SELECT "chunkId", "documentId", "documentTitle", "originalFilename", ordinal,
              "headingPath", content, "sourceStartLine", "sourceEndLine",
              round(raw_score::numeric, 3)::float AS score
       FROM ranked WHERE raw_score >= $2
       ORDER BY raw_score DESC, "documentId", ordinal LIMIT $3`,
      [query, minScore, limit, forChat],
    );
    return result.rows;
  }

  private async searchVector(vector: number[], fingerprint: string, limit: number, forChat: boolean): Promise<SearchHit[]> {
    const result = await this.database.query<SearchHit>(
      `WITH compatible AS MATERIALIZED (
         SELECT c.* FROM document_chunks c JOIN documents d ON d.id=c.document_id
         JOIN knowledge_bases kb ON kb.id=d.knowledge_base_id
         WHERE d.archived_at IS NULL AND d.enabled_for_retrieval AND d.status='ready'
           AND kb.archived_at IS NULL AND kb.active_index_version_id IS NULL
           AND (CASE WHEN $4::boolean THEN kb.enabled_for_chat ELSE kb.is_default END)
           AND c.embedding IS NOT NULL AND c.embedding_fingerprint=$2 AND vector_dims(c.embedding)=$5
       ) SELECT c.id::int AS "chunkId", d.id::int AS "documentId",
              d.title AS "documentTitle", d.original_filename AS "originalFilename",
              c.ordinal, c.heading_path AS "headingPath", c.content,
              c.source_start_line AS "sourceStartLine", c.source_end_line AS "sourceEndLine",
              round((1 - (c.embedding <=> $1::vector))::numeric, 3)::float AS score
       FROM compatible c JOIN documents d ON d.id = c.document_id
       ORDER BY c.embedding <=> $1::vector, d.id, c.ordinal LIMIT $3`,
      [`[${vector.join(',')}]`, fingerprint, limit, forChat, vector.length],
    );
    return result.rows;
  }
}
