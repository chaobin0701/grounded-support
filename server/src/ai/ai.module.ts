import { Module } from '@nestjs/common';
import { LLM_PROVIDER } from './providers/llm-provider';
import { OpenAICompatibleProvider } from './providers/openai-compatible.provider';

@Module({
  providers: [OpenAICompatibleProvider, { provide: LLM_PROVIDER, useExisting: OpenAICompatibleProvider }],
  exports: [LLM_PROVIDER, OpenAICompatibleProvider],
})
export class AiModule {}
