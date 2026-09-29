import { Module } from '@nestjs/common';
import { AiModule } from '../ai.module';
import { ToolsModule } from '../tools/tools.module';
import { ContextBuilder } from '../../chat/context-builder';
import { LlmService } from '../../chat/llm.service';
import { AgentLoop } from './agent-loop';
import { AgentRunner } from './agent-runner';
import { SkillsModule } from '../skills/skills.module';
import { McpModule } from '../mcp/mcp.module';
import { ContextGovernor } from '../../chat/context-governor';

@Module({
  imports: [AiModule, ToolsModule, SkillsModule, McpModule],
  providers: [ContextBuilder, ContextGovernor, LlmService, AgentLoop, AgentRunner],
  exports: [ContextBuilder, ContextGovernor, LlmService, AgentLoop, AgentRunner],
})
export class AgentModule {}
