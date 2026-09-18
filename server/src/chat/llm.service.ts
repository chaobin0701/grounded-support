import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

export const SUPPORTED_LLM_MODELS = ['deepseek-v4-1-flash-260910', 'glm-5-3-flash-260828'] as const;
const MAX_ATTEMPTS = 2;

export type ModelResult = {
  content: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export class ModelFailure extends ServiceUnavailableException {
  constructor(readonly usage: Pick<ModelResult, 'inputTokens' | 'outputTokens' | 'totalTokens'>) {
    super('Answer service is temporarily unavailable; please try again later');
  }
}

@Injectable()
export class LlmService {
  readonly model = process.env.LLM_MODEL?.trim() || SUPPORTED_LLM_MODELS[0];
  private readonly baseUrl = (process.env.LLM_BASE_URL?.trim() || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
  private readonly logger = new Logger(LlmService.name);

  agentModel(): ChatOpenAI {
    const key = process.env.LLM_API_KEY?.trim();
    if (!key) throw new ServiceUnavailableException('Answer model is not configured');
    if (!SUPPORTED_LLM_MODELS.includes(this.model as typeof SUPPORTED_LLM_MODELS[number])) {
      throw new ServiceUnavailableException('Answer model is not supported');
    }
    return new ChatOpenAI({
      model: this.model, apiKey: key, configuration: { baseURL: this.baseUrl },
      useResponsesApi: false, maxTokens: 1600, maxRetries: 0, timeout: 20_000,
    });
  }

  async complete(system: string, user: string, model = this.model): Promise<string> {
    return (await this.completeDetailed(system, user, model)).content;
  }

  async completeDetailed(system: string, user: string, model = this.model, purpose: 'answer' | 'summary' = 'answer'): Promise<ModelResult> {
    const key = process.env.LLM_API_KEY?.trim();
    if (!key) throw new ServiceUnavailableException('Answer model is not configured');
    if (!SUPPORTED_LLM_MODELS.includes(model as typeof SUPPORTED_LLM_MODELS[number])) {
      throw new ServiceUnavailableException('Answer model is not supported');
    }
    // Ark supports the OpenAI-compatible chat/completions API.
    const client = new ChatOpenAI({
      model, apiKey: key, configuration: { baseURL: this.baseUrl },
      useResponsesApi: false, maxTokens: 1200, maxRetries: 0, timeout: 20_000,
    });
    const usage: Pick<ModelResult, 'inputTokens' | 'outputTokens' | 'totalTokens'> = {
      inputTokens: null, outputTokens: null, totalTokens: null,
    };
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let reason = 'network_error';
      let retryable = true;
      try {
        const response = await client.invoke([new SystemMessage(system), new HumanMessage(user)], {
          runName: `grounded-${purpose}`,
          tags: ['grounded-support', purpose],
        });
        const reported = response.usage_metadata;
        if (reported) {
          if (reported.input_tokens !== undefined) usage.inputTokens = (usage.inputTokens ?? 0) + reported.input_tokens;
          if (reported.output_tokens !== undefined) usage.outputTokens = (usage.outputTokens ?? 0) + reported.output_tokens;
          if (reported.total_tokens !== undefined) usage.totalTokens = (usage.totalTokens ?? 0) + reported.total_tokens;
        }
        const content = typeof response.content === 'string' ? response.content.trim() : '';
        if (content) {
          return {
            content, model,
            ...usage,
          };
        }
        const finish = String(response.response_metadata?.finish_reason ?? 'unknown');
        reason = `empty_response:${/^[a-z_]{1,30}$/.test(finish) ? finish : 'unknown'}`;
      } catch (error) {
        const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : NaN;
        if (Number.isInteger(status)) {
          reason = `http_${status}`;
          retryable = status === 429 || status >= 500;
        }
        // Never log SDK exceptions; they may contain prompts or provider data.
      }
      this.logger.warn(`Answer model failed model=${model} attempt=${attempt}/${MAX_ATTEMPTS} reason=${reason}`);
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
    throw new ModelFailure(usage);
  }
}
