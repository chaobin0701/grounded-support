import { Module } from '@nestjs/common';
import { DocumentModule } from '../documents/document.module';
import { AdminModule } from '../admin/admin.module';
import { AdminChatTraceController } from './admin-chat-trace.controller';
import { ChatController } from './chat.controller';
import { ChatRateLimitService } from './chat-rate-limit.service';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';
import { ChatOrchestratorService } from './chat-orchestrator.service';
import { AgentModule } from '../ai/agent/agent.module';

@Module({
  imports: [DocumentModule, AdminModule, AgentModule],
  controllers: [ChatController, AdminChatTraceController],
  providers: [ChatService, ChatRateLimitService, ConversationService, ChatOrchestratorService],
})
export class ChatModule {}
