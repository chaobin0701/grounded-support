import { Injectable, ServiceUnavailableException } from '@nestjs/common';

type ChatCompletion = { choices?: Array<{ message?: { content?: string } }> };

export const SUPPORTED_LLM_MODELS = ['deepseek-v4-1-flash-260910', 'glm-5-3-flash-260828'] as const;

@Injectable()
export class LlmService {
  readonly model = process.env.LLM_MODEL?.trim() || SUPPORTED_LLM_MODELS[0];
  private readonly baseUrl = (process.env.LLM_BASE_URL?.trim() || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');

  async complete(system: string, user: string, model = this.model): Promise<string> {
    const key = process.env.LLM_API_KEY?.trim();
    if (!key) throw new ServiceUnavailableException('Answer model is not configured');
    if (!SUPPORTED_LLM_MODELS.includes(model as typeof SUPPORTED_LLM_MODELS[number])) {
      throw new ServiceUnavailableException('Answer model is not supported');
    }
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 700 }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new ServiceUnavailableException('Answer model is unavailable');
    }
    if (!response.ok) throw new ServiceUnavailableException(`Answer model returned HTTP ${response.status}`);
    let payload: ChatCompletion;
    try {
      payload = await response.json() as ChatCompletion;
    } catch {
      throw new ServiceUnavailableException('Answer model returned invalid JSON');
    }
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new ServiceUnavailableException('Answer model returned an empty response');
    }
    return content;
  }
}
