import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import { EmbeddingService } from './embedding.service';
import { fuseSearchResults, SearchHit } from './fuse-search-results';
import { VersionSearchService } from './version-search.service';

@Injectable()
export class SearchService {
  constructor(private readonly database: DatabaseService, private readonly embeddings: EmbeddingService,
    private readonly versionSearch?: VersionSearchService) {}

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
    const result = await this.diagnose(query, limit, undefined, true);
    const versioned = this.versionSearch ? await this.versionSearch.search(query, limit) : null;
    return {
      hits: versioned ? fuseSearchResults(result.fusionResults, versioned.hits, limit) : result.fusionResults,
      retrievalMode: result.vectorIndexedChunks || versioned?.vectorIndexedChunks ? 'hybrid' : 'lexical-only',
      vectorIndexedChunks: result.vectorIndexedChunks + (versioned?.vectorIndexedChunks ?? 0),
    };
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
        'SELECT id::int FROM knowledge_bases WHERE is_default AND active_index_version_id IS NOT NULL',
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
         WHERE d.archived_at IS NULL AND d.status = 'ready'
           AND kb.archived_at IS NULL AND kb.active_index_version_id IS NULL AND kb.is_default
           AND (CASE WHEN $2::boolean THEN kb.enabled_for_chat ELSE kb.is_default END)
           AND c.embedding IS NOT NULL AND c.embedding_model = $1`,
        [this.embeddings.model, forChat],
      );
      vectorIndexedChunks = coverage.rows[0]?.count ?? 0;
      if (vectorIndexedChunks > 0) {
        const [queryVector] = await this.embeddings.embed([query]);
        vectorResults = await this.searchVector(queryVector, this.embeddings.model, candidateLimit, forChat);
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
         WHERE d.archived_at IS NULL AND d.status = 'ready'
           AND kb.archived_at IS NULL AND kb.active_index_version_id IS NULL AND kb.is_default
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

  private async searchVector(vector: number[], model: string, limit: number, forChat: boolean): Promise<SearchHit[]> {
    const result = await this.database.query<SearchHit>(
      `SELECT c.id::int AS "chunkId", d.id::int AS "documentId",
              d.title AS "documentTitle", d.original_filename AS "originalFilename",
              c.ordinal, c.heading_path AS "headingPath", c.content,
              c.source_start_line AS "sourceStartLine", c.source_end_line AS "sourceEndLine",
              round((1 - (c.embedding <=> $1::vector))::numeric, 3)::float AS score
       FROM document_chunks c JOIN documents d ON d.id = c.document_id
       JOIN knowledge_bases kb ON kb.id = d.knowledge_base_id
       WHERE d.archived_at IS NULL AND d.status = 'ready'
         AND kb.archived_at IS NULL AND kb.active_index_version_id IS NULL AND kb.is_default
         AND (CASE WHEN $4::boolean THEN kb.enabled_for_chat ELSE kb.is_default END)
         AND c.embedding IS NOT NULL AND c.embedding_model = $2
       ORDER BY c.embedding <=> $1::vector, d.id, c.ordinal LIMIT $3`,
      [`[${vector.join(',')}]`, model, limit, forChat],
    );
    return result.rows;
  }
}
