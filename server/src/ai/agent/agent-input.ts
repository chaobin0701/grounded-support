import type { PreviousTurnDto } from '../../chat/chat.dto';

export type AgentInput = {
  question: string;
  summary: string;
  recentHistory: PreviousTurnDto[];
};

export type AgentCallbacks = {
  onContext?: (context: Record<string, unknown>) => void;
};
