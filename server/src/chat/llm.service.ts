import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { LLM_PROVIDER, LlmProvider } from '../ai/providers/llm-provider';
import { ProviderError } from '../ai/providers/provider-errors';
import { LlmMessage, LlmResponseFormat, LlmToolCall, LlmToolDefinition } from '../ai/providers/provider.types';
import { AppConfigService } from '../config/config.service';

export type ModelResult = {
  content: string;
  toolCalls: LlmToolCall[];
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  finishReason: string | null;
  durationMs: number;
  attempts: number;
};

export type LlmCompletionOptions = {
  messages?: LlmMessage[];
  tools?: LlmToolDefinition[];
  responseFormat?: LlmResponseFormat;
};

export class ModelFailure extends ServiceUnavailableException {
  constructor(readonly usage: Pick<ModelResult, 'inputTokens' | 'outputTokens' | 'totalTokens'>) {
    super('Answer service is temporarily unavailable; please try again later');
  }
}

@Injectable()
export class LlmService {
  readonly logger = new Logger(LlmService.name);

  constructor(@Inject(LLM_PROVIDER) private readonly provider: LlmProvider, @Optional() private readonly config?: AppConfigService) {}

  get model(): string {
    return this.provider.model;
  }

  get structuredOutputMode(): 'auto' | 'required' | 'disabled' {
    return this.provider.structuredOutput ?? this.config?.llm.structuredOutput ?? 'auto';
  }

  async complete(system: string, user: string, model = this.model): Promise<string> {
    return (await this.completeDetailed(system, user, model)).content;
  }

  async completeDetailed(system: string, user: string, model = this.model, purpose: 'answer' | 'summary' | 'planner' = 'answer', options: LlmCompletionOptions = {}): Promise<ModelResult> {
    const provider = this.provider;
    const started = Date.now();
    const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, seen: false };
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let reason = 'network_error';
      let retryable = true;
      try {
        const messages = options.messages ?? [{ role: 'system', content: system }, { role: 'user', content: user } satisfies LlmMessage];
        const response = await provider.chat({
          model,
          messages,
          ...(options.tools?.length ? { tools: options.tools } : {}),
          ...(options.responseFormat ? { responseFormat: options.responseFormat } : {}),
          temperature: 0.1,
          maxTokens: purpose === 'summary' ? 800 : this.provider.maxOutputTokens ?? this.config?.llm.maxOutputTokens ?? 1200,
        });
        if (response.usage.inputTokens !== null || response.usage.outputTokens !== null || response.usage.totalTokens !== null) usage.seen = true;
        usage.inputTokens += response.usage.inputTokens ?? 0;
        usage.outputTokens += response.usage.outputTokens ?? 0;
        usage.totalTokens += response.usage.totalTokens ?? 0;
        const toolCalls = response.toolCalls ?? [];
        if (response.content || toolCalls.length > 0) {
          return {
            content: response.content,
            toolCalls,
            model: response.model,
            inputTokens: usage.seen ? usage.inputTokens : null,
            outputTokens: usage.seen ? usage.outputTokens : null,
            totalTokens: usage.seen ? usage.totalTokens : null,
            finishReason: response.finishReason,
            durationMs: Date.now() - started,
            attempts: attempt,
          };
        }
        reason = `empty_response:${response.finishReason || 'unknown'}`;
      } catch (error) {
        if (error instanceof ProviderError) {
          reason = error.code;
          retryable = error.retryable;
        }
      }
      this.logger.warn(`Answer model failed model=${model} purpose=${purpose} attempt=${attempt}/2 reason=${reason}`);
      if (!retryable || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
    throw new ModelFailure({
      inputTokens: usage.seen ? usage.inputTokens : null,
      outputTokens: usage.seen ? usage.outputTokens : null,
      totalTokens: usage.seen ? usage.totalTokens : null,
    });
  }

  async streamText(system: string, user: string, onDelta: (text: string) => void, model = this.model): Promise<ModelResult> {
    const started = Date.now();
    let content = '';
    let usage = { inputTokens: null as number | null, outputTokens: null as number | null, totalTokens: null as number | null };
    let finishReason: string | null = null;
    for await (const event of this.provider.stream({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }] satisfies LlmMessage[],
      temperature: 0.1,
      maxTokens: this.provider.maxOutputTokens ?? this.config?.llm.maxOutputTokens ?? 1200,
    })) {
      if (event.type === 'text_delta') {
        content += event.delta;
        onDelta(event.delta);
      } else {
        usage = event.usage;
        finishReason = event.finishReason;
      }
    }
    return { content, toolCalls: [], model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens, finishReason, durationMs: Date.now() - started, attempts: 1 };
  }
}
