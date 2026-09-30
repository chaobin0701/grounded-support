<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { askInConversationStream, conversationApi, ChatApiError, type ChatAnswer, type ConversationItem, type ConversationMessage, type ProgressEvent } from './chat-api';
import AdminApp from './AdminApp.vue';
import HelpCenter from './HelpCenter.vue';
import ProductSite from './ProductSite.vue';
import { Bot, Check, CheckCircle2, Copy, Database, FileText, LoaderCircle, MoreHorizontal, Search, Sparkles, ThumbsDown, ThumbsUp, UserRound } from '@lucide/vue';

const route = useRoute();
const isAdminRoute = computed(() => route.path === '/admin' || route.path.startsWith('/admin/'));
const isProductRoute = computed(() => route.path === '/product' || route.path.startsWith('/product/'));
const isHelpRoute = computed(() => route.path === '/help');
watch(() => route.path, (path) => {
  document.title = path === '/product' || path.startsWith('/product/') ? '暖巢智能客服 · 产品介绍'
    : path === '/help' ? '暖巢智能客服 · 帮助中心'
      : path.startsWith('/admin') ? '暖巢智能客服 · 管理中心' : '暖巢智能客服';
}, { immediate: true });
const ACTIVE_CONVERSATION_KEY = 'grounded.activeConversationId';
const PENDING_REQUEST_KEY = 'grounded.pendingChatRequest';
const DRAFT_INPUT_PREFIX = 'grounded.draftInput.';

type Message =
  | { id: number; role: 'visitor'; text: string; createdAt: string }
  | { id: number; role: 'assistant'; text: string; refused: boolean; citations: ConversationMessage['citations']; progressEvents: ProgressEvent[]; createdAt: string };

const suggestions = ['暖风机保修多久？', '满多少钱免基础配送费？', '退款一般多久能到账？'];
const messages = ref<Message[]>([]);
const conversations = ref<ConversationItem[]>([]);
const activeConversationId = ref<string | null>(null);
const isLoadingConversations = ref(false);
const question = ref('');
const isSending = ref(false);
const draftAnswer = ref('');
const errorMessage = ref('');
const copiedMessageId = ref<number | null>(null);
const feedback = ref<Record<number, 'up' | 'down'>>({});
const activeProgressEvents = ref<ProgressEvent[]>([]);
const openConversationMenuId = ref<string | null>(null);
const health = ref<'checking' | 'online' | 'offline'>('checking');
const conversation = ref<HTMLElement | null>(null);
let nextId = -1;

type PendingRequest = { conversationId: string; requestId: string; question: string };

function readPendingRequest(): PendingRequest | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(PENDING_REQUEST_KEY) || 'null') as Partial<PendingRequest> | null;
    if (value && typeof value.conversationId === 'string' && typeof value.requestId === 'string' && typeof value.question === 'string') return value as PendingRequest;
  } catch { /* Ignore malformed browser state and start a new request. */ }
  return null;
}

function savePendingRequest(value: PendingRequest) {
  window.localStorage.setItem(PENDING_REQUEST_KEY, JSON.stringify(value));
}

function clearPendingRequest() {
  window.localStorage.removeItem(PENDING_REQUEST_KEY);
}

function newRequestId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function draftInputKey(id: string | null) {
  return `${DRAFT_INPUT_PREFIX}${id || 'new'}`;
}

function readDraftInput(id: string | null) {
  return window.localStorage.getItem(draftInputKey(id)) || '';
}

function writeDraftInput(id: string | null, value: string) {
  const key = draftInputKey(id);
  if (value) window.localStorage.setItem(key, value);
  else window.localStorage.removeItem(key);
}

watch(question, (value) => {
  if (!isSending.value) writeDraftInput(activeConversationId.value, value);
});

onMounted(async () => {
  window.addEventListener('click', closeConversationMenu);
  if (isAdminRoute.value || isProductRoute.value || isHelpRoute.value) return;
  isLoadingConversations.value = true;
  try {
    const response = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
    health.value = response.ok ? 'online' : 'offline';
  } catch {
    health.value = 'offline';
  }
  try {
    conversations.value = await conversationApi.list();
    const savedId = window.localStorage.getItem(ACTIVE_CONVERSATION_KEY);
    const preferred = conversations.value.find((item) => item.id === savedId) || conversations.value[0];
    if (preferred) await openConversation(preferred.id);
    else newConversation();
  } catch {
    errorMessage.value = '暂时无法加载历史对话，请稍后刷新。';
  } finally {
    isLoadingConversations.value = false;
  }
});

