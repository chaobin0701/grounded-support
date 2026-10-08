import { Injectable, Optional } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import { DEFAULT_AGENT_CONFIGURATION, type AgentConfiguration } from '../config/agent-config';
import { PreviousTurnDto } from './chat.dto';
import type { SearchHit } from '../documents/fuse-search-results';
import type { SkillDefinition, SkillSummary } from '../ai/skills/skill.types';
import type { AgentTranscriptMessage } from './agent-transcript';

export interface ContextBuildInput {
  configuration?: AgentConfiguration;
  question: string;
  summary: string;
  recentHistory: PreviousTurnDto[];
  toolResults: Array<Record<string, unknown>>;
  initialEvidence?: SearchHit[];
  availableSkills?: SkillSummary[];
  loadedSkills?: SkillDefinition[];
  transcript?: AgentTranscriptMessage[];
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
    transcriptCount: number;
    transcriptVersion: number;
  };
}

@Injectable()
export class ContextBuilder {
  constructor(@Optional() private readonly config?: AppConfigService) {}

  build(input: ContextBuildInput): BuiltContext {
    const memory = (input.configuration ?? this.config?.agent ?? DEFAULT_AGENT_CONFIGURATION).memory;
    const question = input.question.trim().slice(0, 2000);
    const summary = input.summary.slice(0, memory.summaryMaxChars);
    const history = input.recentHistory.slice(-memory.recentTurns).map((turn) => ({
      question: turn.question.trim().slice(0, 2000),
      answer: turn.answer.trim().slice(0, 1200),
    }));
    const payload = {
      question,
      summary,
      history,
      toolResults: input.toolResults,
      availableSkills: input.availableSkills ?? [],
      loadedSkills: (input.loadedSkills ?? []).map(({ id, name, version, systemInstructions }) => ({ id, name, version, instructions: systemInstructions })),
      initialEvidence: (input.initialEvidence ?? []).map((hit) => ({
        chunkId: hit.chunkId,
        title: hit.documentTitle,
        heading: hit.headingPath,
        content: hit.content.slice(0, 1800),
        score: hit.score,
      })),
      agentTranscript: input.transcript ?? [],
      transcriptVersion: 1,
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
        transcriptCount: input.transcript?.length ?? 0,
        transcriptVersion: 1,
      },
    };
  }
}
