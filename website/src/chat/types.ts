export interface Citation {
  chunkId: number;
  documentId: number;
  documentTitle: string;
  originalFilename: string;
  sourceStartLine: number;
  sourceEndLine: number;
}
export interface ProductRequestContext {
  productIds?: string[];
  productReferences?: Array<{ productId: string; offset: number; length?: number }>;
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
export interface CommentaryEvent { type: "commentary"; id: string; text: string }
export type ProcessEvent = ProgressEvent | CommentaryEvent;
export interface ChatAnswer {
  answer: string;
  refused: boolean;
  citations: Citation[];
  progressEvents?: ProcessEvent[];
  usage?: ModelUsage;
  context?: ContextEstimate;
}
export interface ContextEstimate {
  contextWindowTokens: number;
  inputBudgetTokens: number;
  estimatedInputTokens: number;
  remainingInputTokens: number;
  usagePercent: number;
  pressure: "normal" | "elevated" | "high" | "overflow";
  measurementSource: "heuristic";
}
export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reservedTokens: number;
  unknownModelCalls: number;
  accounting: "actual" | "pending" | "incomplete";
  includesSummary: boolean;
}
export interface ChatStatus {
  service: "ready";
  canSend: boolean;
  code: string;
  retryAt: string | null;
  checkedAt: string;
  modelHealth: "not_probed";
}
export interface WebsiteQuota {
  scope: "website-shared";
  startAt: string;
  resetAt: string;
  timezone: "Asia/Shanghai";
  checkedAt: string;
  requests: number;
  requestLimit: number;
  remainingRequests: number;
  totalTokens: number;
  reservedTokens: number;
  tokenLimit: number | null;
  remainingTokens: number | null;
  unknownModelCalls: number;
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
  progressEvents?: ProcessEvent[];
  createdAt: string;
  context?: ProductRequestContext & { products?: Array<{ id: string; name: string }> };
}
export interface ConversationRun {
  id: string;
  clientRequestId: string;
  question: string;
  context?: ProductRequestContext;
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
  commentary?: (event: CommentaryEvent) => void;
  started: (citations: Citation[]) => void;
}
export interface ChatApi {
  status?: () => Promise<ChatStatus>;
  quota?: () => Promise<WebsiteQuota>;
  list: () => Promise<ConversationItem[]>;
  create: () => Promise<ConversationItem>;
  messages: (id: string) => Promise<ChatMessage[]>;
  runs: (id: string) => Promise<ConversationRun[]>;
  context?: (id: string) => Promise<ContextEstimate | null>;
  remove: (id: string) => Promise<void>;
  presentation: () => Promise<Presentation>;
  stream: (
    id: string,
    question: string,
    requestId: string,
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
    context?: ProductRequestContext,
  ) => Promise<ChatAnswer>;
}
