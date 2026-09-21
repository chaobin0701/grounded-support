import { Injectable, Logger } from '@nestjs/common';
import {
  ProviderAuthenticationError,
  ProviderContextLengthError,
  ProviderInvalidResponseError,
  ProviderModelNotFoundError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  ProviderUnavailableError,
} from './provider-errors';
import { LlmProvider } from './llm-provider';
import { LlmRequest, LlmResponse } from './provider.types';

export const SUPPORTED_LLM_MODELS = ['deepseek-v4-1-flash-260910', 'glm-5-3-flash-260828'] as const;

export interface OpenAICompatibleProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  supportedModels?: readonly string[];
}

type RawResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
      tool_calls?: Array<{ id?: unknown; function?: { name?: unknown; arguments?: unknown } }>;
    };
    finish_reason?: unknown;
  }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
};

@Injectable()
export class OpenAICompatibleProvider implements LlmProvider {
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly supportedModels: readonly string[];
  private readonly logger = new Logger(OpenAICompatibleProvider.name);

  constructor(options: OpenAICompatibleProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
    this.supportedModels = options.supportedModels ?? SUPPORTED_LLM_MODELS;
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    if (!this.apiKey) throw new ProviderAuthenticationError();
    if (!this.supportedModels.includes(request.model)) throw new ProviderModelNotFoundError();
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages.map((message) => ({ role: message.role, content: message.content, ...(message.name ? { name: message.name } : {}), ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}) })),
          ...(request.tools?.length ? { tools: request.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) } : {}),
          temperature: request.temperature ?? 0.1,
          max_tokens: request.maxTokens ?? 1200,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') throw new ProviderTimeoutError();
      this.logger.warn('Model provider request failed before receiving a response');
      throw new ProviderUnavailableError();
    }

    let payload: RawResponse;
    try { payload = await response.json() as RawResponse; } catch { throw new ProviderInvalidResponseError(); }
    if (!response.ok) throw this.mapHttpError(response.status, payload);
    const choice = payload.choices?.[0];
    if (!choice?.message) throw new ProviderInvalidResponseError();
    const toolCalls = (choice.message.tool_calls ?? []).map((call) => {
      const id = typeof call.id === 'string' ? call.id : '';
      const name = typeof call.function?.name === 'string' ? call.function.name : '';
      if (!id || !name || typeof call.function?.arguments !== 'string') throw new ProviderInvalidResponseError();
      let args: unknown;
      try { args = JSON.parse(call.function.arguments); } catch { throw new ProviderInvalidResponseError(); }
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ProviderInvalidResponseError();
      return { id, name, arguments: args as Record<string, unknown> };
    });
    const content = typeof choice.message.content === 'string' ? choice.message.content.trim() : '';
    return {
      content,
      toolCalls,
      finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
      usage: {
        inputTokens: numberOrNull(payload.usage?.prompt_tokens),
        outputTokens: numberOrNull(payload.usage?.completion_tokens),
        totalTokens: numberOrNull(payload.usage?.total_tokens),
      },
      model: request.model,
      durationMs: Date.now() - started,
    };
  }

  private mapHttpError(status: number, payload: RawResponse): Error {
    const errorText = JSON.stringify(payload).toLowerCase();
    if (status === 401 || status === 403) return new ProviderAuthenticationError(status);
    if (status === 429) return new ProviderRateLimitError(status);
    if (status === 408 || status === 504) return new ProviderTimeoutError();
    if (status === 400 && /context|token|length/.test(errorText)) return new ProviderContextLengthError(status);
    if (status === 400 && /model|not found|不存在/.test(errorText)) return new ProviderModelNotFoundError(status);
    if (status >= 500) return new ProviderUnavailableError(status);
    return new ProviderUnavailableError(status);
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