onBeforeUnmount(() => window.removeEventListener('click', closeConversationMenu));

function closeConversationMenu() {
  openConversationMenuId.value = null;
}

function toggleConversationMenu(id: string, event: MouseEvent) {
  event.stopPropagation();
  openConversationMenuId.value = openConversationMenuId.value === id ? null : id;
}

function displayMessages(items: ConversationMessage[]): Message[] {
  return items.map((item) => item.role === 'user'
    ? { id: item.id, role: 'visitor', text: item.content, createdAt: item.createdAt }
    : { id: item.id, role: 'assistant', text: item.content, refused: Boolean(item.refused), citations: item.citations || [], progressEvents: item.progressEvents || [], createdAt: item.createdAt });
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

type ProgressStep = ProgressEvent & { key: string; stageLabel: string; stateLabel: string };

function progressKey(event: ProgressEvent) {
  if (event.operationId) return event.operationId;
  if (event.stage === 'answer') return 'answer';
  return `${event.stage}:${event.tool || event.text.replace(/[.…]+$/u, '')}`;
}

function progressSteps(events: ProgressEvent[]): ProgressStep[] {
  const steps = new Map<string, ProgressStep>();
  for (const event of events) {
    if (event.type !== 'progress' || !event.text || (event.stage !== 'tool' && event.stage !== 'answer')) continue;
    const key = progressKey(event);
    const previous = steps.get(key);
    const stageLabel = event.stage === 'tool' ? '数据查询' : '回答整理';
    steps.set(key, {
      ...(previous || {}),
      ...event,
      text: event.text.replace(/[.…]+$/u, ''),
      key,
      stageLabel,
      stateLabel: event.status === 'running' ? '进行中' : '已完成',
    });
  }
  return [...steps.values()];
}

function progressIcon(event: ProgressStep) {
  if (event.status === 'running') return LoaderCircle;
  if (event.stage === 'tool') return event.tool?.includes('search_knowledge') ? Search : Database;
  if (event.stage === 'answer') return Sparkles;
  return CheckCircle2;
}

function formatDuration(durationMs?: number) {
  if (!durationMs || durationMs < 1) return '';
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(durationMs >= 10000 ? 0 : 1)} s`;
}

async function copyAnswer(message: Message) {
  if (message.role !== 'assistant') return;
  try {
    await navigator.clipboard.writeText(message.text);
    copiedMessageId.value = message.id;
    window.setTimeout(() => { if (copiedMessageId.value === message.id) copiedMessageId.value = null; }, 1600);
  } catch {
    errorMessage.value = '复制失败，请手动选择回答内容。';
  }
}

function setFeedback(message: Message, value: 'up' | 'down') {
  if (message.role === 'assistant') feedback.value = { ...feedback.value, [message.id]: value };
}

async function openConversation(id: string) {
  if (isSending.value || activeConversationId.value === id) return;
  try {
    const items = await conversationApi.messages(id);
    activeConversationId.value = id;
    window.localStorage.setItem(ACTIVE_CONVERSATION_KEY, id);
    messages.value = displayMessages(items);
    question.value = readDraftInput(id);
    errorMessage.value = '';
    await recoverPendingRequest(id);
    await scrollToLatest();
  } catch {
    errorMessage.value = '无法打开这段对话，请重试。';
  }
}

async function newConversation() {
  if (isSending.value) return;
  activeConversationId.value = null;
  window.localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
  messages.value = [];
  activeProgressEvents.value = [];
  question.value = readDraftInput(null);
  errorMessage.value = '';
}

async function removeConversation(item: ConversationItem) {
  closeConversationMenu();
  if (!window.confirm(`删除「${item.title}」及其全部聊天记录？`)) return;
  try {
    await conversationApi.remove(item.id);
    conversations.value = conversations.value.filter((entry) => entry.id !== item.id);
    if (activeConversationId.value === item.id) {
      activeConversationId.value = null;
      window.localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
      const pending = readPendingRequest();
      if (pending?.conversationId === item.id) clearPendingRequest();
      messages.value = [];
      if (conversations.value[0]) await openConversation(conversations.value[0].id);
      else await newConversation();
    }
  } catch {
    errorMessage.value = '删除对话失败，请重试。';
  }
}

async function recoverPendingRequest(id: string) {
  try {
    const runs = await conversationApi.runs(id);
    const pending = readPendingRequest();
    const run = pending?.conversationId === id
      ? runs.find((item) => item.clientRequestId === pending.requestId)
      : runs.find((item) => item.status === 'queued' || item.status === 'running');
    if (!run) return;
    if (run.status === 'completed') {
      if (pending?.conversationId === id) clearPendingRequest();
      return;
    }
    const runQuestion = pending?.conversationId === id ? pending.question : run.question;
    question.value = runQuestion;
    if (run.status === 'queued' || run.status === 'running') {
      errorMessage.value = '上一轮请求仍在处理中，稍后可继续查看。';
    } else {
      errorMessage.value = '上一轮请求未完成，可以重新发送。';
      if (pending?.conversationId === id) clearPendingRequest();
    }
  } catch {
    // Conversation history remains usable when status recovery is unavailable.
  }
}

async function scrollToLatest() {
  await nextTick();
  conversation.value?.scrollTo({ top: conversation.value.scrollHeight, behavior: 'smooth' });
}

async function send(value = question.value) {
  const trimmed = value.trim();
  if (isSending.value || isLoadingConversations.value || !trimmed) return;
  if (Array.from(trimmed).length < 2 || Array.from(trimmed).length > 2000) {
    errorMessage.value = '请输入 2–2000 个字的问题。';
    return;
  }

  errorMessage.value = '';
  writeDraftInput(activeConversationId.value, trimmed);
  question.value = '';
  isSending.value = true;
  draftAnswer.value = '';
  activeProgressEvents.value = [];
  let pushed = false;
  let requestId: string | undefined;
  try {
    let id = activeConversationId.value;
    if (!id) {
      const item = await conversationApi.create();
      activeConversationId.value = item.id;
      window.localStorage.setItem(ACTIVE_CONVERSATION_KEY, item.id);
      writeDraftInput(null, '');
      id = item.id;
    }
    const pending = readPendingRequest();
    requestId = pending?.conversationId === id && pending.question === trimmed ? pending.requestId : newRequestId();
    savePendingRequest({ conversationId: id, requestId, question: trimmed });
    messages.value.push({ id: nextId--, role: 'visitor', text: trimmed, createdAt: new Date().toISOString() });
    pushed = true;
    await scrollToLatest();
    const result: ChatAnswer = await askInConversationStream(id, trimmed, (text) => {
      draftAnswer.value += text;
      void scrollToLatest();
    }, requestId, (event) => {
      activeProgressEvents.value = [...activeProgressEvents.value, event];
      void scrollToLatest();
    });
    messages.value.push({ id: nextId--, role: 'assistant', text: result.answer, refused: result.refused, citations: result.citations, progressEvents: activeProgressEvents.value, createdAt: new Date().toISOString() });
    clearPendingRequest();
    writeDraftInput(id, '');
    try { conversations.value = await conversationApi.list(); } catch { /* Answer was saved; list can refresh later. */ }
  } catch (error) {
    let recovered = false;
    if (activeConversationId.value) {
      try {
        const saved = await conversationApi.messages(activeConversationId.value);
        const last = saved.slice(-2);
        if (last[0]?.role === 'user' && last[0].content === trimmed && last[1]?.role === 'assistant') {
          messages.value = displayMessages(saved);
          errorMessage.value = '连接中断，但回答已保存并恢复。';
          clearPendingRequest();
          recovered = true;
        }
      } catch { /* Keep the original request error. */ }
    }
    if (!recovered) {
      if (error instanceof ChatApiError && error.status === 429) {
        errorMessage.value = '提问有些频繁，请稍后再试。';
      } else if (error instanceof ChatApiError && error.status === 409) {
        errorMessage.value = error.message || '上一轮请求仍在处理中，请稍后再试。';
      } else if (error instanceof ChatApiError && error.status === 503) {
        errorMessage.value = '回答服务暂时不可用，请稍后再试。';
        clearPendingRequest();
      } else {
        errorMessage.value = '发送失败，请检查网络后重试。';
      }
      question.value = trimmed;
      writeDraftInput(activeConversationId.value, trimmed);
      if (pushed) messages.value.pop();
    }
  } finally {
    isSending.value = false;
    draftAnswer.value = '';
    activeProgressEvents.value = [];
    await scrollToLatest();
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void send();
  }
}

function chooseSuggestion(value: string) {
  void send(value);
}

</script>

<template>
  <ProductSite v-if="isProductRoute" />
  <HelpCenter v-else-if="isHelpRoute" />
  <AdminApp v-else-if="isAdminRoute" />
  <div v-else class="app-shell">
    <aside class="sidebar" aria-label="对话导航">
      <div class="brand"><span class="brand-mark" aria-hidden="true">暖</span><span>暖巢智能客服</span></div>
      <div class="sidebar-body sidebar-conversations">
        <button class="new-conversation" type="button" :disabled="isSending || isLoadingConversations" @click="newConversation"><span aria-hidden="true">＋</span> 新建对话</button>
        <div class="conversation-list-head"><p class="section-label">最近对话</p><span>{{ conversations.length }}</span></div>
        <p v-if="isLoadingConversations" class="sidebar-copy">正在加载对话…</p>
        <p v-else-if="!conversations.length" class="sidebar-copy">还没有对话。发送问题即可开始，或创建一段空白对话。</p>
        <div v-else class="conversation-list" aria-label="对话列表">
          <div v-for="item in conversations" :key="item.id" class="conversation-list-item" :class="{ active: activeConversationId === item.id }">
            <button type="button" class="conversation-open" :disabled="isSending" @click="openConversation(item.id)">{{ item.title }}</button>
            <div class="conversation-actions">
              <button type="button" class="conversation-menu-trigger" :aria-label="`打开对话操作：${item.title}`" :aria-expanded="openConversationMenuId === item.id" aria-haspopup="menu" @click="toggleConversationMenu(item.id, $event)"><MoreHorizontal :size="17" /></button>
              <div v-if="openConversationMenuId === item.id" class="conversation-menu" role="menu">
                <button type="button" role="menuitem" class="conversation-menu-item conversation-menu-danger" @click="removeConversation(item)">删除对话</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="sidebar-footer">
        <span class="health-dot" :class="health" aria-hidden="true"></span>
        <span>{{ health === 'online' ? '服务运行中' : health === 'checking' ? '正在连接服务' : '服务暂时不可用' }}</span>
        <div class="sidebar-product-links"><RouterLink to="/product">产品官网</RouterLink><RouterLink to="/help">帮助中心</RouterLink></div>
      </div>
    </aside>

    <main class="workspace">
      <header class="workspace-header">
        <div><p class="section-label">客户咨询 <span aria-hidden="true">/</span> {{ conversations.find((item) => item.id === activeConversationId)?.title || '新对话' }}</p><h2>{{ activeConversationId ? '对话' : '新对话' }}</h2></div>
      </header>

      <section ref="conversation" class="conversation" aria-label="问答记录" aria-live="polite">
        <div v-if="messages.length === 0" class="welcome">
          <div class="welcome-symbol" aria-hidden="true"><span>暖</span></div>
          <p class="section-label">暖巢 · AI 助手</p>
          <h3>你好，有什么可以帮你？</h3>
          <p>我会查询已收录的资料和演示产品目录，再根据结果回答。</p>
          <div class="suggestions" aria-label="示例问题">
            <button v-for="item in suggestions" :key="item" type="button" :disabled="isSending" @click="chooseSuggestion(item)">{{ item }}<span aria-hidden="true">↗</span></button>
          </div>
        </div>

        <div v-for="message in messages" :key="message.id" class="message" :class="message.role">
          <template v-if="message.role === 'visitor'">
            <div class="message-column">
              <div class="message-bubble visitor-bubble"><p class="answer-text">{{ message.text }}</p></div>
              <time class="message-time" :datetime="message.createdAt">{{ formatMessageTime(message.createdAt) }}</time>
            </div>
            <span class="message-avatar visitor-avatar" aria-hidden="true"><UserRound :size="18" :stroke-width="2.2" /></span>
          </template>
          <template v-else>
            <span class="message-avatar assistant-avatar" aria-hidden="true"><Bot :size="18" :stroke-width="2.1" /></span>
            <div class="message-column">
              <div class="message-meta"><span>暖巢 · AI 助手</span><time :datetime="message.createdAt">{{ formatMessageTime(message.createdAt) }}</time></div>
              <div class="message-bubble assistant-bubble">
                <p class="answer-text">{{ message.text }}</p>
                <p v-if="message.refused" class="answer-note">可用数据不足，未生成推测性回答。</p>
                <div v-if="message.citations.length" class="message-reference">
                  <FileText :size="18" :stroke-width="1.8" aria-hidden="true" />
                  <span>{{ message.citations.length === 1 ? `参考资料 · ${message.citations[0].documentTitle || message.citations[0].originalFilename}` : `参考资料 · ${message.citations.length} 条` }}</span>
                </div>
              </div>
              <div class="message-actions" aria-label="回答操作">
                <button type="button" :aria-label="copiedMessageId === message.id ? '已复制' : '复制回答'" @click="copyAnswer(message)"><Check v-if="copiedMessageId === message.id" :size="16" /><Copy v-else :size="16" /></button>
                <button type="button" :class="{ selected: feedback[message.id] === 'up' }" aria-label="回答有帮助" @click="setFeedback(message, 'up')"><ThumbsUp :size="16" /></button>
                <button type="button" :class="{ selected: feedback[message.id] === 'down' }" aria-label="回答需要改进" @click="setFeedback(message, 'down')"><ThumbsDown :size="16" /></button>
              </div>
              <details v-if="message.progressEvents.length" class="process-collapsible message-process">
                <summary><span class="process-summary-label"><Sparkles :size="14" aria-hidden="true" />查看处理过程</span><span>{{ progressSteps(message.progressEvents).length }} 步</span></summary>
                <div class="process-content">
                  <div v-for="event in progressSteps(message.progressEvents)" :key="event.key" class="process-step" :class="[event.status, `stage-${event.stage}`]">
                    <span class="process-step-icon" aria-hidden="true"><component :is="progressIcon(event)" :size="14" :class="{ spinning: event.status === 'running' }" /></span>
                    <span class="process-step-copy"><small>{{ event.stageLabel }}</small><span>{{ event.text }}</span></span>
                    <span class="process-step-meta"><small>{{ event.stateLabel }}</small><small v-if="event.resultCount !== undefined">{{ event.resultCount }} 条</small><small v-if="formatDuration(event.durationMs)">{{ formatDuration(event.durationMs) }}</small></span>
                  </div>
                </div>
              </details>
            </div>
          </template>
        </div>

        <div v-if="isSending" class="message assistant pending" role="status">
          <span class="message-avatar assistant-avatar" aria-hidden="true"><Bot :size="18" :stroke-width="2.1" /></span>
          <div class="message-column">
            <div class="message-meta"><span>暖巢 · AI 助手</span></div>
            <div v-if="!draftAnswer" class="message-bubble assistant-bubble"><div class="typing" aria-label="正在生成回答"><i></i><i></i><i></i><span>{{ activeProgressEvents.length ? '正在处理资料并整理回答…' : '正在生成回答…' }}</span></div></div>
            <div v-else class="message-bubble assistant-bubble"><p class="answer-text">{{ draftAnswer }}</p><p class="answer-note">正在输出回答…</p></div>
            <div v-if="activeProgressEvents.length" class="process-panel pending-process">
              <details class="process-collapsible" open>
                <summary><span class="process-summary-label"><LoaderCircle :size="14" class="spinning" aria-hidden="true" />正在处理</span><span>{{ progressSteps(activeProgressEvents).length }} 步</span></summary>
                <div class="process-content">
                  <div v-for="event in progressSteps(activeProgressEvents)" :key="event.key" class="process-step" :class="[event.status, `stage-${event.stage}`]">
                    <span class="process-step-icon" aria-hidden="true"><component :is="progressIcon(event)" :size="14" :class="{ spinning: event.status === 'running' }" /></span>
                    <span class="process-step-copy"><small>{{ event.stageLabel }}</small><span>{{ event.text }}</span></span>
                    <span class="process-step-meta"><small>{{ event.stateLabel }}</small><small v-if="event.resultCount !== undefined">{{ event.resultCount }} 条</small><small v-if="formatDuration(event.durationMs)">{{ formatDuration(event.durationMs) }}</small></span>
                  </div>
                </div>
              </details>
            </div>
          </div>
        </div>
      </section>

      <div class="composer-area">
        <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
        <form class="composer" @submit.prevent="send()">
          <label for="question-input" class="sr-only">输入问题</label>
          <textarea id="question-input" v-model="question" rows="2" maxlength="2000" :disabled="isSending || isLoadingConversations" placeholder="继续提问，或描述你想了解的产品…" @keydown="handleKeydown"></textarea>
          <button type="submit" :disabled="isSending || isLoadingConversations || !question.trim()" aria-label="发送问题"><span aria-hidden="true">➜</span></button>
        </form>
      </div>
    </main>
  </div>
</template>
