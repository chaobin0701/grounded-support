import { BadGatewayException, BadRequestException, Injectable, Optional } from '@nestjs/common';
import { AgentRunner } from '../ai/agent/agent-runner';
import { AgentProtocolError } from '../ai/agent/model-response';
import type { PreviousTurnDto } from './chat.dto';
import type { ChatRun, ChatStreamCallbacks, CommentaryEvent, PublicProgressEvent, ToolStep } from './chat.service';
import { LlmService } from './llm.service';
import { SkillRegistry } from '../ai/skills/skill-registry';
import type { AgentModelCall } from '../ai/agent/agent-state';
import type { AgentTranscriptMessage } from './agent-transcript';
import { ContextGovernor } from './context-governor';
import { AppConfigService } from '../config/config.service';
import { agentConfigurationRevision, DEFAULT_AGENT_CONFIGURATION, effectiveAgentConfiguration, type AgentConfigurationSnapshot } from '../config/agent-config';
import { AgentSettingsService } from '../config/agent-settings.service';
import type { ChatAgentContext } from './chat.service';
import { ProductContextPreparer } from './product-context-preparer';
import { ContextMemoryService } from './context-memory.service';

export { validateAgentAnswer } from '../ai/agent/agent-answer';

@Injectable()
export class ChatOrchestratorService {
  constructor(
    private readonly agentRunner: AgentRunner,
    private readonly llm: LlmService,
    @Optional() private readonly skillRegistry?: SkillRegistry,
    @Optional() private readonly contextGovernor?: ContextGovernor,
    @Optional() private readonly config?: AppConfigService,
    @Optional() private readonly settings?: AgentSettingsService,
    @Optional() private readonly productPreparer?: ProductContextPreparer,
    @Optional() private readonly contextMemory?: ContextMemoryService,
  ) {}

