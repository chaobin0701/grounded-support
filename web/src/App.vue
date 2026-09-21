<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { askInConversationStream, conversationApi, ChatApiError, type ChatAnswer, type ConversationItem, type ConversationMessage } from './chat-api';
import AdminApp from './AdminApp.vue';

const isAdminRoute = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');
const ACTIVE_CONVERSATION_KEY = 'grounded.activeConversationId';
const PENDING_REQUEST_KEY = 'grounded.pendingChatRequest';

type Message = { id: number; role: 'visitor'; text: string } | { id: number; role: 'assistant'; text: string; refused: boolean };

const suggestions = ['暖风机保修多久？', '满多少钱免基础配送费？', '退款一般多久能到账？'];
const messages = ref<Message[]>([]);
const conversations = ref<ConversationItem[]>([]);
const activeConversationId = ref<string | null>(null);
const isLoadingConversations = ref(false);
const question = ref('');
const isSending = ref(false);
const draftAnswer = ref('');
const errorMessage = ref('');
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

onMounted(async () => {
  if (isAdminRoute) return;
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
    else await newConversation();
  } catch {
    errorMessage.value = '暂时无法加载历史对话，请稍后刷新。';
  } finally {
    isLoadingConversations.value = false;
  }
});

function displayMessages(items: ConversationMessage[]): Message[] {
  return items.map((item) => item.role === 'user'
    ? { id: item.id, role: 'visitor', text: item.content }
    : { id: item.id, role: 'assistant', text: item.content, refused: Boolean(item.refused) });
}

async function openConversation(id: string) {
  if (isSending.value || activeConversationId.value === id) return;
  try {
    const items = await conversationApi.messages(id);
    activeConversationId.value = id;
    window.localStorage.setItem(ACTIVE_CONVERSATION_KEY, id);
    messages.value = displayMessages(items);
    errorMessage.value = '';
    await recoverPendingRequest(id);
    await scrollToLatest();
  } catch {
    errorMessage.value = '无法打开这段对话，请重试。';
  }
}

async function newConversation() {
  if (isSending.value) return;
  try {
    const item = await conversationApi.create();
    conversations.value.unshift(item);
    activeConversationId.value = item.id;
    window.localStorage.setItem(ACTIVE_CONVERSATION_KEY, item.id);
    messages.value = [];
    question.value = '';
    errorMessage.value = '';
  } catch {
    errorMessage.value = '新建对话失败，请重试。';
  }
}

