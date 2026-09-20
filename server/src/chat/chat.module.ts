import { Module } from '@nestjs/common';
import { DocumentModule } from '../documents/document.module';
import { AdminModule } from '../admin/admin.module';
import { AdminChatTraceController } from './admin-chat-trace.controller';
import { ChatController } from './chat.controller';
import { ChatRateLimitService } from './chat-rate-limit.service';
import { ChatService } from './chat.service';
import { LlmService } from './llm.service';
import { ConversationService } from './conversation.service';
import { ProductMcpService } from './product-mcp.service';
import { ChatOrchestratorService } from './chat-orchestrator.service';
import { McpCapabilityGateway } from '../mcp/mcp-capability.gateway';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [DocumentModule, AdminModule, AiModule],
  controllers: [ChatController, AdminChatTraceController],
  providers: [ChatService, ChatRateLimitService, LlmService, ConversationService, ProductMcpService, McpCapabilityGateway, ChatOrchestratorService],
})
export class ChatModule {}
