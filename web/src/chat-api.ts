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

export class ChatApiError extends Error {
  constructor(readonly status: number) {
    super(`Chat API returned HTTP ${status}`);
  }
}

export async function askQuestion(question: string): Promise<ChatAnswer> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new ChatApiError(response.status);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object') throw new Error('Invalid chat response');
  const answer = payload as Record<string, unknown>;
  if (typeof answer.answer !== 'string' || typeof answer.refused !== 'boolean' || !Array.isArray(answer.citations)) {
    throw new Error('Invalid chat response');
  }
  return answer as unknown as ChatAnswer;
}
