import { reactive } from "vue";
import { ChatApiError } from "./api.ts";
import { messageDocument, normalizeDocument, serializeMessageDocument, type InlineProduct } from "./inline-document.ts";
import type {
  ChatApi,
  ChatMessage,
  Citation,
  ConversationItem,
  ProcessEvent,
  WebsiteQuota,
  ChatStatus,
  ModelUsage,
  ContextEstimate,
  ProductRequestContext,
} from "./types.ts";

export const ACTIVE_KEY = "grounded.activeConversationId";
export const PENDING_KEY = "grounded.pendingChatRequest";
export const DRAFT_PREFIX = "grounded.draftInput.";
type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type ProductAttachment = InlineProduct;
type Pending = { conversationId: string; requestId: string; question: string; products?: ProductAttachment[]; draft?: string; context?: ProductRequestContext };
export function productAttachments(value: unknown): ProductAttachment[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, ProductAttachment>();
  for (const item of value) {
    if (item && typeof item.id === 'string' && item.id.trim() && item.id.length <= 80 && typeof item.name === 'string') unique.set(item.id.trim(), { id: item.id.trim(), name: item.name.slice(0, 200), ...(Number.isInteger(item.offset) && item.offset >= 0 && item.offset <= 2000 ? { offset: item.offset } : {}) });
  }
  return [...unique.values()].slice(0, 5);
}
function sameProducts(left: ProductAttachment[] = [], right: ProductAttachment[] = []) {
  const identity = (products: ProductAttachment[]) => products.map(p => [p.id, p.offset ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify(identity(left)) === JSON.stringify(identity(right));
}
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
    products: [] as ProductAttachment[],
    partialAnswer: "",
    partialCitations: [] as Citation[],
    progress: [] as ProcessEvent[],
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
    quota: null as WebsiteQuota | null,
    quotaStatus: null as ChatStatus | null,
    lastUsage: null as ModelUsage | null,
    lastContext: null as ContextEstimate | null,
    quotaLoading: false,
    quotaError: "",
  });
  let initial: Promise<void> | undefined;
  let localId = -1;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let recoveryDeadline = 0;
  let recoveryErrors = 0;
  let disposed = false;
  let restoredDraft = false;
  let controller: AbortController | undefined;
  let quotaRequest: Promise<void> | undefined;
  let quotaAgain = false;
  let quotaTimer: ReturnType<typeof setTimeout> | undefined;
  async function refreshQuota(force = false): Promise<void> {
    if (disposed || !api.quota || !api.status) return;
    if (quotaRequest) {
      if (force) quotaAgain = true;
      return quotaRequest;
    }
    if (!force && state.quota && !state.quotaError && Date.now() - Date.parse(state.quota.checkedAt) < 10_000) return;
    state.quotaLoading = true;
    quotaRequest = (async () => {
      try {
        const [quota, status] = await Promise.all([api.quota!(), api.status!()]);
        if (disposed) return;
        state.quota = quota;
        state.quotaStatus = status;
        state.quotaError = "";
        clearTimeout(quotaTimer);
        const reset = Date.parse(quota.resetAt);
        const retry = status.retryAt ? Date.parse(status.retryAt) : Infinity;
        const next = Math.min(reset, retry > Date.now() ? retry : Infinity);
        if (next > Date.now()) quotaTimer = setTimeout(() => { void refreshQuota(true); }, next - Date.now() + 1000);
      } catch {
        if (!disposed) state.quotaError = "额度暂时无法查询";
      } finally {
        state.quotaLoading = false;
        quotaRequest = undefined;
        if (quotaAgain && !disposed) {
          quotaAgain = false;
          void refreshQuota(true);
        }
      }
    })();
    return quotaRequest;
  }
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
  function setComposer(value: string, products: ProductAttachment[]) {
    const doc = normalizeDocument(value, products);
    setDraft(doc.text); setProducts(doc.products);
  }
  function productKey(id = state.activeId) { return `${draftKey(id)}.products`; }
  function readProducts(id = state.activeId): ProductAttachment[] {
    try { return productAttachments(JSON.parse(get(productKey(id)) || '[]')); } catch { return []; }
  }
  function setProducts(value: ProductAttachment[]) {
    state.products = productAttachments(value);
    put(productKey(), state.products.length ? JSON.stringify(state.products) : null);
  }
  function attachProduct(product: ProductAttachment) {
    if (busy() || state.unresolved) { state.notice = '请等待当前请求完成后再关联产品'; return false; }
    if (!state.products.some(p => p.id === product.id) && state.products.length >= 5) { state.notice = '一次最多关联 5 个产品'; return false; }
    const previous = state.products.find(p => p.id === product.id);
    setProducts([...state.products, { ...product, offset: product.offset ?? previous?.offset ?? state.draft.length }]);
    return true;
  }
  function removeProduct(id: string) { setProducts(state.products.filter(p => p.id !== id)); }
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
      ) {
        if (value.draft !== undefined && typeof value.draft !== "string") return null;
        const context = value.context;
        if (context !== undefined) {
          if (!context || typeof context !== "object" || Array.isArray(context)) return null;
          if (context.productIds !== undefined && (!Array.isArray(context.productIds) || context.productIds.length > 5 || !context.productIds.every((id: unknown) => typeof id === "string" && id.trim() && id.length <= 80))) return null;
          if (context.productReferences !== undefined) {
            if (!Array.isArray(context.productReferences) || context.productReferences.length > 5) return null;
            let end = 0;
            const seen = new Set<string>();
            for (const reference of [...context.productReferences].sort((a, b) => (a?.offset ?? 0) - (b?.offset ?? 0))) {
              if (!reference || !context.productIds?.includes(reference.productId) || seen.has(reference.productId) || !Number.isInteger(reference.offset) || reference.offset < end || reference.offset > value.question.length || (reference.length !== undefined && (!Number.isInteger(reference.length) || reference.length < 1 || reference.length > 200 || reference.offset + reference.length > value.question.length))) return null;
              seen.add(reference.productId); end = reference.offset + (reference.length ?? 0);
            }
          }
        }
        return { conversationId: value.conversationId, requestId: value.requestId, question: value.question, draft: value.draft, context, products: productAttachments(value.products) };
      }
    } catch {
      /* Malformed storage is not trusted. */
    }
    return null;
  }
  function pendingDraft(saved: Pending) { return saved.draft ?? saved.question; }
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
  function hasContent() {
    return state.messages.length > 0 || !!state.partialAnswer;
  }
  function stopPolling() {
    clearTimeout(pollTimer);
    pollTimer = undefined;
  }
  function report(error: unknown) {
    if (error instanceof ChatApiError) {
      if (error.status === 429) return error.code ? error.message : "提问有些频繁，请稍后再试。";
      if (error.status === 409) return "上一轮仍在处理中，正在检查保存状态。";
      if (error.status === 404)
        return "这段会话不属于当前浏览器，或已失效。可以直接开始新的对话。";
      if (error.status === 400) return "问题格式不正确，请检查后重新发送。";
    }
    return error instanceof Error
      ? error.message
      : "聊天服务暂时不可用，请稍后重试。";
  }
  async function refreshList() {
    state.conversations = await api.list();
  }
  async function refreshContext(id: string) {
    if (!api.context) return;
    try { state.lastContext = await api.context(id); } catch { /* Context diagnostics are optional and never block chat. */ }
  }
  function newConversation() {
    if (busy()) return false;
    stopPolling();
    state.activeId = null;
    state.messages = [];
    state.error = "";
    state.unresolved = false;
    state.lastContext = null;
    resetPartial();
    put(ACTIVE_KEY, "new");
    state.draft = get(draftKey(null)) || "";
    state.products = readProducts(null);
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
      await refreshContext(id);
      state.draft = get(draftKey(id)) || "";
      state.products = readProducts(id);
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
          restoreDraft(pendingDraft(saved));
          if (!state.products.length && state.draft === pendingDraft(saved)) setProducts(saved.products ?? []);
          if (!state.error)
            state.error =
              "未找到这一轮的运行记录。可以手动重试，系统会沿用请求 ID 避免重复处理。";
        }
        return;
      }
      if (run.status === "completed") {
        if (matched && saved && restoredDraft && state.draft === pendingDraft(saved))
          { setDraft(""); if (sameProducts(state.products, saved.products)) setProducts([]); }
        state.messages = await api.messages(id);
        clearPending(id);
        resetPartial();
        state.recovering = false;
        state.unresolved = false;
        state.error = "";
        state.notice = "已恢复保存的回答";
        void refreshQuota(true);
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
        const recovered = saved?.conversationId === id ? { text: pendingDraft(saved), products: saved.products ?? [] } : messageDocument(run.question, run.context);
        restoreDraft(recovered.text);
        if (!state.products.length && state.draft === recovered.text) setProducts(recovered.products);
        state.error = "上一轮未完成。问题已保留，可以重新发送。";
        void refreshQuota(true);
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
  function initialize(preferredId?: string | null) {
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
      } catch {
        state.error = "历史会话暂时无法加载，可以重试或直接提问。";
      }
      try {
        const active = get(ACTIVE_KEY);
        const preferred = preferredId !== undefined
          ? preferredId
          : active === "new" ? null : active || pending()?.conversationId;
        if (preferred && uuid.test(preferred)) {
          state.activeId = preferred;
          try {
            state.messages = await api.messages(preferred);
            await refreshContext(preferred);
            put(ACTIVE_KEY, preferred);
            state.draft = get(draftKey()) || "";
            await checkRecovery();
          } catch (error) {
            if (error instanceof ChatApiError && error.status === 404) {
              state.activeId = null;
              put(ACTIVE_KEY, "new");
              clearPending(preferred);
              state.draft = get(draftKey(null)) || "";
              state.error = report(error);
            } else state.error = report(error);
          }
        } else {
          put(ACTIVE_KEY, "new");
          state.draft = get(draftKey(null)) || "";
        }
      } catch (error) {
        state.error = "历史会话暂时无法加载，可以重试或直接提问。";
        state.draft = get(draftKey(null)) || "";
        state.products = readProducts(null);
      } finally {
        state.products = readProducts();
        state.loading = false;
        state.ready = true;
        void refreshQuota();
      }
    })();
    return initial;
  }
  async function send(value = state.draft) {
    if (busy() || state.unresolved || disposed) return;
    const doc = normalizeDocument(value, state.products);
    const serialized = serializeMessageDocument(doc);
    let { question, context } = serialized as { question: string; context: ProductRequestContext };
    let products = doc.products;
    const previous = pending();
    // A manual retry of an old pending request must preserve its exact old body/key.
    const legacyReplay = previous?.conversationId === state.activeId && !previous.context?.productReferences?.some(r => r.length !== undefined)
      && previous.question === value.trim() && sameProducts(previous.products, state.products);
    if (legacyReplay && previous) {
      question = previous.question;
      products = previous.products ?? [];
      context = previous.context ?? { productIds: products.map(p => p.id), ...(products.length && products.every(p => p.offset !== undefined) ? { productReferences: products.map(p => ({ productId: p.id, offset: p.offset! })) } : {}) };
    }
    const length = question.length;
    if (length < 2 || length > 2000) {
      state.error = "请输入 2–2000 个字的问题。";
      return;
    }
    state.isSending = true;
    state.error = "";
    resetPartial();
    setDraft("");
    setProducts([]);
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
        put(productKey(null), null);
        put(draftKey(id), state.draft || null);
      }
      const saved = pending();
      const requestId =
        saved?.conversationId === id && saved.question === question && sameProducts(saved.products, products)
          ? saved.requestId
          : crypto.randomUUID();
      put(
        PENDING_KEY,
        JSON.stringify({ conversationId: id, requestId, question, products, draft: doc.text, context }),
      );
      state.messages.push({
        id: localId--,
        role: "user",
        content: question,
        refused: null,
        citations: [],
        createdAt: new Date().toISOString(),
        context: { ...context, products },
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
          commentary: (event) => {
            if (disposed) return;
            const index = state.progress.findIndex(item => item.id === event.id);
            if (index < 0) state.progress.push(event);
            else state.progress[index] = event;
          },
        },
        controller.signal,
        context,
      );
      if (disposed) return;
      state.lastUsage = answer.usage ?? null;
      state.lastContext = answer.context ?? null;
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
      restoreDraft(doc.text);
      if (!state.products.length && state.draft === doc.text) setProducts(products);
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
      void refreshQuota(true);
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
      put(productKey(id), null);
      clearPending(id);
      if (state.activeId === id) {
        state.activeId = null;
        state.messages = [];
        state.draft = get(draftKey(null)) || "";
        state.products = readProducts(null);
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
  function openWidget(product?: ProductAttachment) {
    state.widgetOpen = true;
    void initialize().then(() => { if (product) attachProduct(product); return refreshQuota(); });
  }
  function closeWidget() {
    state.widgetOpen = false;
  }
  function dispose() {
    disposed = true;
    stopPolling();
    controller?.abort();
    clearTimeout(quotaTimer);
  }
  return {
    state,
    initialize,
    send,
    setDraft,
    setComposer,
    attachProduct,
    removeProduct,
    newConversation,
    openConversation,
    removeConversation,
    checkRecovery,
    refreshList,
    refreshQuota,
    openWidget,
    closeWidget,
    busy,
    hasContent,
    dispose,
  };
}
export type ChatStore = ReturnType<typeof createChatStore>;
