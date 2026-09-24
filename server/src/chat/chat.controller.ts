import { Body, Controller, Delete, Get, HttpCode, HttpException, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AskQuestionDto } from './chat.dto';
import { ChatRateLimitService } from './chat-rate-limit.service';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';
import { ChatApplicationService } from './chat-application.service';

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly rateLimit: ChatRateLimitService,
    private readonly conversations: ConversationService,
    private readonly application: ChatApplicationService,
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

  @Get('conversations/:id/runs')
  async listRuns(@Param('id', ParseUUIDPipe) id: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.conversations.runs(await this.conversations.session(request, response), id);
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
    return this.rateLimit.run(request.ip || request.socket.remoteAddress || 'unknown', () => this.application.ask({ channel: 'browser', conversationId: id, ownerId: owner, question: body.question, clientRequestId: this.idempotencyKey(request), requestId: this.requestId(request) }));
  }

  @Post('conversations/:id/messages/stream')
  @HttpCode(200)
  async streamInConversation(@Param('id', ParseUUIDPipe) id: string, @Body() body: AskQuestionDto, @Req() request: Request, @Res() response: Response) {
    const owner = await this.conversations.session(request, response);
    return this.rateLimit.run(request.ip || request.socket.remoteAddress || 'unknown', async () => {
      this.beginStream(response);
      try {
        let streamed = false;
        const answer = await this.application.ask(
          { channel: 'browser', conversationId: id, ownerId: owner, question: body.question, clientRequestId: this.idempotencyKey(request), requestId: this.requestId(request) },
          {
            onAnswerStarted: (metadata) => this.writeEvent(response, 'answer_started', metadata),
            onAnswerDelta: (text) => {
              streamed = true;
              this.writeEvent(response, 'answer_delta', { text });
            },
            onProgress: (event) => this.writeEvent(response, 'progress', event),
          },
        );
        await this.writeAnswerStream(response, answer, streamed);
      } catch (error) {
        this.writeStreamError(response, error);
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
        const run = await this.chat.askDetailed(body.question, body.history);
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

  private writeStreamError(response: Response, error?: unknown) {
    if (!response.destroyed) {
      const status = error instanceof HttpException ? error.getStatus() : 503;
      response.statusCode = status;
      const message = status === 409 ? '上一轮请求仍在处理中，请稍后查看会话。' : status === 400 ? '请求参数无效，请重新发送。' : '回答服务暂时不可用，请稍后重试。';
      response.write(`event: error\ndata: ${JSON.stringify({ status, message })}\n\n`);
      response.end();
    }
  }

  private idempotencyKey(request: Request): string | undefined {
    const value = request.headers['idempotency-key'];
    return Array.isArray(value) ? value[0] : value;
  }

  private requestId(request: Request): string {
    const value = request.headers['x-request-id'];
    return (Array.isArray(value) ? value[0] : value) ?? `${request.method}:${request.originalUrl}`;
  }

  private async writeAnswerStream(response: Response, answer: Awaited<ReturnType<ChatService['ask']>>, streamed = false) {
    if (!streamed && !answer.refused) {
      this.writeEvent(response, 'answer_delta', { text: answer.answer });
    }
    if (streamed) this.writeEvent(response, 'answer_completed', { citations: answer.citations });
    if (!response.destroyed) {
      this.writeEvent(response, 'done', answer);
      response.end();
    }
  }

  private writeEvent(response: Response, event: string, data: unknown) {
    if (response.destroyed || response.writableEnded) return;
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

}
