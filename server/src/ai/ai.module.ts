import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { ProviderRegistry } from './providers/provider-registry';
import { LLM_PROVIDER } from './providers/llm-provider';

@Module({
  imports: [ConfigModule],
  providers: [
    ProviderRegistry,
    {
      provide: LLM_PROVIDER,
      useFactory: (registry: ProviderRegistry) => registry.createLlmProvider(),
      inject: [ProviderRegistry],
    },
  ],
  exports: [LLM_PROVIDER, ProviderRegistry],
})
export class AiModule {}
