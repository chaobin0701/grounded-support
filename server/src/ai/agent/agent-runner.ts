import { Injectable } from '@nestjs/common';
import { ContextBuilder } from '../../chat/context-builder';
import type { AgentCallbacks, AgentInput } from './agent-input';
import type { AgentResult } from './agent-result';
import type { AgentState } from './agent-state';
import { REFUSAL } from './agent-answer';
import { AgentLoop } from './agent-loop';
import { questionAnsweringSkill } from '../skills/built-in/question-answering.skill';
import type { SkillDefinition } from '../skills/skill.types';
import { TRANSCRIPT_VERSION, transcriptMessageBase, type AgentTranscriptMessage } from '../../chat/agent-transcript';

@Injectable()
export class AgentRunner {
  constructor(
    private readonly loop: AgentLoop,
    private readonly contextBuilder: ContextBuilder,
  ) {}

  async run(input: AgentInput, callbacks: AgentCallbacks = {}): Promise<AgentResult> {
    const skill = input.skill ?? questionAnsweringSkill;
    const priorTranscript = input.priorTranscript ?? [];
    const userMessage: AgentTranscriptMessage = {
      ...transcriptMessageBase(input.conversationId, input.traceId, priorTranscript.length + 1),
      role: 'user',
      content: input.question,
    };
    const transcript = [...priorTranscript, userMessage];
    const initialContext = this.contextBuilder.build({
      question: input.question,
      summary: input.summary,
      recentHistory: input.recentHistory,
      toolResults: [],
      initialEvidence: input.initialEvidence,
      skill,
      transcript,
    });
    const state = this.createState(initialContext, skill, transcript, [userMessage]);
    for (const hit of input.initialEvidence ?? []) state.hits.set(hit.chunkId, hit);
    state.contextSnapshot.preflight = input.preflight;
    state.contextSnapshot.skillSelection = { skillId: skill.id, selectedBy: input.selectedBy ?? 'default' };
    state.executionSteps.push({
      type: 'skill_selection',
      stage: 'planning',
      skillId: skill.id,
      selectedBy: input.selectedBy ?? 'default',
      ok: true,
      durationMs: 0,
      detail: `已选择 ${skill.name}`,
    });
    if (input.preflight?.query) {
      state.executionSteps.push({
        type: 'preflight',
        stage: 'planning',
        query: input.preflight.query,
        hitCount: input.preflight.hitCount,
        retrievalMode: input.preflight.retrievalMode,
        ok: !input.preflight.errorCode,
        durationMs: input.preflight.durationMs,
        ...(input.preflight.errorCode ? { errorCode: input.preflight.errorCode } : {}),
        detail: input.preflight.errorCode ? '预检索失败，交由 Agent 决定是否重试' : `预检索命中 ${input.preflight.hitCount} 个资料片段`,
      });
    }
    state.contextSnapshot.executionSteps = state.executionSteps;
    callbacks.onContext?.(state.contextSnapshot);

    for (let round = 0; round < skill.maxToolCalls; round += 1) {
      const step = await this.loop.step(input, state, callbacks.onProgress);
      if (step.type === 'complete') return this.toResult(state, step.result);
    }

    return this.toResult(state, { answer: REFUSAL, refused: true, citations: [] });
  }

  private createState(
    initialContext: ReturnType<ContextBuilder['build']>,
    skill: SkillDefinition,
    transcript: AgentTranscriptMessage[],
    traceTranscript: AgentTranscriptMessage[],
  ): AgentState {
    return {
      toolContext: {
        permissions: skill.allowedTools,
        state: new Map([['knownProductIds', new Set<string>()]]),
      },
      executionState: this.loop.createExecutionStateForSkill(skill.allowedTools, skill.maxToolCalls),
      toolCalls: [],
      toolResults: [],
      executionSteps: [],
      modelCalls: [],
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
        executionSteps: [],
        modelCalls: [],
        agentTranscript: traceTranscript,
        transcriptVersion: TRANSCRIPT_VERSION,
        skill: { id: skill.id, version: skill.version, name: skill.name, responseMode: skill.responseMode },
      },
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      usageSeen: false,
      finalRaw: '',
      skill,
      plannerRound: 0,
      transcript,
      traceTranscript,
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
    state.contextSnapshot.agentTranscript = state.traceTranscript;
    state.contextSnapshot.transcriptVersion = TRANSCRIPT_VERSION;
    state.contextSnapshot.executionSteps = state.executionSteps;
    state.contextSnapshot.modelCalls = state.modelCalls;
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
