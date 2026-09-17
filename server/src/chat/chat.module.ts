import { Module } from '@nestjs/common';
import { DocumentModule } from '../documents/document.module';
import { ChatController } from './chat.controller';
import { ChatRateLimitService } from './chat-rate-limit.service';
import { ChatService } from './chat.service';
import { LlmService } from './llm.service';

@Module({
  imports: [DocumentModule],
  controllers: [ChatController],
  providers: [ChatService, ChatRateLimitService, LlmService],
})
export class ChatModule {}
