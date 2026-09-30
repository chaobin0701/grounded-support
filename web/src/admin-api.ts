export interface AdminMe {
  id: number;
  email: string;
  displayName: string;
  roles: { id: number; code: string; name: string }[];
  permissionCodes: string[];
}

export interface DocumentItem {
  id: number;
  title: string;
  originalFilename: string;
  byteSize: number;
  uploadedBy: number;
  status: string;
  characterCount?: number;
  chunkCount?: number;
  errorMessage: string | null;
  parserVersion?: string | null;
  sourceType?: 'file' | 'faq';
  enabledForRetrieval?: boolean;
  chunkOverride?: {
    chunkMode?: 'general' | 'parent_child';
    separatorMode?: 'auto' | 'heading_paragraph' | 'fixed';
    preserveHeading?: boolean;
    chunkChars?: number;
    overlapChars?: number;
  } | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentDetail extends DocumentItem {
  extractedText: string | null;
  chunkCount: number;
}

export interface DocumentChunk {
  id: number;
  ordinal: number;
  headingPath: string;
  content: string;
  sourceStartLine: number;
  sourceEndLine: number;
}

export interface RoleItem {
  id: number;
  code: string;
  name: string;
  isSystem: boolean;
  permissionCodes: string[];
}

export interface AdminItem {
  id: number;
  email: string;
  displayName: string;
  disabledAt: string | null;
  roles: { id: number; code: string }[];
}

export interface PermissionItem { code: string; description: string }
export interface AdminProductItem {
  id: string;
  brand: string;
  name: string;
  category: string;
  summary: string;
  description: string;
  suggestedPrice: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  specifications: Record<string, string>;
  displayOrder: number;
  enabled: boolean;
  updatedAt: string;
}
export interface AuditItem {
  id: number;
  actorAdminId: number;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface ChatTraceItem {
  id: string;
  kind: 'answer' | 'summary';
  conversationId: string | null;
  question: string;
  model: string | null;
  finalAnswer: string | null;
  refused: boolean | null;
  status: 'completed' | 'failed';
  errorCode: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  durationMs: number;
  createdAt: string;
}

export interface ChatTraceDetail extends ChatTraceItem {
  contextSnapshot: {
    contextBudget?: {
      contextWindowTokens: number;
      inputBudgetTokens: number;
      maxOutputTokens: number;
      safetyBufferTokens: number;
      estimatedInputTokens: number;
      rawMessageCount: number;
      includedMessageCount: number;
      measurementSource: 'heuristic' | string;
      pressure: 'normal' | 'elevated' | 'high' | 'overflow' | string;
      compacted: boolean;
      summaryCheckpointId: string | null;
      summarizedThroughSequence: number | null;
    };
    contextBudgets?: Array<{
      purpose: 'planner' | 'answer' | 'summary' | string;
      plannerRound?: number;
      contextWindowTokens: number;
      inputBudgetTokens: number;
      estimatedInputTokens: number;
      pressure: string;
      compacted: boolean;
    }>;
    promptVersion?: string;
    systemPrompt?: string;
    previousSummary?: string;
    messages?: { role: string; content: string }[];
    summary?: string;
    history?: { question: string; answer: string }[];
    recentMessages?: { role: string; content: string }[];
    retrievalQuery?: string;
    sources?: { chunkId: number; title: string; heading: string; content: string }[];
    dataSource?: string;
    toolCalls?: { name: string; arguments: Record<string, unknown>; ok: boolean; durationMs: number }[];
    executionSteps?: {
      type: 'skill_selection' | 'preflight' | 'llm_call' | 'tool_call' | 'validation';
      stage: 'planning' | 'final_answer' | 'tool' | 'answer_guard';
      skillId?: string;
      selectedBy?: string;
      query?: string | null;
      hitCount?: number;
      retrievalMode?: string;
      name?: string;
      model?: string;
      ok: boolean;
      durationMs: number;
      inputTokens?: number | null;
      outputTokens?: number | null;
      totalTokens?: number | null;
      finishReason?: string | null;
      attempts?: number;
      arguments?: Record<string, unknown>;
      result?: unknown;
      errorCode?: string;
      detail?: string;
      plannerRound?: number;
      toolBatchId?: string;
      toolIndex?: number;
    }[];
    categories?: { id: string; name: string }[];
    products?: { id: string; name: string }[];
    productDetails?: { id: string; name: string; specifications: Record<string, string> }[];
    modelCalls?: unknown[];
  };
  rawModelOutput: string | null;
}

export interface ConversationListItem {
  id: string; title: string; updatedAt: string; createdAt: string; visitorSessionId: string; busyUntil: string | null;
  messageCount: number; turnCount: number; lastQuestion: string | null; lastStatus: string | null;
  lastRefused: boolean | null; lastTraceId: string | null; hasFailed: boolean; hasRefused: boolean; clientType: string;
}
export interface ConversationDetail {
  id: string; visitorSessionId: string; title: string; summary: string; busyUntil: string | null;
  createdAt: string; updatedAt: string;
  messages: { id: number; role: string; content: string; refused: boolean | null; citations: unknown; toolSteps: unknown; progressEvents: unknown; createdAt: string }[];
  runs: { id: string; clientRequestId: string; question: string; status: string; startedAt: string | null; finishedAt: string | null; errorCode: string | null; userMessageId: number | null; assistantMessageId: number | null; createdAt: string }[];
  traces: { id: string; kind: string; userMessageId: number | null; question: string; finalAnswer: string | null; refused: boolean | null; status: string; errorCode: string | null; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; durationMs: number; createdAt: string }[];
}

export interface DebugFinding {
  code: string;
  severity: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  conversationId?: string;
  traceId?: string;
}

export interface DebugMetrics {
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  runCount: number;
  failedRunCount: number;
  activeRunCount: number;
  traceCount: number;
  failedTraceCount: number;
  refusedTraceCount: number;
  toolCallCount: number;
  modelCallCount: number;
  totalDurationMs: number;
  totalTokens: number;
}

export interface DebugMessage {
  id: number;
  role: string;
  content: string;
  refused: boolean | null;
  citations: unknown;
  toolSteps: unknown;
  progressEvents: unknown;
  createdAt: string;
}

export interface DebugRun {
  id: string;
  clientRequestId: string;
  question: string;
  status: string;
  expiresAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  userMessageId: number | null;
  assistantMessageId: number | null;
  createdAt: string;
}

export interface DebugTrace {
  id: string;
  kind: string;
  conversationId: string | null;
  userMessageId: number | null;
  question: string;
  contextSnapshot: Record<string, unknown>;
  model: string | null;
  rawModelOutput: string | null;
  finalAnswer: string | null;
  refused: boolean | null;
  status: string;
  errorCode: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  durationMs: number;
  createdAt: string;
}

export interface DebugConversation {
  id: string;
  visitorSessionId: string;
  title: string;
  summary: string;
  busyUntil: string | null;
  createdAt: string;
  updatedAt: string;
  messages: DebugMessage[];
  runs: DebugRun[];
  traces: DebugTrace[];
  findings: DebugFinding[];
  metrics: DebugMetrics;
}

export interface DebugInspection {
  requestedIds: string[];
  requestedConversationIds: string[];
  resolvedConversationIds: string[];
  focusTraceIds: string[];
  notFoundIds: string[];
  requestedTraceIds: string[];
  notFoundTraceIds: string[];
  issueDescription: string;
  inspectedAt: string;
  conversations: DebugConversation[];
  diagnostics: { findings: DebugFinding[]; metrics: DebugMetrics };
}

export class AdminApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`/api/admin${path}`, { ...options, headers, cache: 'no-store' });
  } catch {
    throw new AdminApiError(0, '网络连接失败，请重试');
  }
  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`;
    try {
      const body = await response.json() as { message?: string | string[] };
      if (typeof body.message === 'string') message = body.message;
      else if (Array.isArray(body.message)) message = body.message.join('；');
    } catch { /* Keep the HTTP status if the server did not return JSON. */ }
    throw new AdminApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

export const adminApi = {
  login: (email: string, password: string) => request<{ accessToken: string; expiresIn: number }>('/auth/login', {
    method: 'POST', body: JSON.stringify({ email, password }),
  }),
  me: (token: string) => request<AdminMe>('/auth/me', {}, token),
  documents: (token: string, offset: number) => request<DocumentItem[]>(`/documents?limit=50&offset=${offset}`, {}, token),
  document: (token: string, id: number) => request<DocumentDetail>(`/documents/${id}`, {}, token),
  chunks: (token: string, id: number) => request<DocumentChunk[]>(`/documents/${id}/chunks`, {}, token),
  upload: (token: string, file: File, title: string) => {
    const body = new FormData();
    body.append('file', file);
    if (title.trim()) body.append('title', title.trim());
    return request<{ id: number; status: string }>('/documents', { method: 'POST', body }, token);
  },
  archive: (token: string, id: number) => request(`/documents/${id}/archive`, { method: 'PATCH' }, token),
  retry: (token: string, id: number) => request(`/documents/${id}/retry`, { method: 'POST' }, token),
  reprocess: (token: string, id: number) => request(`/documents/${id}/reprocess`, { method: 'POST' }, token),
  roles: (token: string) => request<RoleItem[]>('/roles', {}, token),
  permissions: (token: string) => request<PermissionItem[]>('/permissions', {}, token),
  createRole: (token: string, input: { code: string; name: string; permissionCodes: string[] }) => request('/roles', { method: 'POST', body: JSON.stringify(input) }, token),
  updateRole: (token: string, id: number, input: { name: string; permissionCodes: string[] }) => request(`/roles/${id}`, { method: 'PATCH', body: JSON.stringify(input) }, token),
  admins: (token: string) => request<AdminItem[]>('/admins', {}, token),
  createAdmin: (token: string, input: { email: string; displayName: string; password: string; roleIds: number[] }) => request('/admins', { method: 'POST', body: JSON.stringify(input) }, token),
  assignRoles: (token: string, id: number, roleIds: number[]) => request(`/admins/${id}/roles`, { method: 'PATCH', body: JSON.stringify({ roleIds }) }, token),
  setStatus: (token: string, id: number, disabled: boolean) => request(`/admins/${id}/status`, { method: 'PATCH', body: JSON.stringify({ disabled }) }, token),
  audit: (token: string) => request<AuditItem[]>('/audit?limit=50', {}, token),
  products: (token: string) => request<AdminProductItem[]>('/products', {}, token),
  chatTraces: (token: string) => request<ChatTraceItem[]>('/chat-traces?limit=50', {}, token),
  chatTrace: (token: string, id: string) => request<ChatTraceDetail>(`/chat-traces/${encodeURIComponent(id)}`, {}, token),
  debugInspect: (token: string, input: { conversationIds?: string[]; traceIds?: string[]; issueDescription?: string }) => request<DebugInspection>('/debug/inspect', { method: 'POST', body: JSON.stringify(input) }, token),
  conversations: (token: string, params: { limit?: number; offset?: number; q?: string; status?: string; visitorId?: string; device?: string; since?: string } = {}) => request<{ items: ConversationListItem[]; filters: { visitorId: string; conversationCount: number; clientType: string }[]; pagination: { limit: number; offset: number; hasMore: boolean } }>(`/conversations?limit=${params.limit ?? 30}&offset=${params.offset ?? 0}&q=${encodeURIComponent(params.q ?? '')}&status=${params.status ?? 'all'}&visitorId=${encodeURIComponent(params.visitorId ?? '')}&device=${params.device ?? 'all'}&since=${encodeURIComponent(params.since ?? '')}`, {}, token),
  conversation: (token: string, id: string) => request<ConversationDetail>(`/conversations/${encodeURIComponent(id)}`, {}, token),
};
