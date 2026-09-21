import type { PreviousTurnDto } from '../../chat/chat.dto';
import type { EventSink } from '../../channels/event-sink';

export type AgentInput = {
  question: string;
  summary: string;
  recentHistory: PreviousTurnDto[];
};

export type AgentCallbacks = {
  onContext?: (context: Record<string, unknown>) => void;
  eventSink?: EventSink;
};