  async askDetailed(
    question: string,
    history: PreviousTurnDto[],
    summary: string,
    onContext?: (context: Record<string, unknown>) => void,
    _onStep?: (step: ToolStep) => void,
    onCommentary?: (event: CommentaryEvent) => void,
    requestedSkillId?: string,
    callbacks?: ChatStreamCallbacks,
    agentContext?: ChatAgentContext,
  ): Promise<ChatRun> {
    const runStarted = Date.now();
    let runContext: Record<string, unknown> | undefined;
    const receiveContext = (context: Record<string, unknown>) => {
      runContext = context;
      context.runStartedAt = runStarted;
      onContext?.(context);
    };
    const configured = agentContext?.configurationSnapshot ?? await this.settings?.snapshot();
    const agentConfig = configured?.configuration ?? this.config?.agent ?? DEFAULT_AGENT_CONFIGURATION;
    const configurationSnapshot = { ...(configured ?? { revision: agentConfigurationRevision(agentConfig), configurationVersion: 0, updatedAt: null, updatedBy: null }), configuration: effectiveAgentConfiguration(agentConfig) };
    const progressEvents: Array<PublicProgressEvent | CommentaryEvent> = [];
    const emitProgress = (event: PublicProgressEvent) => {
      progressEvents.push(event);
      callbacks?.onProgress?.(event);
    };
    const emitCommentary = (event: CommentaryEvent) => {
      progressEvents.push(event);
      callbacks?.onCommentary?.(event);
      onCommentary?.(event);
    };
    const emitCommentaryDelta = (event: CommentaryEvent) => callbacks?.onCommentaryDelta?.(event);
    // Ordinary turns have no current/default Skill and no keyword routing.
    // Retain explicit internal requests for real specialist guides only.
    if (requestedSkillId && (!this.skillRegistry?.has(requestedSkillId) || !agentConfig.enabledSkills.includes(requestedSkillId))) throw new BadRequestException('Unknown or unavailable skill');
    const initialSkills = requestedSkillId ? [this.skillRegistry!.get(requestedSkillId)] : [];
    const restoredContext = agentContext?.conversationId && this.contextMemory
      ? await this.contextMemory.restore(agentContext.conversationId, agentContext.contextBlocks ?? [], configurationSnapshot.configuration)
      : undefined;
    const reuseProducts = configurationSnapshot.configuration.memory.toolResults.enabled && configurationSnapshot.configuration.memory.toolResults.products;
    const productPreparation = agentContext?.requestContext?.productIds?.length && this.productPreparer
      ? await this.productPreparer.prepare(question, agentContext.requestContext.productIds, reuseProducts ? restoredContext?.products ?? agentContext.priorProducts ?? [] : [], configurationSnapshot.configuration, emitProgress, agentContext)
      : undefined;
    const result = await this.agentRunner.run(
      {
        question,
        configurationSnapshot,
        summary,
        recentHistory: history,
        availableSkills: (this.skillRegistry?.summaries() ?? []).filter(skill => agentConfig.enabledSkills.includes(skill.id)),
        initialSkills,
        conversationId: agentContext?.conversationId,
        traceId: agentContext?.traceId,
        priorTranscript: agentContext?.priorTranscript,
        requestContext: agentContext?.requestContext,
        productPreparation,
        restoredContext,
        initialContextBlocks: agentContext?.currentContextBlocks,
        initialEvidence: productPreparation?.evidence,
      },
      { onContext: receiveContext, onProgress: emitProgress, onCommentary: emitCommentary, onCommentaryDelta: emitCommentaryDelta },
    ).catch(error => {
      if (runContext) ((runContext.timing ??= {}) as Record<string, unknown>).totalMs = Date.now() - runStarted;
      // The runtime has no HTTP concerns; the chat adapter maps a domain error.
      if (error instanceof AgentProtocolError) throw new BadGatewayException({ code: error.code, message: '模型响应格式异常，请稍后重试。' });
      throw error;
    });
    const hasToolProgress = progressEvents.some((event) => event.type === 'progress' && event.stage === 'tool');
    result.contextSnapshot.agentConfigurationRevision = configurationSnapshot.revision;
    result.contextSnapshot.agentConfigurationVersion = configurationSnapshot.configurationVersion;
    if (!result.result.refused && callbacks?.onAnswerDelta) {
      const answerOperationId = `${Date.now()}-answer`;
      if (hasToolProgress) emitProgress({ type: 'progress', id: `${answerOperationId}-start`, operationId: answerOperationId, stage: 'answer', status: 'running', text: '资料已准备完成，正在整理回答…' });
      callbacks.onAnswerStarted?.({ citations: result.result.citations });
      const tone = { professional: '专业、清晰', friendly: '亲切、自然', concise: '简洁、直接' }[agentConfig.responseStyle.tone];
      const detail = { brief: '优先简短回复', balanced: '根据问题复杂度适度展开', detailed: '必要时分项解释细节，避免无关展开' }[agentConfig.responseStyle.detail];
      const answerSystemPrompt = `你是${agentConfig.identity.name}的最终回答生成器。${agentConfig.answerInstructions}\n回答风格：${tone}；${detail}。`;
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
      let partialAnswer = '';
      const answerStarted = Date.now();
      const timing = (result.contextSnapshot.timing ??= {}) as Record<string, unknown>;
      const streamed = await this.llm.streamText(
        answerSystemPrompt,
        answerUserPrompt,
        text => {
          timing.answerTtftMs ??= Date.now() - answerStarted;
          partialAnswer += text;
          callbacks.onAnswerDelta?.(text);
        },
      ).catch(error => {
        timing.totalMs = Date.now() - runStarted;
        result.contextSnapshot.partialAnswer = partialAnswer;
        result.contextSnapshot.answerStreamStatus = 'interrupted';
        throw error;
      });
      result.contextSnapshot.answerStreamStatus = 'completed';
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
    ((result.contextSnapshot.timing ??= {}) as Record<string, unknown>).totalMs = Date.now() - runStarted;
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
