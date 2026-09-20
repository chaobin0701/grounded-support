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
}

export interface PreviousTurn { question: string; answer: string }
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
  createdAt: string;
}

export class ChatApiError extends Error {
  constructor(readonly status: number) {
    super(`Chat API returned HTTP ${status}`);
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

export async function askQuestion(question: string, history: PreviousTurn[] = []): Promise<ChatAnswer> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, history }),
    signal: AbortSignal.timeout(65_000),
  });
  if (!response.ok) throw new ChatApiError(response.status);
  return parseAnswer(await response.json());
}

export async function askInConversation(conversationId: string, question: string): Promise<ChatAnswer> {
  const response = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
    signal: AbortSignal.timeout(65_000),
  });
  if (!response.ok) throw new ChatApiError(response.status);
  return parseAnswer(await response.json());
}

export async function askInConversationStream(conversationId: string, question: string, onDelta: (text: string) => void): Promise<ChatAnswer> {
  const response = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/messages/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ question }),
    signal: AbortSignal.timeout(65_000),
  });
  if (!response.ok) throw new ChatApiError(response.status);
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
        if (data && event === 'delta') {
          const payload = JSON.parse(data) as { text?: unknown };
          if (typeof payload.text !== 'string') throw new Error('Invalid stream delta');
          onDelta(payload.text);
        } else if (data && event === 'error') {
          throw new ChatApiError(503);
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
  if (!response.ok) throw new ChatApiError(response.status);
  return response.json() as Promise<T>;
}

export const conversationApi = {
  list: () => conversationRequest<ConversationItem[]>(''),
  create: () => conversationRequest<ConversationItem>('', { method: 'POST' }),
  messages: (id: string) => conversationRequest<ConversationMessage[]>(`/${encodeURIComponent(id)}/messages`),
  remove: async (id: string) => {
    const response = await fetch(`/api/chat/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) throw new ChatApiError(response.status);
  },
};
