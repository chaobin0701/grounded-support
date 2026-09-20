import { PreviousTurnDto } from './chat.dto';

export type SnapshotMessage = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  refused: boolean | null;
};

/** The only memory boundary exposed to the Agent is one conversation. */
export interface ConversationSnapshot {
  conversationId: string;
  summary: string;
  summaryThroughMessageId: number | null;
  recentMessages: SnapshotMessage[];
  history: PreviousTurnDto[];
}
