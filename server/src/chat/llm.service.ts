import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { LLM_PROVIDER, LlmProvider } from '../ai/providers/llm-provider';
import { ProviderError } from '../ai/providers/provider-errors';
import { LlmMessage, LlmRequest, LlmResponseFormat, LlmToolCall, LlmToolDefinition } from '../ai/providers/provider.types';
import { AppConfigService } from '../config/config.service';
import { reserveModelCall } from './model-call-accounting';

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
  ttftMs?: number | null;
};

export type LlmCompletionOptions = {
  messages?: LlmMessage[];
  tools?: LlmToolDefinition[];
  responseFormat?: LlmResponseFormat;
  toolChoice?: LlmRequest['toolChoice'];
};

export type LlmStreamCallbacks = {
  onTextDelta?: (text: string) => void;
};

export class ModelStreamProtocolError extends Error {
  constructor(readonly reason: string) {
    super(`Model stream protocol error: ${reason}`);
    this.name = 'ModelStreamProtocolError';
  }
}

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

  get maxOutputTokens(): number {
    return this.provider.maxOutputTokens ?? this.config?.llm.maxOutputTokens ?? 1200;
  }

  get contextWindowTokens(): number {
    return this.provider.contextWindowTokens ?? this.config?.llm.contextWindowTokens ?? 32000;
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
      const messages = options.messages ?? [{ role: 'system', content: system }, { role: 'user', content: user } satisfies LlmMessage];
      const request: LlmRequest = {
        model, messages,
        ...(options.tools?.length ? { tools: options.tools } : {}),
        ...(options.responseFormat ? { responseFormat: options.responseFormat } : {}),
        temperature: 0.1,
        maxTokens: purpose === 'summary' ? Math.min(800, this.maxOutputTokens) : this.maxOutputTokens,
      };
      // A quota rejection is not a provider failure and must never be retried or
      // converted into a generic refusal. Each real retry obtains a separate lease.
      const lease = await reserveModelCall(request, purpose);
      let settling = false;
      try {
        const response = await provider.chat(request);
        settling = true;
        await lease?.settle(response.usage);
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
        if (settling) throw error; // Accounting failure must not repeat a paid model request.
        await lease?.settle(null, error);
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
    return this.streamDetailed(system, user, model, 'answer', { messages: [{ role: 'system', content: system }, { role: 'user', content: user }] satisfies LlmMessage[] }, { onTextDelta: onDelta });
  }

  async streamDetailed(
    system: string,
    user: string,
    model = this.model,
    purpose: 'answer' | 'summary' | 'planner' = 'answer',
    options: LlmCompletionOptions = {},
    callbacks: LlmStreamCallbacks = {},
  ): Promise<ModelResult> {
    const started = Date.now();
    const messages = options.messages ?? [{ role: 'system', content: system }, { role: 'user', content: user } satisfies LlmMessage];
    const request: LlmRequest = {
      model,
      messages,
      ...(options.tools?.length ? { tools: options.tools } : {}),
      ...(options.responseFormat ? { responseFormat: options.responseFormat } : {}),
      ...(options.toolChoice ? { toolChoice: options.toolChoice } : {}),
      temperature: 0.1,
      maxTokens: purpose === 'summary' ? Math.min(800, this.maxOutputTokens) : this.maxOutputTokens,
    };
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let content = '';
      let usage = { inputTokens: null as number | null, outputTokens: null as number | null, totalTokens: null as number | null };
      let finishReason: string | null = null;
      let completed = false;
      let emitted = false;
      let ttftMs: number | null = null;
      let settling = false;
      const calls = new Map<number, { id: string; name: string; arguments: string }>();
      const lease = await reserveModelCall(request, purpose);
      try {
        for await (const event of this.provider.stream(request)) {
          if (completed) throw new ModelStreamProtocolError('event_after_completion');
          if (event.type !== 'completed' && ttftMs === null) ttftMs = Date.now() - started;
          if (event.type === 'text_delta') {
            emitted = true;
            content += event.delta;
            callbacks.onTextDelta?.(event.delta);
          } else if (event.type === 'tool_call_delta') {
            emitted = true;
            if (!Number.isInteger(event.index) || event.index < 0) throw new ModelStreamProtocolError('invalid_tool_index');
            const call = calls.get(event.index) ?? { id: '', name: '', arguments: '' };
            if (event.id && call.id && event.id !== call.id) throw new ModelStreamProtocolError('conflicting_tool_id');
            if (event.id) call.id = event.id;
            if (event.name) call.name += event.name;
            if (event.argumentsDelta) call.arguments += event.argumentsDelta;
            calls.set(event.index, call);
          } else {
            completed = true;
            usage = event.usage;
            finishReason = event.finishReason;
          }
        }
        if (!completed) throw new ModelStreamProtocolError('missing_completion_event');
        const toolCalls: LlmToolCall[] = [];
        for (const call of [...calls.entries()].sort(([left], [right]) => left - right).map(([, value]) => value)) {
          if (!call.id || !call.name || toolCalls.some(previous => previous.id === call.id)) throw new ModelStreamProtocolError('invalid_native_tool_calls');
          let parsed: unknown;
          try { parsed = JSON.parse(call.arguments); } catch { throw new ModelStreamProtocolError('invalid_tool_arguments'); }
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ModelStreamProtocolError('invalid_tool_arguments');
          toolCalls.push({ id: call.id, name: call.name, arguments: parsed as Record<string, unknown> });
        }
        if (!content && toolCalls.length === 0) throw new ModelStreamProtocolError('empty_response');
        if (toolCalls.length && finishReason !== null && finishReason !== 'tool_calls') throw new ModelStreamProtocolError('invalid_tool_finish_reason');
        if (!toolCalls.length && finishReason === 'tool_calls') throw new ModelStreamProtocolError('missing_tool_calls');
        settling = true;
        await lease?.settle(usage);
        return { content, toolCalls, model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens, finishReason, durationMs: Date.now() - started, attempts: attempt, ttftMs };
      } catch (error) {
        if (settling) throw error;
        await lease?.settle(usage, error);
        lastError = error;
        if (emitted || error instanceof ModelStreamProtocolError || (error instanceof ProviderError && !error.retryable) || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
    throw lastError ?? new ModelStreamProtocolError('unknown');
  }
}
