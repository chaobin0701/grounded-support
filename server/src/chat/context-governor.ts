import { Injectable, Optional } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';

export type ContextPurpose = 'planner' | 'answer' | 'summary';
export type ContextPressure = 'normal' | 'elevated' | 'high' | 'overflow';

export type ContextBudget = {
  contextWindowTokens: number;
  inputBudgetTokens: number;
  maxOutputTokens: number;
  safetyBufferTokens: number;
  estimatedInputTokens: number;
  rawMessageCount: number;
  includedMessageCount: number;
  measurementSource: 'heuristic';
  pressure: ContextPressure;
  compacted: false;
  summaryCheckpointId: null;
  summarizedThroughSequence: null;
};

export type ContextGovernorInput = {
  systemPrompt: string;
  userPrompt: string;
  purpose: ContextPurpose;
  rawMessageCount?: number;
  includedMessageCount?: number;
};

const DEFAULT_CONTEXT_WINDOW_TOKENS = 32_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 1_200;

@Injectable()
export class ContextGovernor {
  constructor(@Optional() private readonly config?: AppConfigService) {}

  inspect(input: ContextGovernorInput): ContextBudget {
    const contextWindowTokens = this.config?.llm.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
    const maxOutputTokens = input.purpose === 'summary'
      ? 800
      : this.config?.llm.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    const safetyBufferTokens = Math.max(1_024, Math.ceil(contextWindowTokens * 0.05));
    const inputBudgetTokens = Math.max(0, contextWindowTokens - maxOutputTokens - safetyBufferTokens);
    const estimatedInputTokens = estimateTokens(`${input.systemPrompt}\n${input.userPrompt}`);
    const ratio = inputBudgetTokens > 0 ? estimatedInputTokens / inputBudgetTokens : 1;
    const pressure: ContextPressure = ratio < 0.7
      ? 'normal'
      : ratio < 0.85
        ? 'elevated'
        : ratio <= 1
          ? 'high'
          : 'overflow';
    return {
      contextWindowTokens,
      inputBudgetTokens,
      maxOutputTokens,
      safetyBufferTokens,
      estimatedInputTokens,
      rawMessageCount: input.rawMessageCount ?? 2,
      includedMessageCount: input.includedMessageCount ?? 2,
      measurementSource: 'heuristic',
      pressure,
      compacted: false,
      summaryCheckpointId: null,
      summarizedThroughSequence: null,
    };
  }
}

/** Conservative, dependency-free estimate until a provider tokenizer is available. */
export function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 2));
}
