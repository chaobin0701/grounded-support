import type { PreviousTurnDto } from '../../chat/chat.dto';
import type { EventSink } from '../../channels/event-sink';
import type { SkillDefinition, SkillSummary } from '../skills/skill.types';
import type { SearchHit } from '../../documents/fuse-search-results';
import type { CommentaryEvent, PublicProgressEvent } from '../../chat/chat.service';
import type { AgentConfigurationSnapshot } from '../../config/agent-config';
import type { AgentTranscriptMessage } from '../../chat/agent-transcript';
import type { RequestContext } from '../../chat/request-context';
import type { ProductPreparation } from '../../chat/product-context-preparer';

export type AgentInput = {
  requestContext?: RequestContext;
  productPreparation?: ProductPreparation;
  configurationSnapshot?: AgentConfigurationSnapshot;
  question: string;
  summary: string;
  recentHistory: PreviousTurnDto[];
  availableSkills?: SkillSummary[];
  initialSkills?: SkillDefinition[];
  initialEvidence?: SearchHit[];
  preflight?: {
    query: string | null;
    durationMs: number;
    hitCount: number;
    retrievalMode?: string;
    errorCode?: string;
  };
  conversationId?: string;
  traceId?: string;
  priorTranscript?: AgentTranscriptMessage[];
};

export type AgentCallbacks = {
  onContext?: (context: Record<string, unknown>) => void;
  eventSink?: EventSink;
  onProgress?: (event: PublicProgressEvent) => void;
  onCommentary?: (event: CommentaryEvent) => void;
};
