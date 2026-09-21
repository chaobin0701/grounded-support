import type { ChannelName } from './channel.types';

export type AgentEventBase = {
  eventId: string;
  channel: ChannelName;
  conversationId: string;
  messageId: string;
  runId: string;
  occurredAt: string;
  visibility: 'public' | 'internal' | 'admin';
};

export type AgentEvent =
  | (AgentEventBase & { type: 'message.received'; question: string })
  | (AgentEventBase & { type: 'run.started' })
  | (AgentEventBase & { type: 'message.completed'; answer: string; refused: boolean; citations: unknown[] })
  | (AgentEventBase & { type: 'run.failed'; errorCode: string });
