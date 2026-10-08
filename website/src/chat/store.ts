import { reactive } from "vue";
import { ChatApiError } from "./api.ts";
import type {
  ChatApi,
  ChatMessage,
  Citation,
  ConversationItem,
  ProgressEvent,
} from "./types.ts";

export const ACTIVE_KEY = "grounded.activeConversationId";
export const PENDING_KEY = "grounded.pendingChatRequest";
export const DRAFT_PREFIX = "grounded.draftInput.";
type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Pending = { conversationId: string; requestId: string; question: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const fallbackSuggestions = [
  "你们有哪些产品？",
  "取暖产品有哪些区别？",
  "空气净化器和新风机有什么区别？",
];

export function createChatStore(
  api: ChatApi,
  storage?: BrowserStorage,
  options: { pollMs?: number; recoveryLimitMs?: number } = {},
) {
  const state = reactive({
    activeId: null as string | null,
    conversations: [] as ConversationItem[],
    messages: [] as ChatMessage[],
    draft: "",
    partialAnswer: "",
    partialCitations: [] as Citation[],
    progress: [] as ProgressEvent[],
    loading: false,
    ready: false,
    isSending: false,
    recovering: false,
    unresolved: false,
    switching: false,
    deletingId: null as string | null,
    error: "",
    notice: "",
    widgetOpen: false,
    suggestions: [...fallbackSuggestions],
  });
  let initial: Promise<void> | undefined;
  let localId = -1;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let recoveryDeadline = 0;
  let recoveryErrors = 0;
  let disposed = false;
  let restoredDraft = false;
  let controller: AbortController | undefined;
  function get(key: string) {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  function put(key: string, value: string | null) {
    try {
      if (value === null) storage?.removeItem(key);
      else storage?.setItem(key, value);
    } catch {
      if (!state.notice)
        state.notice = "浏览器存储不可用，刷新后可能无法恢复草稿。";
    }
  }
  function draftKey(id = state.activeId) {
    return `${DRAFT_PREFIX}${id || "new"}`;
  }
  function setDraft(value: string) {
    restoredDraft = false;
    state.draft = value;
    put(draftKey(), value || null);
  }
  function restoreDraft(value: string) {
    if (!state.draft) {
      setDraft(value);
      restoredDraft = true;
    }
  }
  function pending(): Pending | null {
    try {
      const value = JSON.parse(get(PENDING_KEY) || "null");
      if (
        value &&
        typeof value.conversationId === "string" &&
        uuid.test(value.conversationId) &&
        typeof value.requestId === "string" &&
        typeof value.question === "string"
      )
        return value;
    } catch {
      /* Malformed storage is not trusted. */
    }
    return null;
  }
  function clearPending(id = state.activeId) {
    if (pending()?.conversationId === id) put(PENDING_KEY, null);
  }
  function resetPartial() {
    state.partialAnswer = "";
    state.partialCitations = [];
    state.progress = [];
  }
  function busy() {
    return (
      state.isSending ||
      state.recovering ||
      state.switching ||
      state.loading ||
      !!state.deletingId
    );
  }
  function stopPolling() {
    clearTimeout(pollTimer);
    pollTimer = undefined;
  }
  function report(error: unknown) {
    if (error instanceof ChatApiError) {
      if (error.status === 429) return "提问有些频繁，请稍后再试。";
      if (error.status === 409) return "上一轮仍在处理中，正在检查保存状态。";
      if (error.status === 404)
        return "这段会话不存在或已被删除，可以新建会话。";
      if (error.status === 400) return "问题格式不正确，请检查后重新发送。";
    }
    return error instanceof Error
      ? error.message
      : "聊天服务暂时不可用，请稍后重试。";
  }
  async function refreshList() {
    state.conversations = await api.list();
  }
  function newConversation() {
    if (busy()) return false;
    stopPolling();
    state.activeId = null;
    state.messages = [];
    state.error = "";
    state.unresolved = false;
    resetPartial();
    put(ACTIVE_KEY, "new");
    state.draft = get(draftKey(null)) || "";
    return true;
  }
  async function openConversation(id: string) {
    if (busy() || state.activeId === id) return;
    state.switching = true;
    state.error = "";
    stopPolling();
    try {
      const messages = await api.messages(id);
      if (disposed) return;
      state.activeId = id;
      state.messages = messages;
      state.draft = get(draftKey(id)) || "";
      put(ACTIVE_KEY, id);
      resetPartial();
      state.unresolved = false;
      await checkRecovery();
    } catch (error) {
      state.error = report(error);
      if (
        error instanceof ChatApiError &&
        error.status === 404 &&
        state.activeId === id
      ) {
        state.activeId = null;
        state.messages = [];
        put(ACTIVE_KEY, "new");
        state.draft = get(draftKey(null)) || "";
        clearPending(id);
      }
    } finally {
      state.switching = false;
    }
  }
  // Recovery only reads authoritative messages/runs; it never resubmits a model request.
  async function checkRecovery(fresh = true): Promise<void> {
    if (!state.activeId || disposed) return;
    if (fresh) {
      stopPolling();
      recoveryDeadline = Date.now() + (options.recoveryLimitMs ?? 5 * 60_000);
      recoveryErrors = 0;
    }
    const id = state.activeId;
    const saved = pending();
    try {
      const runs = await api.runs(id);
      if (disposed || state.activeId !== id) return;
      const matched =
        saved?.conversationId === id
          ? runs.find((run) => run.clientRequestId === saved.requestId)
          : undefined;
      const run =
        matched ||
        runs.find((run) => run.status === "queued" || run.status === "running");
      recoveryErrors = 0;
      if (!run) {
        state.messages = await api.messages(id);
        state.recovering = false;
        state.unresolved = false;
        if (saved?.conversationId === id) {
          restoreDraft(saved.question);
          if (!state.error)
            state.error =
              "未找到这一轮的运行记录。可以手动重试，系统会沿用请求 ID 避免重复处理。";
        }
        return;
      }
      if (run.status === "completed") {
        if (matched && saved && restoredDraft && state.draft === saved.question)
          setDraft("");
        state.messages = await api.messages(id);
        clearPending(id);
        resetPartial();
        state.recovering = false;
        state.unresolved = false;
        state.error = "";
        state.notice = "已恢复保存的回答";
        try {
          await refreshList();
        } catch {
          /* Messages remain usable. */
        }
        return;
      }
      if (
        run.status === "failed" ||
        run.status === "interrupted" ||
        run.status === "expired"
      ) {
        state.messages = await api.messages(id);
        clearPending(id);
        state.recovering = false;
        state.unresolved = false;
        restoreDraft(
          saved?.conversationId === id ? saved.question : run.question,
        );
        state.error = "上一轮未完成。问题已保留，可以重新发送。";
        return;
      }
      const expires = new Date(run.expiresAt).getTime();
      if (
        Date.now() >= recoveryDeadline ||
        (Number.isFinite(expires) && Date.now() >= expires)
      ) {
        state.recovering = false;
        state.unresolved = true;
        state.error = "上一轮状态暂未确认，请点击“检查上轮状态”，或新建会话。";
        return;
      }
      state.recovering = true;
      state.unresolved = true;
      state.error = "";
      pollTimer = setTimeout(() => {
        void checkRecovery(false);
      }, options.pollMs ?? 2000);
    } catch (error) {
      if (disposed || state.activeId !== id) return;
      if (error instanceof ChatApiError && error.status === 404) {
        state.recovering = false;
        state.unresolved = false;
        clearPending(id);
        state.activeId = null;
        state.messages = [];
        put(ACTIVE_KEY, "new");
        state.error = report(error);
        return;
      }
      if (
        state.recovering &&
        ++recoveryErrors < 3 &&
        Date.now() < recoveryDeadline
      ) {
        pollTimer = setTimeout(() => {
          void checkRecovery(false);
        }, options.pollMs ?? 2000);
      } else {
        state.recovering = false;
        state.unresolved = true;
        state.error =
          "暂时无法确认上一轮结果。请检查网络后点击“检查上轮状态”。";
      }
    }
  }
  function initialize() {
    if (initial) return initial;
    initial = (async () => {
      state.loading = true;
      void api
        .presentation()
        .then((value) => {
          if (!disposed && value.suggestedQuestions.length)
            state.suggestions = value.suggestedQuestions.slice(0, 4);
        })
        .catch(() => {});
      try {
        await refreshList();
        const active = get(ACTIVE_KEY);
        const preferred =
          active === "new" ? null : active || pending()?.conversationId;
        if (preferred && uuid.test(preferred)) {
          state.activeId = preferred;
          try {
            state.messages = await api.messages(preferred);
            state.draft = get(draftKey()) || "";
            await checkRecovery();
          } catch (error) {
            if (error instanceof ChatApiError && error.status === 404) {
              state.activeId = null;
              put(ACTIVE_KEY, "new");
              clearPending(preferred);
            } else state.error = report(error);
          }
        } else {
          put(ACTIVE_KEY, "new");
          state.draft = get(draftKey(null)) || "";
        }
      } catch (error) {
        state.error = "历史会话暂时无法加载，可以重试或直接提问。";
        state.draft = get(draftKey(null)) || "";
      } finally {
        state.loading = false;
        state.ready = true;
      }
    })();
    return initial;
  }
  async function send(value = state.draft) {
    if (busy() || state.unresolved || disposed) return;
    const question = value.trim();
    const length = Array.from(question).length;
    if (length < 2 || length > 2000) {
      state.error = "请输入 2–2000 个字的问题。";
      return;
    }
    state.isSending = true;
    state.error = "";
    resetPartial();
    setDraft("");
    controller = new AbortController();
    let id = state.activeId;
    try {
      if (!id) {
        const created = await api.create();
        id = created.id;
        state.activeId = id;
        put(ACTIVE_KEY, id);
        // A next question typed while creation was in progress belongs to the new conversation.
        put(draftKey(null), null);
        put(draftKey(id), state.draft || null);
      }
      const saved = pending();
      const requestId =
        saved?.conversationId === id && saved.question === question
          ? saved.requestId
          : crypto.randomUUID();
      put(
        PENDING_KEY,
        JSON.stringify({ conversationId: id, requestId, question }),
      );
      state.messages.push({
        id: localId--,
        role: "user",
        content: question,
        refused: null,
        citations: [],
        createdAt: new Date().toISOString(),
      });
      const answer = await api.stream(
        id,
        question,
        requestId,
        {
          delta: (text) => {
            if (!disposed) state.partialAnswer += text;
          },
          started: (value) => {
            if (!disposed) state.partialCitations = value;
          },
          progress: (event) => {
            if (!disposed) state.progress.push(event);
          },
        },
        controller.signal,
      );
      if (disposed) return;
      state.messages.push({
        id: localId--,
        role: "assistant",
        content: answer.answer,
        refused: answer.refused,
        citations: answer.citations,
        progressEvents: answer.progressEvents?.length
          ? answer.progressEvents
          : [...state.progress],
        createdAt: new Date().toISOString(),
      });
      clearPending(id);
      resetPartial();
      state.unresolved = false;
      try {
        await refreshList();
      } catch {
        state.notice = "回答已完成，历史列表稍后可刷新。";
      }
    } catch (error) {
      if (disposed) return;
      state.error = report(error);
      restoreDraft(question);
      if (
        error instanceof ChatApiError &&
        (error.status === 400 || error.status === 429)
      ) {
        clearPending(id);
        state.unresolved = false;
        return;
      }
      if (id) {
        // An error after dispatch may still have saved an answer; never infer success from a repeated question.
        state.unresolved = true;
        await checkRecovery();
      }
    } finally {
      state.isSending = false;
      controller = undefined;
    }
  }
  async function removeConversation(id: string) {
    if (busy()) return;
    state.deletingId = id;
    state.error = "";
    try {
      await api.remove(id);
      state.conversations = state.conversations.filter(
        (item) => item.id !== id,
      );
      put(draftKey(id), null);
      clearPending(id);
      if (state.activeId === id) {
        state.activeId = null;
        state.messages = [];
        state.draft = get(draftKey(null)) || "";
        state.unresolved = false;
        resetPartial();
        put(ACTIVE_KEY, "new");
      }
      state.notice = "会话已删除";
    } catch (error) {
      state.error = report(error);
    } finally {
      state.deletingId = null;
    }
  }
  function openWidget() {
    state.widgetOpen = true;
    void initialize();
  }
  function closeWidget() {
    state.widgetOpen = false;
  }
  function dispose() {
    disposed = true;
    stopPolling();
    controller?.abort();
  }
  return {
    state,
    initialize,
    send,
    setDraft,
    newConversation,
    openConversation,
    removeConversation,
    checkRecovery,
    refreshList,
    openWidget,
    closeWidget,
    busy,
    dispose,
  };
}
export type ChatStore = ReturnType<typeof createChatStore>;
