import { Injectable } from '@nestjs/common';
import { PreviousTurnDto } from './chat.dto';
import type { SearchHit } from '../documents/fuse-search-results';
import type { SkillDefinition } from '../ai/skills/skill.types';

export interface ContextBuildInput {
  question: string;
  summary: string;
  recentHistory: PreviousTurnDto[];
  toolResults: Array<Record<string, unknown>>;
  initialEvidence?: SearchHit[];
  skill?: SkillDefinition;
}

export interface BuiltContext {
  question: string;
  summary: string;
  history: PreviousTurnDto[];
  userPrompt: string;
  metadata: {
    summaryIncluded: boolean;
    historyCount: number;
    toolResultCount: number;
    truncated: boolean;
    initialEvidenceCount: number;
  };
}

@Injectable()
export class ContextBuilder {
  build(input: ContextBuildInput): BuiltContext {
    const question = input.question.trim().slice(0, 2000);
    const summary = input.summary.slice(0, 1500);
    const history = input.recentHistory.slice(-3).map((turn) => ({
      question: turn.question.trim().slice(0, 2000),
      answer: turn.answer.trim().slice(0, 1200),
    }));
    const payload = {
      question,
      summary,
      history,
      toolResults: input.toolResults,
      skill: input.skill ? { id: input.skill.id, summary: input.skill.summary ?? input.skill.description, instructions: input.skill.systemInstructions } : undefined,
      initialEvidence: (input.initialEvidence ?? []).map((hit) => ({
        chunkId: hit.chunkId,
        title: hit.documentTitle,
        heading: hit.headingPath,
        content: hit.content.slice(0, 1800),
        score: hit.score,
      })),
    };
    const userPrompt = JSON.stringify(payload);
    return {
      question,
      summary,
      history,
      userPrompt,
      metadata: {
        summaryIncluded: Boolean(summary),
        historyCount: history.length,
        toolResultCount: input.toolResults.length,
        truncated: question !== input.question.trim()
          || summary !== input.summary
          || history.length !== input.recentHistory.length,
        initialEvidenceCount: input.initialEvidence?.length ?? 0,
      },
    };
  }
}
