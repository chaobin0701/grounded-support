import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import { AppConfigService } from '../config/config.service';
import { knowledgeConfigSchema } from './knowledge-config';
import { embedWithProfile, embeddingProfileSchema } from './profile-embedding';
import { searchTokens } from './build-chunks';
import { fuseSearchResults, SearchHit } from './fuse-search-results';

@Injectable()
export class VersionSearchService {
  constructor(private readonly database: DatabaseService, private readonly runtime: AppConfigService) {}

  async search(rawQuery: unknown, limit: number, knowledgeBaseId?: number, versionId?: number) {
    if (typeof rawQuery !== 'string' || Array.from(rawQuery.trim()).length < 2 || Array.from(rawQuery.trim()).length > 200 ||
      !Number.isInteger(limit) || limit < 1 || limit > 20 ||
      (versionId !== undefined && (!knowledgeBaseId || !Number.isSafeInteger(versionId) || versionId < 1))) throw new BadRequestException('Invalid search query or limit');
    const query = rawQuery.trim();
    // Fix the active version set once for this request, even if publication happens during embedding.
    const versions = (await this.database.query(`SELECT v.id::int, v.config, v.embedding_snapshot
      FROM knowledge_bases kb JOIN knowledge_index_versions v ON v.knowledge_base_id=kb.id
        AND v.id=COALESCE($2::bigint,kb.active_index_version_id)
      WHERE kb.archived_at IS NULL AND v.status='ready'
      AND CASE WHEN $1::bigint IS NULL THEN kb.enabled_for_chat ELSE kb.id=$1 END`, [knowledgeBaseId ?? null,versionId ?? null])).rows;
    const lexical: SearchHit[] = [];
    const vector: SearchHit[] = [];
    const started = performance.now();
    let embeddingCalls = 0;
    let vectorIndexedChunks = 0;
    for (const version of versions) {
      const config = knowledgeConfigSchema.parse(version.config);
      // Parent evidence (not the narrower child) is returned and cited; duplicate parents collapse below.
      const base = `SELECT COALESCE(p.id,c.id)::int AS "chunkId",d.id::int AS "documentId",
        c.document_title AS "documentTitle",c.original_filename AS "originalFilename",
        COALESCE(p.ordinal,c.ordinal) AS ordinal,COALESCE(p.heading_path,c.heading_path) AS "headingPath",
        COALESCE(p.content,c.content) AS content,
        (COALESCE(p.source_locator,c.source_locator)->>'start')::int AS "sourceStartLine",
        (COALESCE(p.source_locator,c.source_locator)->>'end')::int AS "sourceEndLine"`;
      const joins = `FROM index_chunks c JOIN documents d ON d.id=c.document_id
        JOIN knowledge_bases kb ON kb.id=d.knowledge_base_id LEFT JOIN index_chunks p ON p.id=c.parent_chunk_id`;
      const where = `c.version_id=$1 AND c.kind <> 'parent' AND d.archived_at IS NULL
        AND kb.archived_at IS NULL AND ($5::boolean OR kb.enabled_for_chat)`;
      if (config.retrievalMode !== 'vector') {
        lexical.push(...(await this.database.query<SearchHit>(`WITH scored AS (${base},
          c.search_vector @@ plainto_tsquery('simple',$2) AS "ftsMatch",
          ts_rank_cd(c.search_vector,plainto_tsquery('simple',$2),32) AS "ftsScore",
          word_similarity($3,c.search_content) AS "trigramScore",
          GREATEST(ts_rank_cd(c.search_vector,plainto_tsquery('simple',$2),32),
            word_similarity($3,c.search_content), CASE WHEN position(lower($3) in lower(c.search_content))>0 THEN 1 ELSE 0 END) AS score
          ${joins} WHERE ${where}) SELECT * FROM scored WHERE score >= $4 OR "ftsMatch" ORDER BY score DESC,"chunkId" LIMIT $6`,
        [version.id, searchTokens(query), query, config.lexicalThreshold, knowledgeBaseId !== undefined, limit * 4])).rows);
      }
      if (config.indexMode === 'high_quality' && config.retrievalMode !== 'fulltext') {
        const profile = embeddingProfileSchema.parse(version.embedding_snapshot);
        const [queryVector] = await embedWithProfile(profile, [query], this.runtime);
        embeddingCalls++;
        const coverage = await this.database.query<{ count: number }>('SELECT count(*)::int AS count FROM chunk_embeddings e JOIN index_chunks c ON c.id=e.chunk_id WHERE c.version_id=$1', [version.id]);
        vectorIndexedChunks += coverage.rows[0].count;
        vector.push(...(await this.database.query<SearchHit>(`WITH scored AS (${base},
          1-(e.embedding <=> $2::vector) AS score ${joins} JOIN chunk_embeddings e ON e.chunk_id=c.id
          WHERE ${where} AND e.dimensions=$3)
          SELECT * FROM scored WHERE score >= $4 ORDER BY score DESC,"chunkId" LIMIT $6`,
        [version.id, `[${queryVector.join(',')}]`, profile.dimensions, config.vectorThreshold, knowledgeBaseId !== undefined, limit * 4])).rows);
      }
    }
    const unique = (hits: SearchHit[]) => [...new Map(hits.sort((a,b) => a.score-b.score).map((hit) => [hit.chunkId,hit])).values()].sort((a,b) => b.score-a.score);
    const lexicalResults = unique(lexical);
    const vectorResults = unique(vector);
    return { hits: fuseSearchResults(lexicalResults, vectorResults, limit), lexicalResults, vectorResults,
      versionIds: versions.map((v) => v.id), embeddingCalls, vectorIndexedChunks,
      durationMs: Math.round(performance.now()-started), retrievalMode: vectorIndexedChunks ? 'hybrid' as const : 'lexical-only' as const };
  }
}
