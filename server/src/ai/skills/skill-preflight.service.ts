import { Injectable } from '@nestjs/common';
import type { SearchHit } from '../../documents/fuse-search-results';
import { SearchService } from '../../documents/search.service';
import type { SkillDefinition } from './skill.types';

export type SkillPreflightResult = {
  hits: SearchHit[];
  query: string | null;
  durationMs: number;
  retrievalMode?: 'hybrid' | 'lexical-only';
  errorCode?: string;
};

@Injectable()
export class SkillPreflightService {
  constructor(private readonly search: SearchService) {}

  async run(question: string, skill: SkillDefinition): Promise<SkillPreflightResult> {
    if (!skill.shouldPreRetrieve) return { hits: [], query: null, durationMs: 0 };
    // Retrieval queries stay concise even when the user submits a long, detailed prompt.
    const query = question.trim().slice(0, 200);
    const started = Date.now();
    try {
      const result = await this.search.searchForAgent(query, skill.preRetrievalTopK ?? 5);
      return { hits: result.hits, query, durationMs: Date.now() - started, retrievalMode: result.retrievalMode };
    } catch {
      return { hits: [], query, durationMs: Date.now() - started, errorCode: 'preflight_search_failed' };
    }
  }
}
