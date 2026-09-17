import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import { EmbeddingService } from './embedding.service';
import { fuseSearchResults, SearchHit } from './fuse-search-results';

@Injectable()
export class SearchService {
  constructor(private readonly database: DatabaseService, private readonly embeddings: EmbeddingService) {}

  async diagnose(rawQuery: unknown, limit: number, rawMinScore: unknown) {
    if (typeof rawQuery !== 'string') throw new BadRequestException('q must be a search query');
    const query = rawQuery.trim();
    if (Array.from(query).length < 2 || Array.from(query).length > 200) {
      throw new BadRequestException('q must contain 2 to 200 characters');
    }
    const minScore = rawMinScore === undefined ? 0.15 : Number(rawMinScore);
    if (typeof rawMinScore === 'object' || !Number.isFinite(minScore) || minScore < 0 || minScore > 1) {
      throw new BadRequestException('minScore must be between 0 and 1');
    }

    const candidateLimit = Math.max(limit * 4, 20);
    const lexicalResults = await this.searchLexical(query, minScore, candidateLimit);
    let vectorResults: SearchHit[] = [];
    let vectorIndexedChunks = 0;
    if (this.embeddings.enabled) {
      const coverage = await this.database.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM document_chunks c
         JOIN documents d ON d.id = c.document_id
         WHERE d.archived_at IS NULL AND d.status = 'ready'
           AND c.embedding IS NOT NULL AND c.embedding_model = $1`,
        [this.embeddings.model],
      );
      vectorIndexedChunks = coverage.rows[0]?.count ?? 0;
      if (vectorIndexedChunks > 0) {
        const [queryVector] = await this.embeddings.embed([query]);
        vectorResults = await this.searchVector(queryVector, this.embeddings.model, candidateLimit);
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

  private async searchLexical(query: string, minScore: number, limit: number): Promise<SearchHit[]> {
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
         WHERE d.archived_at IS NULL AND d.status = 'ready'
       )
       SELECT "chunkId", "documentId", "documentTitle", "originalFilename", ordinal,
              "headingPath", content, "sourceStartLine", "sourceEndLine",
              round(raw_score::numeric, 3)::float AS score
       FROM ranked WHERE raw_score >= $2
       ORDER BY raw_score DESC, "documentId", ordinal LIMIT $3`,
      [query, minScore, limit],
    );
    return result.rows;
  }

  private async searchVector(vector: number[], model: string, limit: number): Promise<SearchHit[]> {
    const result = await this.database.query<SearchHit>(
      `SELECT c.id::int AS "chunkId", d.id::int AS "documentId",
              d.title AS "documentTitle", d.original_filename AS "originalFilename",
              c.ordinal, c.heading_path AS "headingPath", c.content,
              c.source_start_line AS "sourceStartLine", c.source_end_line AS "sourceEndLine",
              round((1 - (c.embedding <=> $1::vector))::numeric, 3)::float AS score
       FROM document_chunks c JOIN documents d ON d.id = c.document_id
       WHERE d.archived_at IS NULL AND d.status = 'ready'
         AND c.embedding IS NOT NULL AND c.embedding_model = $2
       ORDER BY c.embedding <=> $1::vector, d.id, c.ordinal LIMIT $3`,
      [`[${vector.join(',')}]`, model, limit],
    );
    return result.rows;
  }
}
