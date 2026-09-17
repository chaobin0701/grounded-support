import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AskQuestionDto } from './chat.dto';
import { ChatRateLimitService } from './chat-rate-limit.service';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService, private readonly rateLimit: ChatRateLimitService) {}

  @Post()
  @HttpCode(200)
  ask(@Body() body: AskQuestionDto, @Req() request: Request) {
    return this.rateLimit.run(request.ip || request.socket.remoteAddress || 'unknown', () => this.chat.ask(body.question));
  }
}
