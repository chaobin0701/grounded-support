import { Module } from '@nestjs/common';
import { AiModule } from '../ai.module';
import { ToolsModule } from '../tools/tools.module';
import { ContextBuilder } from '../../chat/context-builder';
import { LlmService } from '../../chat/llm.service';
import { AgentLoop } from './agent-loop';
import { AgentRunner } from './agent-runner';

@Module({
  imports: [AiModule, ToolsModule],
  providers: [ContextBuilder, LlmService, AgentLoop, AgentRunner],
  exports: [ContextBuilder, LlmService, AgentLoop, AgentRunner],
})
export class AgentModule {}
