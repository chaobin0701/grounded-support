import { Injectable, Optional } from '@nestjs/common';
import { ContextBuilder } from '../../chat/context-builder';
import type { AgentCallbacks, AgentInput } from './agent-input';
import type { AgentResult } from './agent-result';
import type { AgentState } from './agent-state';
import { RECOVERY_REFUSAL } from './agent-answer';
import { AgentLoop } from './agent-loop';
import { AppConfigService } from '../../config/config.service';
import { DEFAULT_AGENT_CONFIGURATION } from '../../config/agent-config';
import { TRANSCRIPT_VERSION, transcriptMessageBase, type AgentTranscriptMessage } from '../../chat/agent-transcript';
import { makeContextBlock, readContextBlocks, canUseContextSource } from '../context/context-contribution';

@Injectable()
export class AgentRunner {
  constructor(
    private readonly loop: AgentLoop,
    private readonly contextBuilder: ContextBuilder,
    @Optional() private readonly config?: AppConfigService,
  ) {}

  async run(input: AgentInput, callbacks: AgentCallbacks = {}): Promise<AgentResult> {
    const agent = input.configurationSnapshot?.configuration ?? this.config?.agent ?? DEFAULT_AGENT_CONFIGURATION;
    const priorTranscript = input.priorTranscript ?? [];
    const userMessage: AgentTranscriptMessage = {
      ...transcriptMessageBase(input.conversationId, input.traceId, priorTranscript.length + 1),
      role: 'user',
      content: input.question,
      productIds: input.requestContext?.productIds,
      productReferences: input.requestContext?.productReferences,
    };
    const transcript = [...priorTranscript, userMessage];
    const initialContext = this.contextBuilder.build({
      configuration: agent,
      question: input.question,
      summary: input.summary,
      recentHistory: input.recentHistory,
      toolResults: [],
      initialEvidence: input.initialEvidence,
      availableSkills: input.availableSkills,
      loadedSkills: input.initialSkills,
      transcript,
    });
    const state = this.createState(initialContext, input, transcript, [userMessage]);
    state.contextSnapshot.runStartedAt = Date.now();
    state.contextSnapshot.timing = { plannerTtftMs: null, firstCommentaryMs: null, toolWaitMs: 0, toolExecutionMs: 0, answerTtftMs: null, totalMs: null };
    state.contextSnapshot.runtimeContextBlocks = state.contextBlocks;
    for (const product of input.restoredContext?.products ?? []) state.products.set(product.id, product);
    for (const hit of input.restoredContext?.evidence ?? []) state.hits.set(hit.chunkId, hit);
    state.contextSnapshot.contextMemory = input.restoredContext?.diagnostics;
    let hostContextChars = 0;
    for (const block of readContextBlocks(input.initialContextBlocks, input.conversationId ?? '').slice(0, 20)) {
      if (!canUseContextSource(block.source, agent.runtime.allowedTools)) continue;
      const size = JSON.stringify(block.resources).length;
      if (hostContextChars + size > Math.min(24000, agent.runtime.maxToolResultChars * 2)) continue;
      hostContextChars += size;
      state.contextBlocks.push(block);
      for (const resource of block.resources) {
        if (resource.kind === 'product') state.products.set(resource.data.id, resource.data);
        else state.hits.set(resource.data.chunkId, resource.data);
      }
    }
    for (const product of input.restoredContext?.products ?? []) if (!state.executionState.productResults?.has(product.id)) {
      state.executionState.productResults?.set(product.id, { success: true, content: JSON.stringify(product), data: product });
    }
    for (const hit of input.initialEvidence ?? []) state.hits.set(hit.chunkId, hit);
    state.contextSnapshot.preflight = input.preflight;
    for (const skill of input.initialSkills ?? []) state.executionSteps.push({ type: 'skill_loaded', stage: 'planning', skillId: skill.id, selectedBy: 'explicit', ok: true, durationMs: 0, detail: `显式加载 ${skill.name}` });
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

    for (let round = 0; round < state.runtime.maxPlannerRounds; round += 1) {
      const step = await this.loop.step(input, state, callbacks.onProgress, callbacks.onCommentary, callbacks.onCommentaryDelta);
      if (step.type === 'complete') return this.toResult(state, step.result);
    }

    return this.toResult(state, { answer: RECOVERY_REFUSAL, refused: true, citations: [] });
  }

  private createState(
    initialContext: ReturnType<ContextBuilder['build']>,
    input: AgentInput,
    transcript: AgentTranscriptMessage[],
    traceTranscript: AgentTranscriptMessage[],
  ): AgentState {
    const agent = input.configurationSnapshot?.configuration ?? this.config?.agent ?? DEFAULT_AGENT_CONFIGURATION;
    const runtime = agent.runtime;
    const loadedSkills = new Map((input.initialSkills ?? []).map(skill => [skill.id, skill]));
    return {
      configuration: agent,
      toolContext: {
        sessionId: input.conversationId,
        traceId: input.traceId,
        permissions: runtime.allowedTools,
        enabledSkillIds: agent.enabledSkills,
        state: new Map([['knownProductIds', new Set<string>()]]),
      },
      executionState: this.loop.createExecutionStateForAgent(runtime.allowedTools, runtime.maxToolCalls, { timeoutMs: runtime.toolTimeoutMs, maxResultChars: runtime.maxToolResultChars }),
      toolCalls: [],
      toolResults: [],
      executionSteps: [],
      modelCalls: [],
      hits: new Map(),
      products: new Map(),
      contextSnapshot: {
        promptVersion: 'agent-runtime-context-memory-v5',
        systemPrompt: this.loop.systemPromptFor(input.availableSkills ?? [], [...loadedSkills.values()], agent),
        agentConfigurationRevision: input.configurationSnapshot?.revision,
        agentConfigurationVersion: input.configurationSnapshot?.configurationVersion,
        question: initialContext.question,
        summary: initialContext.summary,
        history: initialContext.history,
        contextMetadata: initialContext.metadata,
        toolCalls: [],
        executionSteps: [],
        modelCalls: [],
        agentTranscript: traceTranscript,
        transcriptVersion: TRANSCRIPT_VERSION,
        agent: { name: agent.identity.name, role: agent.identity.role },
        runtime,
        requestContext: input.requestContext ?? {},
        availableSkills: input.availableSkills ?? [],
        loadedSkills: [...loadedSkills.values()].map(({ id, name, version }) => ({ id, name, version })),
      },
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      usageSeen: false,
      finalRaw: '',
      runtime,
      loadedSkills,
      plannerRound: 0,
      transcript,
      traceTranscript,
      contextBlocks: [],
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
    state.contextSnapshot.runtimeContextBlocks = state.contextBlocks;
    state.contextSnapshot.transcriptVersion = TRANSCRIPT_VERSION;
    state.contextSnapshot.executionSteps = state.executionSteps;
    state.contextSnapshot.modelCalls = state.modelCalls;
    state.contextSnapshot.loadedSkills = [...state.loadedSkills.values()].map(({ id, name, version }) => ({ id, name, version }));
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
      loadedSkills: [...state.loadedSkills.values()].map(({ id, name, version, description }) => ({ id, name, version, description })),
    };
  }
}
