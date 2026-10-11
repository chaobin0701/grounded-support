import type {
  ChatApi,
  ChatAnswer,
  ChatMessage,
  Citation,
  ConversationItem,
  ConversationRun,
  Presentation,
  ProgressEvent,
  CommentaryEvent,
  StreamCallbacks,
  ModelUsage,
  ContextEstimate,
} from "./types.ts";
import { isChatStatus, isWebsiteQuota } from "./quota.ts";

export class ChatApiError extends Error {
  status: number;
  code?: string;
  retryAt?: string;
  constructor(status: number, message = "聊天服务暂时无法连接，请稍后重试。", code?: string, retryAt?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAt = retryAt;
  }
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}
function citations(value: unknown): Citation[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item) =>
      object(item) &&
      Number.isInteger(item.chunkId) &&
      typeof item.documentTitle === "string" &&
      typeof item.originalFilename === "string",
  ) as Citation[];
}
export function parseAnswer(value: unknown): ChatAnswer {
  if (
    !object(value) ||
    typeof value.answer !== "string" ||
    typeof value.refused !== "boolean" ||
    !Array.isArray(value.citations)
  )
    throw new ChatApiError(502, "回答数据不完整，请检查上一轮状态。");
  return {
    answer: value.answer,
    refused: value.refused,
    citations: citations(value.citations),
    progressEvents: Array.isArray(value.progressEvents)
      ? value.progressEvents.filter(value => isProgress(value) || isCommentary(value))
      : [],
    ...(isUsage(value.usage) ? { usage: value.usage } : {}),
    ...(isContextEstimate(value.context) ? { context: value.context } : {}),
  };
}
function isUsage(value: unknown): value is ModelUsage {
  return object(value)
    && ["inputTokens", "outputTokens", "totalTokens", "reservedTokens", "unknownModelCalls"].every((key) => typeof value[key] === "number" && Number.isSafeInteger(value[key]) && Number(value[key]) >= 0)
    && ["actual", "pending", "incomplete"].includes(String(value.accounting)) && typeof value.includesSummary === "boolean";
}
function isContextEstimate(value: unknown): value is ContextEstimate {
  return object(value)
    && ["contextWindowTokens", "inputBudgetTokens", "estimatedInputTokens", "remainingInputTokens", "usagePercent"].every((key) => typeof value[key] === "number" && Number.isFinite(value[key]) && value[key] >= 0)
    && ["normal", "elevated", "high", "overflow"].includes(String(value.pressure))
    && value.measurementSource === "heuristic";
}
function isProgress(value: unknown): value is ProgressEvent {
  return (
    object(value) &&
    value.type === "progress" &&
    typeof value.id === "string" &&
    typeof value.text === "string" &&
    ["planning", "preflight", "tool", "answer"].includes(String(value.stage)) &&
    ["running", "completed"].includes(String(value.status))
  );
}
function isCommentary(value: unknown): value is CommentaryEvent {
  return object(value) && value.type === "commentary" && typeof value.id === "string"
    && typeof value.text === "string" && !!value.text.trim();
}
async function request(
  path: string,
  options: RequestInit = {},
  streaming = false,
) {
  let response: Response;
  try {
    response = await fetch(`/api/chat${path}`, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal
        ? AbortSignal.any([
            options.signal,
            AbortSignal.timeout(streaming ? 65_000 : 10_000),
          ])
        : AbortSignal.timeout(streaming ? 65_000 : 10_000),
    });
  } catch {
    throw new ChatApiError(0, "连接中断或请求超时，请检查上一轮状态。");
  }
  if (!response.ok) {
    let message = "聊天服务暂时不可用，请稍后重试。";
    let code: string | undefined, retryAt: string | undefined;
    try {
      const data: unknown = await response.json();
      const detail = object(data) && object(data.error) ? data.error : data;
      if (object(detail)) {
        if (typeof detail.message === "string") message = detail.message;
        if (typeof detail.code === "string") code = detail.code;
        if (typeof detail.retryAt === "string") retryAt = detail.retryAt;
      }
    } catch {
      /* Status is still usable. */
    }
    throw new ChatApiError(response.status, message, code, retryAt);
  }
  return response;
}
async function json(path: string, options?: RequestInit): Promise<unknown> {
  const response = await request(path, options);
  try {
    return await response.json();
  } catch {
    throw new ChatApiError(502, "聊天资料格式异常，请稍后重试。");
  }
}
function item(value: unknown): value is ConversationItem {
  return (
    object(value) &&
    ["id", "title", "summary", "createdAt", "updatedAt"].every(
      (key) => typeof value[key] === "string",
    )
  );
}

