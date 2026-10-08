import { Injectable, Optional } from '@nestjs/common';
import { AgentRunner } from '../ai/agent/agent-runner';
import type { PreviousTurnDto } from './chat.dto';
import type { ChatRun, ChatStreamCallbacks, CommentaryEvent, PublicProgressEvent, ToolStep } from './chat.service';
import { LlmService } from './llm.service';
import { SkillSelector } from '../ai/skills/skill-selector';
import { questionAnsweringSkill } from '../ai/skills/built-in/question-answering.skill';
import { SkillPreflightService } from '../ai/skills/skill-preflight.service';
import type { AgentModelCall } from '../ai/agent/agent-state';
import type { AgentTranscriptMessage } from './agent-transcript';
import { ContextGovernor } from './context-governor';

export { validateAgentAnswer } from '../ai/agent/agent-answer';

@Injectable()
export class ChatOrchestratorService {
  constructor(
    private readonly agentRunner: AgentRunner,
    private readonly llm: LlmService,
    private readonly skillSelector?: SkillSelector,
    @Optional() private readonly skillPreflight?: SkillPreflightService,
    @Optional() private readonly contextGovernor?: ContextGovernor,
  ) {}

  async askDetailed(
    question: string,
    history: PreviousTurnDto[],
    summary: string,
    onContext?: (context: Record<string, unknown>) => void,
    _onStep?: (step: ToolStep) => void,
    _onCommentary?: (event: CommentaryEvent) => void,
    requestedSkillId?: string,
    callbacks?: ChatStreamCallbacks,
    agentContext?: { conversationId?: string; traceId?: string; priorTranscript?: AgentTranscriptMessage[] },
  ): Promise<ChatRun> {
    const progressEvents: PublicProgressEvent[] = [];
    const emitProgress = (event: PublicProgressEvent) => {
      progressEvents.push(event);
      callbacks?.onProgress?.(event);
    };
    const selected = this.skillSelector
      ? this.skillSelector.select(question, requestedSkillId)
      : { skill: questionAnsweringSkill, selectedBy: 'default' as const };
    const preflight = this.skillPreflight
      ? await this.skillPreflight.run(question, selected.skill)
      : { hits: [], query: null, durationMs: 0 };
    const result = await this.agentRunner.run(
      {
        question,
        summary,
        recentHistory: history,
        skill: selected.skill,
        initialEvidence: preflight.hits,
        preflight: {
          query: preflight.query,
          durationMs: preflight.durationMs,
          hitCount: preflight.hits.length,
          ...(preflight.retrievalMode ? { retrievalMode: preflight.retrievalMode } : {}),
          ...(preflight.errorCode ? { errorCode: preflight.errorCode } : {}),
        },
        selectedBy: selected.selectedBy,
        conversationId: agentContext?.conversationId,
        traceId: agentContext?.traceId,
        priorTranscript: agentContext?.priorTranscript,
      },
      { onContext, onProgress: emitProgress },
    );
    const hasToolProgress = progressEvents.some((event) => event.stage === 'tool');
    if (!result.result.refused && callbacks?.onAnswerDelta) {
      const answerOperationId = `${Date.now()}-answer`;
      if (hasToolProgress) emitProgress({ type: 'progress', id: `${answerOperationId}-start`, operationId: answerOperationId, stage: 'answer', status: 'running', text: '资料已准备完成，正在整理回答…' });
      callbacks.onAnswerStarted?.({ citations: result.result.citations });
      const answerSystemPrompt = '你是暖巢电器的最终回答生成器。只输出给用户看的简短中文回答，不要输出 JSON、Markdown、引用编号或内部过程。只能使用提供的草稿和事实，不能补充未提供的信息。';
      const answerUserPrompt = JSON.stringify({ question, draftAnswer: result.result.answer, citations: result.result.citations, context: { sources: result.contextSnapshot.sources ?? [], products: result.contextSnapshot.products ?? [] } });
      const answerBudget = this.contextGovernor?.inspect({
        systemPrompt: answerSystemPrompt,
        userPrompt: answerUserPrompt,
        purpose: 'answer',
        rawMessageCount: 2,
        includedMessageCount: 2,
      });
      if (answerBudget) {
        const budgets = Array.isArray(result.contextSnapshot.contextBudgets) ? result.contextSnapshot.contextBudgets : [];
        budgets.push({ purpose: 'answer', ...answerBudget });
        result.contextSnapshot.contextBudgets = budgets;
        result.contextSnapshot.contextBudget = answerBudget;
      }
      const streamed = await this.llm.streamText(
        answerSystemPrompt,
        answerUserPrompt,
        callbacks.onAnswerDelta,
      );
      const modelCalls = Array.isArray(result.contextSnapshot.modelCalls)
        ? result.contextSnapshot.modelCalls.filter(isAgentModelCall)
        : [];
      modelCalls.push({
        id: `answer-${modelCalls.length + 1}`,
        purpose: 'answer',
        model: streamed.model,
        request: { messages: [{ role: 'system', content: answerSystemPrompt }, { role: 'user', content: answerUserPrompt }], temperature: 0.1, maxTokens: this.llm.maxOutputTokens },
        response: { content: streamed.content, finishReason: streamed.finishReason, inputTokens: streamed.inputTokens, outputTokens: streamed.outputTokens, totalTokens: streamed.totalTokens },
        durationMs: streamed.durationMs,
        attempts: streamed.attempts,
      });
      result.contextSnapshot.modelCalls = modelCalls;
      if (streamed.content.trim()) result.result = { ...result.result, answer: streamed.content.trim() };
      result.inputTokens = (result.inputTokens ?? 0) + (streamed.inputTokens ?? 0);
      result.outputTokens = (result.outputTokens ?? 0) + (streamed.outputTokens ?? 0);
      result.totalTokens = (result.totalTokens ?? 0) + (streamed.totalTokens ?? 0);
      if (hasToolProgress) emitProgress({ type: 'progress', id: `${answerOperationId}-complete`, operationId: answerOperationId, stage: 'answer', status: 'completed', text: '回答生成完成', durationMs: streamed.durationMs });
    }
    result.result = { ...result.result, progressEvents: [...(result.result.progressEvents ?? []), ...progressEvents] };
    return {
      traceId: agentContext?.traceId,
      result: result.result,
      contextSnapshot: result.contextSnapshot,
      rawModelOutput: result.rawModelOutput,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.totalTokens,
    };
  }
}

function isAgentModelCall(value: unknown): value is AgentModelCall {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const request = item.request && typeof item.request === 'object' && !Array.isArray(item.request) ? item.request as Record<string, unknown> : null;
  const response = item.response && typeof item.response === 'object' && !Array.isArray(item.response) ? item.response as Record<string, unknown> : null;
  return typeof item.id === 'string'
    && ['planner', 'answer', 'summary'].includes(String(item.purpose))
    && typeof item.model === 'string'
    && request !== null
    && Array.isArray(request.messages)
    && typeof response?.content === 'string'
    && typeof item.durationMs === 'number'
    && typeof item.attempts === 'number';
}
