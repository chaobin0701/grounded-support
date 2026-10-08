export interface Citation {
  chunkId: number;
  documentId: number;
  documentTitle: string;
  originalFilename: string;
  sourceStartLine: number;
  sourceEndLine: number;
}
export interface ProgressEvent {
  type: "progress";
  id: string;
  operationId?: string;
  stage: "planning" | "preflight" | "tool" | "answer";
  status: "running" | "completed";
  text: string;
  tool?: string;
  durationMs?: number;
  resultCount?: number;
}
export interface ChatAnswer {
  answer: string;
  refused: boolean;
  citations: Citation[];
  progressEvents?: ProgressEvent[];
}
export interface ConversationItem {
  id: string;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
}
export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  refused: boolean | null;
  citations: Citation[];
  progressEvents?: ProgressEvent[];
  createdAt: string;
}
export interface ConversationRun {
  id: string;
  clientRequestId: string;
  question: string;
  status:
    "queued" | "running" | "completed" | "failed" | "interrupted" | "expired";
  expiresAt: string;
  createdAt: string;
}
export interface Presentation {
  title: string;
  description: string;
  suggestedQuestions: string[];
}
export interface StreamCallbacks {
  delta: (text: string) => void;
  progress: (event: ProgressEvent) => void;
  started: (citations: Citation[]) => void;
}
export interface ChatApi {
  list: () => Promise<ConversationItem[]>;
  create: () => Promise<ConversationItem>;
  messages: (id: string) => Promise<ChatMessage[]>;
  runs: (id: string) => Promise<ConversationRun[]>;
  remove: (id: string) => Promise<void>;
  presentation: () => Promise<Presentation>;
  stream: (
    id: string,
    question: string,
    requestId: string,
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
  ) => Promise<ChatAnswer>;
}
