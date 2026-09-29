import { Module } from '@nestjs/common';
import { DocumentModule } from '../documents/document.module';
import { AdminModule } from '../admin/admin.module';
import { AdminChatTraceController } from './admin-chat-trace.controller';
import { AdminDebugController } from './admin-debug.controller';
import { AdminDebugService } from './admin-debug.service';
import { ChatController } from './chat.controller';
import { ChatRateLimitService } from './chat-rate-limit.service';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';
import { ChatOrchestratorService } from './chat-orchestrator.service';
import { AgentModule } from '../ai/agent/agent.module';
import { ChatApplicationService } from './chat-application.service';
import { SkillsModule } from '../ai/skills/skills.module';
import { SkillPreflightService } from '../ai/skills/skill-preflight.service';

@Module({
  imports: [DocumentModule, AdminModule, AgentModule, SkillsModule],
  controllers: [ChatController, AdminChatTraceController, AdminDebugController],
  providers: [ChatService, ChatRateLimitService, ConversationService, ChatOrchestratorService, ChatApplicationService, SkillPreflightService, AdminDebugService],
})
export class ChatModule {}
