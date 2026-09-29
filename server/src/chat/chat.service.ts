import { Injectable } from '@nestjs/common';
import { SearchHit } from '../documents/fuse-search-results';
import { PreviousTurnDto } from './chat.dto';
import { ChatOrchestratorService } from './chat-orchestrator.service';
import type { AgentTranscriptMessage } from './agent-transcript';
export { validateAnswer } from '../ai/agent/citation-validation';

export type Citation = Pick<SearchHit, 'chunkId' | 'documentId' | 'documentTitle' | 'originalFilename' | 'sourceStartLine' | 'sourceEndLine'>;
export type ToolStep = { id: string; label: string; status: 'running' | 'completed'; detail?: string; durationMs?: number };
export type CommentaryEvent = { id: string; type: 'commentary'; text: string };
export type PublicProgressEvent = {
  type: 'progress';
  id: string;
  stage: 'planning' | 'preflight' | 'tool' | 'answer';
  status: 'running' | 'completed';
  text: string;
  operationId?: string;
  tool?: string;
  durationMs?: number;
  resultCount?: number;
};
export type ProcessEvent = ({ type: 'tool' } & ToolStep) | CommentaryEvent | PublicProgressEvent;
export type ChatAnswer = { answer: string; refused: boolean; citations: Citation[]; toolSteps?: ToolStep[]; progressEvents?: ProcessEvent[] };
export type ChatStreamCallbacks = {
  onAnswerStarted?: (metadata: { citations: Citation[] }) => void;
  onAnswerDelta?: (text: string) => void;
  onProgress?: (event: PublicProgressEvent) => void;
};
export type ChatRun = {
  traceId?: string;
  result: ChatAnswer;
  contextSnapshot: Record<string, unknown>;
  rawModelOutput: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export function retrievalQuery(question: string, history: PreviousTurnDto[] = []): string {
  const current = question.trim();
  if (!history.length || !/(^那|^它|^这个|^这种|^该|^上面|^前面|^还有|^那么|它|这个|这种|该产品|呢[？?]?$)/u.test(current)) return current;
  const previous = history.slice(-2).map((turn) => turn.question.trim()).join(' ');
  return `${previous} ${current}`.slice(-200);
}

@Injectable()
export class ChatService {
  constructor(private readonly orchestrator: ChatOrchestratorService) {}

  async ask(question: string, history: PreviousTurnDto[] = []): Promise<ChatAnswer> {
    return (await this.askDetailed(question, history)).result;
  }

  async askDetailed(question: string, history: PreviousTurnDto[] = [], summary = '', onContext?: (context: Record<string, unknown>) => void, onStep?: (step: ToolStep) => void, onCommentary?: (event: CommentaryEvent) => void, requestedSkillId?: string, callbacks?: ChatStreamCallbacks, agentContext?: { conversationId?: string; traceId?: string; priorTranscript?: AgentTranscriptMessage[] }): Promise<ChatRun> {
    return this.orchestrator.askDetailed(question, history, summary, onContext, onStep, onCommentary, requestedSkillId, callbacks, agentContext);
  }

}