async function removeConversation(item: ConversationItem) {
  if (isSending.value || !window.confirm(`删除「${item.title}」及其全部聊天记录？`)) return;
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
  if (Array.from(trimmed).length < 2 || Array.from(trimmed).length > 200) {
    errorMessage.value = '请输入 2–200 个字的问题。';
    return;
  }

  errorMessage.value = '';
  question.value = '';
  isSending.value = true;
  draftAnswer.value = '';
  let pushed = false;
  let requestId: string | undefined;
  try {
    let id = activeConversationId.value;
    if (!id) {
      const item = await conversationApi.create();
      conversations.value.unshift(item);
      activeConversationId.value = item.id;
      window.localStorage.setItem(ACTIVE_CONVERSATION_KEY, item.id);
      id = item.id;
    }
    const pending = readPendingRequest();
    requestId = pending?.conversationId === id && pending.question === trimmed ? pending.requestId : newRequestId();
    savePendingRequest({ conversationId: id, requestId, question: trimmed });
    messages.value.push({ id: nextId--, role: 'visitor', text: trimmed });
    pushed = true;
    await scrollToLatest();
    const result: ChatAnswer = await askInConversationStream(id, trimmed, (text) => {
      draftAnswer.value += text;
      void scrollToLatest();
    }, requestId);
    messages.value.push({ id: nextId--, role: 'assistant', text: result.answer, refused: result.refused });
    clearPendingRequest();
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
      } else if (error instanceof ChatApiError && error.status === 503) {
        errorMessage.value = '回答服务暂时不可用，请稍后再试。';
        clearPendingRequest();
      } else {
        errorMessage.value = '发送失败，请检查网络后重试。';
      }
      question.value = trimmed;
      if (pushed) messages.value.pop();
    }
  } finally {
    isSending.value = false;
    draftAnswer.value = '';
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
  <AdminApp v-if="isAdminRoute" />
  <div v-else class="app-shell">
    <aside class="sidebar" aria-label="对话导航">
      <div class="brand"><span class="brand-mark" aria-hidden="true">暖</span><span>暖巢电器<span class="brand-sub">智能客服</span></span></div>
      <div class="sidebar-body sidebar-conversations">
        <button class="new-conversation" type="button" :disabled="isSending || isLoadingConversations" @click="newConversation"><span aria-hidden="true">＋</span> 新建对话</button>
        <div class="conversation-list-head"><p class="section-label">最近对话</p><span>{{ conversations.length }}</span></div>
        <p v-if="isLoadingConversations" class="sidebar-copy">正在加载对话…</p>
        <p v-else-if="!conversations.length" class="sidebar-copy">还没有对话。发送问题即可开始，或创建一段空白对话。</p>
        <div v-else class="conversation-list" aria-label="对话列表">
          <div v-for="item in conversations" :key="item.id" class="conversation-list-item" :class="{ active: activeConversationId === item.id }">
            <button type="button" class="conversation-open" :disabled="isSending" @click="openConversation(item.id)">{{ item.title }}</button>
            <button type="button" class="conversation-remove" :disabled="isSending" :aria-label="`删除对话：${item.title}`" @click="removeConversation(item)">×</button>
          </div>
        </div>
        <p class="sidebar-copy sidebar-context-note">每段对话独立保存。回答以当轮资料检索或产品目录查询为依据。</p>
      </div>
      <div class="sidebar-footer">
        <span class="health-dot" :class="health" aria-hidden="true"></span>
        <span>{{ health === 'online' ? '服务运行中' : health === 'checking' ? '正在连接服务' : '服务暂时不可用' }}</span>
        <small>示例资料 · 不提供订单办理服务</small>
        <a class="admin-entry" href="/admin">管理资料 <span aria-hidden="true">↗</span></a>
      </div>
    </aside>

    <main class="workspace">
      <header class="workspace-header">
        <div><p class="section-label">客户咨询 <span aria-hidden="true">/</span> {{ conversations.find((item) => item.id === activeConversationId)?.title || '新对话' }}</p><h2>{{ activeConversationId ? '对话' : '新对话' }}</h2></div>
        <span class="header-note"><span class="header-note-icon" aria-hidden="true">▤</span><span>依据已提供数据回答<small>可查看实际查询步骤</small></span></span>
      </header>

      <section ref="conversation" class="conversation" aria-label="问答记录" aria-live="polite">
        <div v-if="messages.length === 0" class="welcome">
          <div class="welcome-symbol" aria-hidden="true"><span>暖</span></div>
          <p class="section-label">暖巢 · 智能客服</p>
          <h3>你好，有什么可以帮你？</h3>
          <p>我会查询已收录的资料和演示产品目录，再根据结果回答。</p>
          <div class="suggestions" aria-label="示例问题">
            <button v-for="item in suggestions" :key="item" type="button" :disabled="isSending" @click="chooseSuggestion(item)">{{ item }}<span aria-hidden="true">↗</span></button>
          </div>
        </div>

        <div v-for="message in messages" :key="message.id" class="message" :class="message.role">
          <div class="message-meta"><span class="message-avatar" aria-hidden="true">{{ message.role === 'assistant' ? '暖' : '我' }}</span><span>{{ message.role === 'assistant' ? '资料助手' : '你' }}</span></div>
          <div class="message-body">
            <p class="answer-text">{{ message.text }}</p>
            <p v-if="message.role === 'assistant' && message.refused" class="answer-note">可用数据不足，未生成推测性回答。</p>
          </div>
        </div>

        <div v-if="isSending" class="message assistant pending" role="status">
          <div class="message-meta"><span class="message-avatar" aria-hidden="true">暖</span><span>资料助手</span></div>
          <div v-if="!draftAnswer" class="typing" aria-label="正在生成回答"><i></i><i></i><i></i><span>正在查询资料并整理回答…</span></div>
          <div v-else class="message-body"><p class="answer-text">{{ draftAnswer }}</p><p class="answer-note">正在发送已校验的回答…</p></div>
        </div>
      </section>

      <div class="composer-area">
        <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
        <form class="composer" @submit.prevent="send()">
          <label for="question-input" class="sr-only">输入问题</label>
          <textarea id="question-input" v-model="question" rows="2" maxlength="200" :disabled="isSending || isLoadingConversations" placeholder="继续提问，或描述你想了解的产品…" @keydown="handleKeydown"></textarea>
          <button type="submit" :disabled="isSending || isLoadingConversations || !question.trim()" aria-label="发送问题"><span aria-hidden="true">➜</span></button>
        </form>
        <div class="composer-caption"><span>Enter 发送 · Shift + Enter 换行</span><span>{{ Array.from(question).length }}/200</span></div>
        <p class="privacy-note">请勿填写订单号、银行卡号等敏感信息。此演示不能查询订单或办理退款。</p>
      </div>
    </main>
  </div>
</template>
