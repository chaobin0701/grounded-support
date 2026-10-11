import { Injectable, Optional } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import type { AgentConfiguration } from '../config/agent-config';
import { PreviousTurnDto } from './chat.dto';
import type { SearchHit } from '../documents/fuse-search-results';
import type { SkillDefinition, SkillSummary } from '../ai/skills/skill.types';
import type { AgentTranscriptMessage } from './agent-transcript';
import type { ProductDetail } from '../ai/tools/product-catalog/product-catalog.service';
import type { RequestContext } from './request-context';
import { hasToolCapability } from '../ai/tools/tool-capabilities';
import { ContextGovernor, estimateTokens, memoryLimitsForContextWindow } from './context-governor';

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
  nativeTranscript?: boolean;
  requestContext?: RequestContext;
  products?: ProductDetail[];
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
  constructor(@Optional() private readonly config?: AppConfigService, @Optional() private readonly governor?: ContextGovernor) {}

  build(input: ContextBuildInput): BuiltContext {
    const contextWindow = this.governor?.inspect({ systemPrompt: '', userPrompt: '', purpose: 'planner' }).contextWindowTokens ?? 32_000;
    const limits = memoryLimitsForContextWindow(contextWindow);
    const inputBudget = this.governor?.inspect({ systemPrompt: '', userPrompt: '', purpose: 'planner' }).inputBudgetTokens ?? Math.max(1024, contextWindow - 1200 - Math.ceil(contextWindow * 0.05));
    const question = input.question.trim().slice(0, 2000);
    const summary = input.summary.slice(0, limits.summaryMaxChars);
    const history = input.recentHistory.slice(-limits.recentTurns).map((turn) => ({
      question: turn.question.trim().slice(0, 2000),
      answer: turn.answer.trim(),
    }));
    const payload = {
      question,
      summary,
      history,
      toolResults: input.toolResults.map(result => {
        if (Array.isArray(result.evidenceRefs)) return { tool: result.tool, evidenceRefs: result.evidenceRefs };
        if (hasToolCapability(String(result.tool), 'product-detail')) {
          if (typeof result.productRef === 'string' && (input.products ?? []).some(p => p.id === result.productRef)) return { tool: result.tool, productRef: result.productRef };
          try {
            const data = typeof result.result === 'string' ? JSON.parse(result.result) : null;
            if (data?.id && (input.products ?? []).some(p => p.id === data.id)) return { tool: result.tool, productRef: data.id };
          } catch { /* Keep errors intact. */ }
        }
        return result;
      }),
      productContext: {
        productIds: input.requestContext?.productIds ?? [],
        productReferences: input.requestContext?.productReferences ?? [],
        products: input.products ?? [],
        unavailableProductIds: (input.requestContext?.productIds ?? []).filter(id => !(input.products ?? []).some(p => p.id === id)),
      },
      availableSkills: input.availableSkills ?? [],
      loadedSkills: (input.loadedSkills ?? []).map(({ id, name, version, systemInstructions }) => ({ id, name, version, instructions: systemInstructions })),
      initialEvidence: (input.initialEvidence ?? []).map((hit) => ({
        chunkId: hit.chunkId,
        title: hit.documentTitle,
        heading: hit.headingPath,
        content: hit.content.slice(0, 1800),
        score: hit.score,
      })),
      // The native transcript is already a separate set of model messages, not a second JSON copy.
      ...(input.nativeTranscript ? {} : { agentTranscript: input.transcript ?? [] }),
      transcriptVersion: 1,
    };
    // The model window is the source of truth. Keep the current question and
    // current-round evidence first, then shed older/less important material
    // before a provider can reject the request for exceeding its window.
    const compactTarget = Math.max(1024, Math.floor(inputBudget * 0.72));
    let compacted = false;
    const fits = () => estimateTokens(JSON.stringify(payload)) <= compactTarget;
    if (!fits()) {
      compacted = true;
      payload.history = payload.history.slice(-Math.max(1, Math.floor(limits.recentTurns / 2)));
      payload.summary = payload.summary.slice(0, Math.floor(limits.summaryMaxChars * 0.6));
    }
    if (!fits()) {
      compacted = true;
      payload.initialEvidence = payload.initialEvidence.slice(0, Math.max(1, Math.floor(payload.initialEvidence.length / 2)));
      payload.availableSkills = payload.availableSkills.slice(0, Math.max(1, Math.floor(payload.availableSkills.length / 2)));
      payload.loadedSkills = payload.loadedSkills.slice(0, Math.max(1, Math.floor(payload.loadedSkills.length / 2)));
    }
    if (!fits()) {
      compacted = true;
      payload.toolResults = payload.toolResults.slice(-Math.max(1, Math.floor(payload.toolResults.length / 2)));
      payload.productContext.products = payload.productContext.products.slice(0, Math.max(1, Math.floor(payload.productContext.products.length / 2)));
    }
    if (!fits()) {
      compacted = true;
      payload.initialEvidence = [];
      payload.availableSkills = [];
      payload.loadedSkills = [];
      payload.summary = '';
      payload.history = [];
    }
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
        truncated: compacted || question !== input.question.trim()
          || summary !== input.summary
          || history.length !== input.recentHistory.length,
        initialEvidenceCount: input.initialEvidence?.length ?? 0,
        transcriptCount: input.transcript?.length ?? 0,
        transcriptVersion: 1,
      },
    };
  }
}
