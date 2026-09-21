import { Injectable } from '@nestjs/common';
import { ContextBuilder } from '../../chat/context-builder';
import type { AgentCallbacks, AgentInput } from './agent-input';
import type { AgentResult } from './agent-result';
import type { AgentState } from './agent-state';
import { REFUSAL } from './agent-answer';
import { AgentLoop } from './agent-loop';
import { customerSupportSkill } from '../skills/built-in/customer-support.skill';
import type { SkillDefinition } from '../skills/skill.types';

@Injectable()
export class AgentRunner {
  constructor(
    private readonly loop: AgentLoop,
    private readonly contextBuilder: ContextBuilder,
  ) {}

  async run(input: AgentInput, callbacks: AgentCallbacks = {}): Promise<AgentResult> {
    const initialContext = this.contextBuilder.build({
      question: input.question,
      summary: input.summary,
      recentHistory: input.recentHistory,
      toolResults: [],
    });
    const skill = input.skill ?? customerSupportSkill;
    const state = this.createState(initialContext, skill);
    callbacks.onContext?.(state.contextSnapshot);

    for (let round = 0; round < skill.maxToolCalls; round += 1) {
      const step = await this.loop.step(input, state);
      if (step.type === 'complete') return this.toResult(state, step.result);
    }

    return this.toResult(state, { answer: REFUSAL, refused: true, citations: [] });
  }

  private createState(initialContext: ReturnType<ContextBuilder['build']>, skill: SkillDefinition): AgentState {
    return {
      toolContext: {
        permissions: skill.allowedTools,
        state: new Map([['knownProductIds', new Set<string>()]]),
      },
      executionState: this.loop.createExecutionStateForSkill(skill.allowedTools, skill.maxToolCalls),
      toolCalls: [],
      toolResults: [],
      hits: new Map(),
      products: new Map(),
      contextSnapshot: {
        promptVersion: 'custom-orchestrator-v1',
        systemPrompt: `${this.loop.prompt}\n${skill.systemInstructions}`,
        question: initialContext.question,
        summary: initialContext.summary,
        history: initialContext.history,
        contextMetadata: initialContext.metadata,
        toolCalls: [],
        skill: { id: skill.id, version: skill.version },
      },
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      usageSeen: false,
      finalRaw: '',
      skill,
    };
  }

  private toResult(state: AgentState, result: AgentResult['result']): AgentResult {
    state.contextSnapshot.sources ??= [...state.hits.values()].map((hit) => ({
      chunkId: hit.chunkId,
      title: hit.documentTitle,
      content: hit.content.slice(0, 1800),
    }));
    state.contextSnapshot.products ??= [...state.products.values()];
    state.contextSnapshot.toolCalls ??= state.toolCalls;
    state.contextSnapshot.toolResults ??= state.toolResults;
    return {
      result,
      contextSnapshot: state.contextSnapshot,
      rawModelOutput: state.finalRaw || null,
      inputTokens: state.usageSeen ? state.inputTokens : null,
      outputTokens: state.usageSeen ? state.outputTokens : null,
      totalTokens: state.usageSeen ? state.totalTokens : null,
      toolCalls: state.toolCalls,
      toolResults: state.toolResults,
      sources: [...state.hits.values()],
      products: [...state.products.values()],
      skill: { id: state.skill.id, version: state.skill.version },
    };
  }
}
