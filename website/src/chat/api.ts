import type {
  ChatApi,
  ChatAnswer,
  ChatMessage,
  Citation,
  ConversationItem,
  ConversationRun,
  Presentation,
  ProgressEvent,
  StreamCallbacks,
} from "./types.ts";

export class ChatApiError extends Error {
  status: number;
  constructor(status: number, message = "聊天服务暂时无法连接，请稍后重试。") {
    super(message);
    this.status = status;
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
      ? value.progressEvents.filter(isProgress)
      : [],
  };
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
    try {
      const data: unknown = await response.json();
      if (object(data) && typeof data.message === "string")
        message = data.message;
    } catch {
      /* Status is still usable. */
    }
    throw new ChatApiError(response.status, message);
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
      );
    else if (event === "progress" && isProgress(payload))
      callbacks.progress(payload);
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
        ? value.progressEvents.filter(isProgress)
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
  async stream(id, question, requestId, callbacks, signal) {
    const response = await request(
      `/conversations/${encodeURIComponent(id)}/messages/stream`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "Idempotency-Key": requestId,
        },
        body: JSON.stringify({ question }),
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
