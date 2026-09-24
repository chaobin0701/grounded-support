import type { PreviousTurnDto } from '../../chat/chat.dto';
import type { EventSink } from '../../channels/event-sink';
import type { SkillDefinition } from '../skills/skill.types';
import type { SearchHit } from '../../documents/fuse-search-results';

export type AgentInput = {
  question: string;
  summary: string;
  recentHistory: PreviousTurnDto[];
  skill?: SkillDefinition;
  initialEvidence?: SearchHit[];
  preflight?: {
    query: string | null;
    durationMs: number;
    hitCount: number;
    retrievalMode?: string;
    errorCode?: string;
  };
  selectedBy?: 'default' | 'explicit' | 'deterministic';
};

export type AgentCallbacks = {
  onContext?: (context: Record<string, unknown>) => void;
  eventSink?: EventSink;
};
