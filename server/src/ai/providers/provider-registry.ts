import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import { LlmProvider } from './llm-provider';
import { OpenAICompatibleProvider } from './openai-compatible.provider';

export class UnsupportedProviderError extends Error {
  constructor(provider: string) {
    super(`Unsupported LLM provider: ${provider}`);
    this.name = 'UnsupportedProviderError';
  }
}

type ProviderFactory = (config: AppConfigService['llm']) => LlmProvider;

@Injectable()
export class ProviderRegistry {
  private readonly factories = new Map<string, ProviderFactory>();

  constructor(private readonly config: AppConfigService) {
    this.factories.set('openai-compatible', (llm) => new OpenAICompatibleProvider({
      apiKey: llm.apiKey,
      baseUrl: llm.baseUrl,
      model: llm.model,
      timeoutMs: llm.timeoutMs,
      structuredOutput: llm.structuredOutput,
    }));
  }

  createLlmProvider(): LlmProvider {
    const providerName = this.config.llm.provider;
    const factory = this.factories.get(providerName);
    if (!factory) throw new UnsupportedProviderError(providerName);
    return factory(this.config.llm);
  }
}
