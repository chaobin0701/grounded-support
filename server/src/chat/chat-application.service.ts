import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ChatAnswer, ChatStreamCallbacks } from './chat.service';
import { ConversationService } from './conversation.service';
import type { InboundMessage } from '../channels/channel.types';
import type { AgentEvent, AgentEventBase } from '../channels/agent-event';
import { InMemoryMessageBus } from '../message-bus/in-memory-message-bus';

@Injectable()
export class ChatApplicationService {
  constructor(
    private readonly conversations: ConversationService,
    private readonly messageBus: InMemoryMessageBus,
  ) {}

  async ask(message: InboundMessage, callbacks?: ChatStreamCallbacks): Promise<ChatAnswer> {
    const runId = message.clientRequestId ?? randomUUID();
    const messageId = randomUUID();
    const base: AgentEventBase = {
      eventId: randomUUID(), channel: message.channel, conversationId: message.conversationId,
      messageId, runId, occurredAt: new Date().toISOString(), visibility: 'public',
    };
    await this.messageBus.publish({ ...base, type: 'message.received', question: message.question });
    await this.messageBus.publish({ ...base, eventId: randomUUID(), type: 'run.started' });
    try {
      const answer = await this.conversations.ask(message.ownerId, message.conversationId, message.question, undefined, undefined, message.clientRequestId, message.skillId, callbacks);
      await this.messageBus.publish({ ...base, eventId: randomUUID(), type: 'message.completed', answer: answer.answer, refused: answer.refused, citations: answer.citations });
      return answer;
    } catch (error) {
      await this.messageBus.publish({ ...base, eventId: randomUUID(), type: 'run.failed', errorCode: this.errorCode(error) });
      throw error;
    }
  }

  private errorCode(error: unknown): string {
    const status = (error as { getStatus?: () => number }).getStatus?.();
    return status === 409 ? 'conflict' : status === 400 ? 'invalid_request' : 'answer_failed';
  }
}
