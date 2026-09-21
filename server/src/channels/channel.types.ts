export type ChannelName = 'browser' | 'api';

export type InboundMessage = {
  channel: ChannelName;
  conversationId: string;
  ownerId: string;
  question: string;
  clientRequestId?: string;
  requestId: string;
  /** Optional controlled override; the server only accepts registered skills. */
  skillId?: string;
};
