import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AskQuestionDto } from './chat.dto';
import { ChatRateLimitService } from './chat-rate-limit.service';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';
import type { CommentaryEvent, ToolStep } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly rateLimit: ChatRateLimitService,
    private readonly conversations: ConversationService,
  ) {}

  @Get('conversations')
  async listConversations(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.conversations.list(await this.conversations.session(request, response));
  }

  @Post('conversations')
  async createConversation(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.conversations.create(await this.conversations.session(request, response));
  }

  @Get('conversations/:id/messages')
  async listMessages(@Param('id', ParseUUIDPipe) id: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.conversations.messages(await this.conversations.session(request, response), id);
  }

  @Delete('conversations/:id')
  @HttpCode(204)
  async deleteConversation(@Param('id', ParseUUIDPipe) id: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.conversations.remove(await this.conversations.session(request, response), id);
  }

  @Post('conversations/:id/messages')
  @HttpCode(200)
  async askInConversation(@Param('id', ParseUUIDPipe) id: string, @Body() body: AskQuestionDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const owner = await this.conversations.session(request, response);
    return this.rateLimit.run(request.ip || request.socket.remoteAddress || 'unknown', () => this.conversations.ask(owner, id, body.question));
  }

  @Post('conversations/:id/messages/stream')
  @HttpCode(200)
  async streamInConversation(@Param('id', ParseUUIDPipe) id: string, @Body() body: AskQuestionDto, @Req() request: Request, @Res() response: Response) {
    const owner = await this.conversations.session(request, response);
    return this.rateLimit.run(request.ip || request.socket.remoteAddress || 'unknown', async () => {
      this.beginStream(response);
      try {
        const answer = await this.conversations.ask(owner, id, body.question,
          (step) => this.writeStep(response, step), (event) => this.writeCommentary(response, event));
        await this.writeAnswerStream(response, answer);
      } catch {
        this.writeStreamError(response);
      }
    });
  }

  @Post()
  @HttpCode(200)
  ask(@Body() body: AskQuestionDto, @Req() request: Request) {
    return this.rateLimit.run(request.ip || request.socket.remoteAddress || 'unknown', () => this.chat.ask(body.question, body.history));
  }

  @Post('stream')
  @HttpCode(200)
  stream(@Body() body: AskQuestionDto, @Req() request: Request, @Res() response: Response) {
    return this.rateLimit.run(request.ip || request.socket.remoteAddress || 'unknown', async () => {
      this.beginStream(response);
      try {
        // Do not reveal model tokens until the complete answer has passed validation.
        const run = await this.chat.askDetailed(body.question, body.history, '', undefined,
          (step) => this.writeStep(response, step), (event) => this.writeCommentary(response, event));
        await this.writeAnswerStream(response, run.result);
      } catch {
        this.writeStreamError(response);
      }
    });
  }

  private beginStream(response: Response) {
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
  }

  private writeStep(response: Response, step: ToolStep) {
    if (!response.destroyed) response.write(`event: step\ndata: ${JSON.stringify(step)}\n\n`);
  }

  private writeCommentary(response: Response, event: CommentaryEvent) {
    if (!response.destroyed) response.write(`event: commentary\ndata: ${JSON.stringify(event)}\n\n`);
  }

  private writeStreamError(response: Response) {
    if (!response.destroyed) {
      response.write(`event: error\ndata: ${JSON.stringify({ message: '回答服务暂时不可用，请稍后重试。' })}\n\n`);
      response.end();
    }
  }

  private async writeAnswerStream(response: Response, answer: Awaited<ReturnType<ChatService['ask']>>) {
      if (!answer.refused) {
        for (const text of answer.answer.match(/[\s\S]{1,8}/gu) || []) {
          if (response.destroyed) return;
          response.write(`event: delta\ndata: ${JSON.stringify({ text })}\n\n`);
          await new Promise((resolve) => setTimeout(resolve, 35));
        }
      }
      if (!response.destroyed) {
        response.write(`event: done\ndata: ${JSON.stringify(answer)}\n\n`);
        response.end();
      }
  }
}
