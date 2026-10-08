export interface Citation {
  chunkId: number;
  documentId: number;
  documentTitle: string;
  originalFilename: string;
  sourceStartLine: number;
  sourceEndLine: number;
}

export interface ChatAnswer {
  answer: string;
  refused: boolean;
  citations: Citation[];
  progressEvents?: ProcessEvent[];
}
export interface CommentaryEvent { type: 'commentary'; id: string; text: string }
export type ProcessEvent = ProgressEvent | CommentaryEvent;

export interface ProgressEvent {
  type: 'progress';
  id: string;
  stage: 'planning' | 'preflight' | 'tool' | 'answer';
  status: 'running' | 'completed';
  text: string;
  operationId?: string;
  tool?: string;
  durationMs?: number;
  resultCount?: number;
}

export interface PreviousTurn { question: string; answer: string }
export interface RequestContext { productIds?: string[]; productReferences?: Array<{ productId: string; offset: number; length?: number }> }
export interface ChatPresentation { title: string; description: string; suggestedQuestions: string[] }

export async function getChatPresentation(): Promise<ChatPresentation> {
  const response = await fetch('/api/chat/presentation', { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw await responseError(response);
  const data = await response.json() as ChatPresentation;
  if (typeof data.title !== 'string' || typeof data.description !== 'string'
    || !Array.isArray(data.suggestedQuestions) || !data.suggestedQuestions.every(item => typeof item === 'string')) {
    throw new Error('Invalid chat presentation');
  }
  return data;
}
export interface ConversationItem {
  id: string;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
}
export interface ConversationMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  refused: boolean | null;
  citations: Citation[];
  progressEvents?: ProcessEvent[];
  createdAt: string;
  context?: RequestContext & { products?: Array<{ id: string; name: string }> };
}

export interface ConversationRun {
  id: string;
  clientRequestId: string;
  question: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'expired';
  expiresAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  createdAt: string;
}

export class ChatApiError extends Error {
  constructor(readonly status: number, message?: string, readonly code?: string, readonly retryAt?: string) {
    super(message || `Chat API returned HTTP ${status}`);
  }
}

async function responseError(response: Response): Promise<ChatApiError> {
  try {
    const payload = await response.json() as { message?: unknown; code?: unknown; retryAt?: unknown; error?: { message?: unknown; code?: unknown; retryAt?: unknown } };
    const detail = payload.error ?? payload;
    return new ChatApiError(response.status, typeof detail.message === 'string' ? detail.message : undefined, typeof detail.code === 'string' ? detail.code : undefined, typeof detail.retryAt === 'string' ? detail.retryAt : undefined);
  } catch {
    return new ChatApiError(response.status);
  }
}

function parseAnswer(payload: unknown): ChatAnswer {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid chat response');
  const answer = payload as Record<string, unknown>;
  if (typeof answer.answer !== 'string' || typeof answer.refused !== 'boolean' || !Array.isArray(answer.citations)) {
    throw new Error('Invalid chat response');
  }
  return answer as unknown as ChatAnswer;
}

export async function askQuestion(question: string, history: PreviousTurn[] = [], context?: RequestContext): Promise<ChatAnswer> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, history, ...(context ? { context } : {}) }),
    signal: AbortSignal.timeout(65_000),
  });
  if (!response.ok) throw await responseError(response);
  return parseAnswer(await response.json());
}

export async function askInConversation(conversationId: string, question: string, idempotencyKey?: string, context?: RequestContext): Promise<ChatAnswer> {
  const response = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    body: JSON.stringify({ question, ...(context ? { context } : {}) }),
    signal: AbortSignal.timeout(65_000),
  });
  if (!response.ok) throw await responseError(response);
  return parseAnswer(await response.json());
}

export async function askInConversationStream(conversationId: string, question: string, onDelta: (text: string) => void, idempotencyKey?: string, onProgress?: (event: ProcessEvent) => void, context?: RequestContext): Promise<ChatAnswer> {
  const response = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/messages/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    body: JSON.stringify({ question, ...(context ? { context } : {}) }),
    signal: AbortSignal.timeout(65_000),
  });
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new Error('Streaming is unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalAnswer: ChatAnswer | undefined;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = frame.match(/^event: (.+)$/m)?.[1];
        const data = frame.match(/^data: (.+)$/m)?.[1];
        if (data && (event === 'delta' || event === 'answer_delta')) {
          const payload = JSON.parse(data) as { text?: unknown };
          if (typeof payload.text !== 'string') throw new Error('Invalid stream delta');
          onDelta(payload.text);
        } else if (data && event === 'progress') {
          const progress = JSON.parse(data) as ProgressEvent;
          if (progress.type === 'progress' && typeof progress.id === 'string' && typeof progress.text === 'string') onProgress?.(progress);
        } else if (data && event === 'commentary') {
          const commentary = JSON.parse(data) as CommentaryEvent;
          if (commentary.type === 'commentary' && typeof commentary.id === 'string' && typeof commentary.text === 'string' && commentary.text.length <= 160 && commentary.text.trim()) onProgress?.(commentary);
        } else if (data && event === 'error') {
          const payload = JSON.parse(data) as { status?: unknown; message?: unknown; code?: unknown; retryAt?: unknown };
          throw new ChatApiError(
            typeof payload.status === 'number' ? payload.status : response.status || 503,
            typeof payload.message === 'string' ? payload.message : undefined,
            typeof payload.code === 'string' ? payload.code : undefined,
            typeof payload.retryAt === 'string' ? payload.retryAt : undefined,
          );
        } else if (data && event === 'done') {
          finalAnswer = parseAnswer(JSON.parse(data));
        }
        boundary = buffer.indexOf('\n\n');
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
  if (!finalAnswer) throw new Error('Stream ended without an answer');
  return finalAnswer;
}

async function conversationRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/chat/conversations${path}`, { ...options, cache: 'no-store' });
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<T>;
}

export const conversationApi = {
  list: () => conversationRequest<ConversationItem[]>(''),
  create: () => conversationRequest<ConversationItem>('', { method: 'POST' }),
  messages: (id: string) => conversationRequest<ConversationMessage[]>(`/${encodeURIComponent(id)}/messages`),
  runs: (id: string) => conversationRequest<ConversationRun[]>(`/${encodeURIComponent(id)}/runs`),
  remove: async (id: string) => {
    const response = await fetch(`/api/chat/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) throw await responseError(response);
  },
};
