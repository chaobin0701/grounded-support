import { Injectable, Optional } from '@nestjs/common';
import { AgentRunner } from '../ai/agent/agent-runner';
import type { PreviousTurnDto } from './chat.dto';
import type { ChatRun, ChatStreamCallbacks, CommentaryEvent, PublicProgressEvent, ToolStep } from './chat.service';
import { LlmService } from './llm.service';
import { SkillSelector } from '../ai/skills/skill-selector';
import { questionAnsweringSkill } from '../ai/skills/built-in/question-answering.skill';
import { SkillPreflightService } from '../ai/skills/skill-preflight.service';

export { validateAgentAnswer } from '../ai/agent/agent-answer';

@Injectable()
export class ChatOrchestratorService {
  constructor(
    private readonly agentRunner: AgentRunner,
    private readonly llm: LlmService,
    private readonly skillSelector?: SkillSelector,
    @Optional() private readonly skillPreflight?: SkillPreflightService,
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
      },
      { onContext, onProgress: emitProgress },
    );
    const hasToolProgress = progressEvents.some((event) => event.stage === 'tool');
    if (!result.result.refused && callbacks?.onAnswerDelta) {
      const answerOperationId = `${Date.now()}-answer`;
      if (hasToolProgress) emitProgress({ type: 'progress', id: `${answerOperationId}-start`, operationId: answerOperationId, stage: 'answer', status: 'running', text: '资料已准备完成，正在整理回答…' });
      callbacks.onAnswerStarted?.({ citations: result.result.citations });
      const streamed = await this.llm.streamText(
        '你是暖巢电器的最终回答生成器。只输出给用户看的简短中文回答，不要输出 JSON、Markdown、引用编号或内部过程。只能使用提供的草稿和事实，不能补充未提供的信息。',
        JSON.stringify({ question, draftAnswer: result.result.answer, citations: result.result.citations, context: { sources: result.contextSnapshot.sources ?? [], products: result.contextSnapshot.products ?? [] } }),
        callbacks.onAnswerDelta,
      );
      if (streamed.content.trim()) result.result = { ...result.result, answer: streamed.content.trim() };
      result.inputTokens = (result.inputTokens ?? 0) + (streamed.inputTokens ?? 0);
      result.outputTokens = (result.outputTokens ?? 0) + (streamed.outputTokens ?? 0);
      result.totalTokens = (result.totalTokens ?? 0) + (streamed.totalTokens ?? 0);
      if (hasToolProgress) emitProgress({ type: 'progress', id: `${answerOperationId}-complete`, operationId: answerOperationId, stage: 'answer', status: 'completed', text: '回答生成完成', durationMs: streamed.durationMs });
    }
    result.result = { ...result.result, progressEvents: [...(result.result.progressEvents ?? []), ...progressEvents] };
    return {
      result: result.result,
      contextSnapshot: result.contextSnapshot,
      rawModelOutput: result.rawModelOutput,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.totalTokens,
    };
  }
}
