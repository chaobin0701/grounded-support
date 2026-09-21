import type { PreviousTurnDto } from '../../chat/chat.dto';
import type { EventSink } from '../../channels/event-sink';
import type { SkillDefinition } from '../skills/skill.types';

export type AgentInput = {
  question: string;
  summary: string;
  recentHistory: PreviousTurnDto[];
  skill?: SkillDefinition;
};

export type AgentCallbacks = {
  onContext?: (context: Record<string, unknown>) => void;
  eventSink?: EventSink;
};
