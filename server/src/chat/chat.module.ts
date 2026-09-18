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
import { AgentChatService } from './agent-chat.service';
import { McpCapabilityGateway } from '../mcp/mcp-capability.gateway';
import { ProgressSettingsService } from './progress-settings.service';
import { ProgressSettingsController } from './progress-settings.controller';

@Module({
  imports: [DocumentModule, AdminModule],
  controllers: [ChatController, AdminChatTraceController, ProgressSettingsController],
  providers: [ChatService, ChatRateLimitService, LlmService, ConversationService, ProductMcpService, McpCapabilityGateway, AgentChatService, ProgressSettingsService],
})
export class ChatModule {}