// Parse UTF-8 and frame boundaries incrementally, including CRLF split across network chunks.
export async function readAnswerStream(
  response: Response,
  callbacks: StreamCallbacks,
): Promise<ChatAnswer> {
  if (!response.body) throw new ChatApiError(502, "当前连接不支持流式回答。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer: ChatAnswer | undefined;
  // Planner commentary arrives as small deltas while the model is deciding
  // which tools to call. Keep the wire protocol incremental, but expose the
  // same complete CommentaryEvent shape to the UI and persisted history.
  const commentaryBuffers = new Map<string, string>();
  function emitCommentary(id: string, text: string, replace = false) {
    if (!id || typeof text !== "string") return;
    const next = replace ? text : `${commentaryBuffers.get(id) ?? ""}${text}`;
    if (next === commentaryBuffers.get(id)) return;
    commentaryBuffers.set(id, next);
    if (next.trim()) callbacks.commentary?.({ type: "commentary", id, text: next });
  }
  function frame(text: string) {
    let event = "message";
    const data: string[] = [];
    for (const line of text.split(/\r?\n/u)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /u, ""));
    }
    if (!data.length) return;
    if (
      ![
        "delta",
        "answer_delta",
        "answer_started",
        "progress",
        "commentary",
        "commentary_started",
        "commentary_delta",
        "commentary_completed",
        "error",
        "done",
      ].includes(event)
    )
      return;
    let payload: unknown;
    try {
      payload = JSON.parse(data.join("\n"));
    } catch {
      throw new ChatApiError(502, "流式回答格式异常，请检查上一轮状态。");
    }
    if (event === "done") answer = parseAnswer(payload);
    else if (event === "error")
      throw new ChatApiError(
        object(payload) && typeof payload.status === "number"
          ? payload.status
          : 503,
        object(payload) && typeof payload.message === "string"
          ? payload.message
          : undefined,
        object(payload) && typeof payload.code === "string" ? payload.code : undefined,
        object(payload) && typeof payload.retryAt === "string" ? payload.retryAt : undefined,
      );
    else if (event === "progress" && isProgress(payload))
      callbacks.progress(payload);
    else if (event === "commentary" && isCommentary(payload))
      emitCommentary(payload.id, payload.text, true);
    else if (event === "commentary_started" && object(payload) && typeof payload.id === "string") {
      commentaryBuffers.set(payload.id, "");
    } else if (event === "commentary_delta" && object(payload)
      && typeof payload.id === "string" && typeof payload.text === "string") {
      emitCommentary(payload.id, payload.text);
    } else if (event === "commentary_completed" && object(payload)
      && typeof payload.id === "string" && typeof payload.text === "string") {
      emitCommentary(payload.id, payload.text, true);
    }
    else if (event === "answer_started" && object(payload))
      callbacks.started(citations(payload.citations));
    else if (event === "delta" || event === "answer_delta") {
      if (!object(payload) || typeof payload.text !== "string")
        throw new ChatApiError(502, "流式文字格式异常，请检查上一轮状态。");
      callbacks.delta(payload.text);
    }
  }
  try {
    while (!answer) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary = /\r?\n\r?\n/u.exec(buffer);
      while (boundary) {
        const next = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        frame(next);
        if (answer) break;
        boundary = /\r?\n\r?\n/u.exec(buffer);
      }
      if (done) {
        if (!answer && buffer.trim()) frame(buffer);
        break;
      }
    }
    if (!answer)
      throw new ChatApiError(502, "连接已结束，但回答尚未确认完成。");
    return answer;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export const chatApi: ChatApi = {
  async status() {
    const data = await json("/status");
    if (!isChatStatus(data)) throw new ChatApiError(502, "服务状态格式异常。");
    return data;
  },
  async quota() {
    const data = await json("/quota");
    if (!isWebsiteQuota(data)) throw new ChatApiError(502, "额度数据格式异常。");
    return data;
  },
  async context(id) {
    const data = await json(`/conversations/${encodeURIComponent(id)}/context`);
    if (data === null) return null;
    if (!isContextEstimate(data)) throw new ChatApiError(502, "上下文估算格式异常。");
    return data;
  },
  async list() {
    const data = await json("/conversations");
    if (!Array.isArray(data) || !data.every(item))
      throw new ChatApiError(502, "会话列表格式异常。");
    return data;
  },
  async create() {
    const data = await json("/conversations", { method: "POST" });
    if (!item(data)) throw new ChatApiError(502, "无法确认新会话。");
    return data;
  },
  async messages(id) {
    const data = await json(
      `/conversations/${encodeURIComponent(id)}/messages`,
    );
    if (
      !Array.isArray(data) ||
      !data.every(
        (value) =>
          object(value) &&
          typeof value.id === "number" &&
          ["user", "assistant"].includes(String(value.role)) &&
          typeof value.content === "string" &&
          typeof value.createdAt === "string",
      )
    )
      throw new ChatApiError(502, "会话消息格式异常。");
    return data.map((value) => ({
      ...value,
      citations: citations(value.citations),
      progressEvents: Array.isArray(value.progressEvents)
        ? value.progressEvents.filter((event: unknown) => isProgress(event) || isCommentary(event))
        : [],
    })) as ChatMessage[];
  },
  async runs(id) {
    const data = await json(`/conversations/${encodeURIComponent(id)}/runs`);
    if (
      !Array.isArray(data) ||
      !data.every(
        (value) =>
          object(value) &&
          typeof value.id === "string" &&
          typeof value.clientRequestId === "string" &&
          typeof value.question === "string" &&
          typeof value.expiresAt === "string" &&
          [
            "queued",
            "running",
            "completed",
            "failed",
            "interrupted",
            "expired",
          ].includes(String(value.status)),
      )
    )
      throw new ChatApiError(502, "请求状态格式异常。");
    return data as ConversationRun[];
  },
  async remove(id) {
    await request(`/conversations/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
  async presentation() {
    const data = await json("/presentation");
    if (
      !object(data) ||
      typeof data.title !== "string" ||
      typeof data.description !== "string" ||
      !Array.isArray(data.suggestedQuestions) ||
      !data.suggestedQuestions.every((value) => typeof value === "string")
    )
      throw new ChatApiError(502, "欢迎信息格式异常。");
    return data as unknown as Presentation;
  },
  async stream(id, question, requestId, callbacks, signal, context) {
    const response = await request(
      `/conversations/${encodeURIComponent(id)}/messages/stream`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "Idempotency-Key": requestId,
        },
        body: JSON.stringify({ question, ...(context?.productIds?.length ? { context } : {}) }),
        signal,
      },
      true,
    );
    try {
      return await readAnswerStream(response, callbacks);
    } catch (error) {
      if (error instanceof ChatApiError) throw error;
      throw new ChatApiError(0, "流式连接中断，请检查上一轮状态。");
    }
  },
};
