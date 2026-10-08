import { Injectable, Logger } from '@nestjs/common';
import {
  ProviderAuthenticationError,
  ProviderContextLengthError,
  ProviderInvalidResponseError,
  ProviderModelNotFoundError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  ProviderError,
  ProviderUnsupportedResponseFormatError,
} from './provider-errors';
import { LlmProvider } from './llm-provider';
import { LlmRequest, LlmResponse, LlmStreamEvent } from './provider.types';

export const SUPPORTED_LLM_MODELS = ['deepseek-v4-1-flash-260910', 'glm-5-3-flash-260828'] as const;

export interface OpenAICompatibleProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens?: number;
  contextWindowTokens?: number;
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
  readonly maxOutputTokens: number | undefined;
  readonly contextWindowTokens: number | undefined;
  private readonly supportedModels: readonly string[];
  private readonly logger = new Logger(OpenAICompatibleProvider.name);

  constructor(options: OpenAICompatibleProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
    this.maxOutputTokens = options.maxOutputTokens;
    this.contextWindowTokens = options.contextWindowTokens;
    // OpenAI-compatible endpoints expose model identifiers configured by the
    // account.  Keep an optional allow-list for deployments that need one, but
    // do not impose a built-in list on user-managed profiles.
    this.supportedModels = options.supportedModels ?? [];
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    if (!this.apiKey) throw new ProviderAuthenticationError();
    if (this.supportedModels.length > 0 && !this.supportedModels.includes(request.model)) throw new ProviderModelNotFoundError();
    const started = Date.now();
    let response: Response;
    let payload: RawResponse;
    try {
      ({ response, payload } = await this.fetchChatResponse(request));
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof DOMException && error.name === 'TimeoutError') throw new ProviderTimeoutError();
      this.logger.warn('Model provider request failed before receiving a response');
      throw new ProviderUnavailableError();
    }
    if (!response.ok) {
      if (request.responseFormat && this.isUnsupportedResponseFormat(response.status, payload)) {
        throw new ProviderUnsupportedResponseFormatError(response.status);
      }
      throw this.mapHttpError(response.status, payload);
    }
    const choice = payload.choices?.[0];
    if (!choice?.message) throw new ProviderInvalidResponseError();
    const rawToolCalls = choice.message.tool_calls;
    if (rawToolCalls !== undefined && !Array.isArray(rawToolCalls)) throw new ProviderInvalidResponseError();
    const toolCalls = (rawToolCalls ?? []).map((call) => {
      const id = typeof call.id === 'string' ? call.id : '';
      const name = typeof call.function?.name === 'string' ? call.function.name : '';
      if (!id || !name) throw new ProviderInvalidResponseError();
      let args: unknown;
      if (typeof call.function?.arguments === 'string') {
        try { args = JSON.parse(call.function.arguments); } catch { throw new ProviderInvalidResponseError(); }
      } else {
        args = call.function?.arguments;
      }
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ProviderInvalidResponseError();
      return { id, name, arguments: args as Record<string, unknown> };
    });
    const content = normalizeContent(choice.message.content);
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

  private async fetchChatResponse(request: LlmRequest): Promise<{ response: Response; payload: RawResponse }> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(this.buildChatBody(request)),
        signal: request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') throw new ProviderTimeoutError();
      throw new ProviderUnavailableError();
    }
    let payload: RawResponse;
    try { payload = await response.json() as RawResponse; } catch { throw new ProviderInvalidResponseError(); }
    return { response, payload };
  }

  private buildChatBody(request: LlmRequest): Record<string, unknown> {
    const responseFormat = request.responseFormat;
    return {
      model: request.model,
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.toolCalls?.length ? (message.content || null) : message.content,
        ...(message.name ? { name: message.name } : {}),
        ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
        ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}),
      })),
      ...(request.tools?.length ? { tools: request.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) } : {}),
      ...(request.toolChoice ? { tool_choice: typeof request.toolChoice === 'string' ? request.toolChoice : { type: 'function', function: { name: request.toolChoice.name } } } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens ?? 1200,
    };
  }

  private isUnsupportedResponseFormat(status: number, payload: RawResponse): boolean {
    if (status !== 400 && status !== 422) return false;
    const text = JSON.stringify(payload).toLowerCase();
    return /response[_ -]?format|json[_ -]?object|structured output/.test(text);
  }

  async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    if (!this.apiKey) throw new ProviderAuthenticationError();
    if (this.supportedModels.length > 0 && !this.supportedModels.includes(request.model)) throw new ProviderModelNotFoundError();
    let response: Response;
    try {
      const fetchStream = (includeUsage: boolean) => fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages.map((message) => ({ role: message.role, content: message.toolCalls?.length ? (message.content || null) : message.content, ...(message.name ? { name: message.name } : {}), ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}) })),
          temperature: request.temperature ?? 0.1,
          max_tokens: request.maxTokens ?? 1200,
          stream: true,
          ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
        }),
        signal: request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs),
      });
      response = await fetchStream(true);
      // Some compatible endpoints reject stream_options. Negotiate once before
      // receiving any deltas; the resulting missing usage stays explicitly unknown.
      if (response.status === 400 || response.status === 422) {
        const rejected = await response.clone().text();
        if (/stream[_ -]?options|include[_ -]?usage/i.test(rejected)) response = await fetchStream(false);
      }
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) throw error;
      this.logger.warn('Model provider stream failed before receiving a response');
      throw new ProviderUnavailableError();
    }
    if (!response.ok || !response.body) {
      let payload: RawResponse = {};
      try { payload = await response.json() as RawResponse; } catch { /* Map the status when the provider has no JSON body. */ }
      throw this.mapHttpError(response.status, payload);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } = { inputTokens: null, outputTokens: null, totalTokens: null };
    let finishReason: string | null = null;
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer = (buffer + decoder.decode(value, { stream: !done })).replace(/\r\n/g, '\n');
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        if (done && buffer.trim()) { frames.push(buffer); buffer = ''; }
        for (const frame of frames) {
          const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('');
          if (!data || data === '[DONE]') continue;
          let payload: {
            choices?: Array<{ delta?: { content?: unknown }; finish_reason?: unknown }>;
            usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
          };
          try { payload = JSON.parse(data) as typeof payload; } catch { continue; }
          const choice = payload.choices?.[0];
          if (typeof choice?.delta?.content === 'string' && choice.delta.content) yield { type: 'text_delta', delta: choice.delta.content };
          if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
          // Usage is usually an extra choices:[] frame. Later empty frames must
          // not overwrite a previously received usage record with nulls.
          if (payload.usage) usage = {
            inputTokens: numberOrNull(payload.usage.prompt_tokens) ?? usage.inputTokens,
            outputTokens: numberOrNull(payload.usage.completion_tokens) ?? usage.outputTokens,
            totalTokens: numberOrNull(payload.usage.total_tokens) ?? usage.totalTokens,
          };
        }
        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }
    yield { type: 'completed', usage, finishReason };
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

function normalizeContent(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';
  return value
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      const text = (part as { text?: unknown }).text;
      return typeof text === 'string' ? text : '';
    })
    .join('')
    .trim();
}
