import { Module } from '@nestjs/common';
import { DocumentModule } from '../documents/document.module';
import { AdminModule } from '../admin/admin.module';
import { AdminChatTraceController } from './admin-chat-trace.controller';
import { ChatController } from './chat.controller';
import { ChatRateLimitService } from './chat-rate-limit.service';
import { ChatService } from './chat.service';
import { LlmService } from './llm.service';
import { ConversationService } from './conversation.service';
import { ChatOrchestratorService } from './chat-orchestrator.service';
import { AiModule } from '../ai/ai.module';
import { ToolsModule } from '../ai/tools/tools.module';

@Module({
  imports: [DocumentModule, AdminModule, AiModule, ToolsModule],
  controllers: [ChatController, AdminChatTraceController],
  providers: [ChatService, ChatRateLimitService, LlmService, ConversationService, ChatOrchestratorService],
})
export class ChatModule {}
