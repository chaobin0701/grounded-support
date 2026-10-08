<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { askInConversationStream, conversationApi, getChatPresentation, ChatApiError, type ChatAnswer, type ConversationItem, type ConversationMessage, type ProgressEvent, type ChatPresentation, type ProcessEvent } from './chat-api';
import { Check, Copy, FileText, MoreHorizontal, ThumbsDown, ThumbsUp, UserRound } from '@lucide/vue';
import { siteBrand } from './brand';
import BrandMark from './ui/BrandMark.vue';
import ProductMessageContent from './ui/ProductMessageContent.vue';
import ChatProgress from './ui/ChatProgress.vue';

const props = withDefaults(defineProps<{ mode?: 'widget' | 'full'; embedded?: boolean }>(), { mode: 'full', embedded: false });
const isWidget = computed(() => props.mode === 'widget');
const showSidebar = computed(() => props.mode === 'full');
const showHeader = computed(() => props.mode === 'full' && !props.embedded);
const ACTIVE_CONVERSATION_KEY = 'grounded.activeConversationId';
const PENDING_REQUEST_KEY = 'grounded.pendingChatRequest';
const DRAFT_INPUT_PREFIX = 'grounded.draftInput.';
type Message =
  | { id: number; role: 'visitor'; text: string; createdAt: string; context?: ConversationMessage['context'] }
  | { id: number; role: 'assistant'; text: string; refused: boolean; citations: ConversationMessage['citations']; progressEvents: ProcessEvent[]; createdAt: string };
type PendingRequest = { conversationId: string; requestId: string; question: string };

const presentation = ref<ChatPresentation | null>(null);
const suggestions = computed(() => presentation.value?.suggestedQuestions ?? []);
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
const activeProgressEvents = ref<ProcessEvent[]>([]);
const openConversationMenuId = ref<string | null>(null);
const health = ref<'checking' | 'online' | 'offline'>('checking');
const conversation = ref<HTMLElement | null>(null);
let nextId = -1;

function readPendingRequest(): PendingRequest | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(PENDING_REQUEST_KEY) || 'null') as Partial<PendingRequest> | null;
    if (value && typeof value.conversationId === 'string' && typeof value.requestId === 'string' && typeof value.question === 'string') return value as PendingRequest;
  } catch { /* Ignore malformed browser state. */ }
  return null;
}
function savePendingRequest(value: PendingRequest) { window.localStorage.setItem(PENDING_REQUEST_KEY, JSON.stringify(value)); }
function clearPendingRequest() { window.localStorage.removeItem(PENDING_REQUEST_KEY); }
function newRequestId() { return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function draftInputKey(id: string | null) { return `${DRAFT_INPUT_PREFIX}${id || 'new'}`; }
function readDraftInput(id: string | null) { return window.localStorage.getItem(draftInputKey(id)) || ''; }
function writeDraftInput(id: string | null, value: string) { const key = draftInputKey(id); if (value) window.localStorage.setItem(key, value); else window.localStorage.removeItem(key); }

watch(question, (value) => { if (!isSending.value) writeDraftInput(activeConversationId.value, value); });

onMounted(async () => {
  // Welcome settings must not block history loading or sending a question.
  void getChatPresentation().then(value => { presentation.value = value; }).catch(() => {});
  window.addEventListener('click', closeConversationMenu);
  isLoadingConversations.value = true;
  try {
    const response = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
    health.value = response.ok ? 'online' : 'offline';
  } catch { health.value = 'offline'; }
  try {
    conversations.value = await conversationApi.list();
    const savedId = window.localStorage.getItem(ACTIVE_CONVERSATION_KEY);
    const preferred = conversations.value.find((item) => item.id === savedId) || (!isWidget.value ? conversations.value[0] : undefined);
    if (preferred) await openConversation(preferred.id);
    else await newConversation();
  } catch { errorMessage.value = '暂时无法加载历史对话，请稍后刷新。'; }
  finally { isLoadingConversations.value = false; }
});
onBeforeUnmount(() => window.removeEventListener('click', closeConversationMenu));

function closeConversationMenu() { openConversationMenuId.value = null; }
function toggleConversationMenu(id: string, event: MouseEvent) { event.stopPropagation(); openConversationMenuId.value = openConversationMenuId.value === id ? null : id; }
function displayMessages(items: ConversationMessage[]): Message[] { return items.map((item) => item.role === 'user' ? { id: item.id, role: 'visitor', text: item.content, createdAt: item.createdAt, context: item.context } : { id: item.id, role: 'assistant', text: item.content, refused: Boolean(item.refused), citations: item.citations || [], progressEvents: item.progressEvents || [], createdAt: item.createdAt }); }
function formatMessageTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date); }
type ProgressStep = ProgressEvent & { key: string };
function progressKey(event: ProgressEvent) { if (event.operationId) return event.operationId; return `${event.stage}:${event.tool || event.text.replace(/[.…]+$/u, '')}`; }
function progressSteps(events: ProcessEvent[]): ProgressStep[] { const steps = new Map<string, ProgressStep>(); for (const event of events) { if (event.type !== 'progress' || !event.text || event.stage !== 'tool') continue; const key = progressKey(event); steps.set(key, { ...(steps.get(key) || {}), ...event, text: event.text.replace(/[.…]+$/u, ''), key }); } return [...steps.values()]; }
const activeStatus = computed(() => {
  if (draftAnswer.value) return '正在生成回答…';
  const steps = progressSteps(activeProgressEvents.value);
  const running = [...steps].reverse().find(step => step.status === 'running');
  return running ? `${running.text}…` : steps.length ? '正在继续处理你的问题…' : '正在理解你的问题…';
});
function commentaryLines(events: ProcessEvent[]) { return [...new Map(events.filter(event => event.type === 'commentary').map(event => [event.id, event])).values()]; }
const activeCommentary = computed(() => commentaryLines(activeProgressEvents.value).at(-1));
const activeSteps = computed(() => progressSteps(activeProgressEvents.value));
async function scrollToLatest() { await nextTick(); conversation.value?.scrollTo({ top: conversation.value.scrollHeight, behavior: 'smooth' }); }

async function openConversation(id: string) {
  if (isSending.value || activeConversationId.value === id) return;
  try { const items = await conversationApi.messages(id); activeConversationId.value = id; window.localStorage.setItem(ACTIVE_CONVERSATION_KEY, id); messages.value = displayMessages(items); question.value = readDraftInput(id); errorMessage.value = ''; await recoverPendingRequest(id); await scrollToLatest(); }
  catch { errorMessage.value = '无法打开这段对话，请重试。'; }
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
defineExpose({ newConversation, isSending });

async function removeConversation(item: ConversationItem) {
  closeConversationMenu();
  if (!window.confirm(`删除「${item.title}」及其全部聊天记录？`)) return;
  try { await conversationApi.remove(item.id); conversations.value = conversations.value.filter((entry) => entry.id !== item.id); if (activeConversationId.value === item.id) { activeConversationId.value = null; window.localStorage.removeItem(ACTIVE_CONVERSATION_KEY); const pending = readPendingRequest(); if (pending?.conversationId === item.id) clearPendingRequest(); messages.value = []; if (conversations.value[0]) await openConversation(conversations.value[0].id); else await newConversation(); } }
  catch { errorMessage.value = '删除对话失败，请重试。'; }
}

async function recoverPendingRequest(id: string) {
  try { const runs = await conversationApi.runs(id); const pending = readPendingRequest(); const run = pending?.conversationId === id ? runs.find((item) => item.clientRequestId === pending.requestId) : runs.find((item) => item.status === 'queued' || item.status === 'running'); if (!run) return; if (run.status === 'completed') { if (pending?.conversationId === id) clearPendingRequest(); return; } const runQuestion = pending?.conversationId === id ? pending.question : run.question; question.value = runQuestion; errorMessage.value = run.status === 'queued' || run.status === 'running' ? '上一轮请求仍在处理中，稍后可继续查看。' : '上一轮请求未完成，可以重新发送。'; if (run.status !== 'queued' && run.status !== 'running' && pending?.conversationId === id) clearPendingRequest(); }
  catch { /* History remains usable when recovery is unavailable. */ }
}

async function copyAnswer(message: Message) { if (message.role !== 'assistant') return; try { await navigator.clipboard.writeText(message.text); copiedMessageId.value = message.id; window.setTimeout(() => { if (copiedMessageId.value === message.id) copiedMessageId.value = null; }, 1600); } catch { errorMessage.value = '复制失败，请手动选择回答内容。'; } }
function setFeedback(message: Message, value: 'up' | 'down') { if (message.role === 'assistant') feedback.value = { ...feedback.value, [message.id]: value }; }

async function send(value = question.value) {
  const trimmed = value.trim();
  if (isSending.value || isLoadingConversations.value || !trimmed) return;
  if (Array.from(trimmed).length < 2 || Array.from(trimmed).length > 2000) { errorMessage.value = '请输入 2–2000 个字的问题。'; return; }
  errorMessage.value = ''; writeDraftInput(activeConversationId.value, trimmed); question.value = ''; isSending.value = true; draftAnswer.value = ''; activeProgressEvents.value = [];
  let pushed = false;
  try {
    let id = activeConversationId.value;
    if (!id) { const item = await conversationApi.create(); activeConversationId.value = item.id; window.localStorage.setItem(ACTIVE_CONVERSATION_KEY, item.id); writeDraftInput(null, ''); id = item.id; }
    const pending = readPendingRequest(); const requestId = pending?.conversationId === id && pending.question === trimmed ? pending.requestId : newRequestId(); savePendingRequest({ conversationId: id, requestId, question: trimmed });
    messages.value.push({ id: nextId--, role: 'visitor', text: trimmed, createdAt: new Date().toISOString() }); pushed = true; await scrollToLatest();
    const result: ChatAnswer = await askInConversationStream(id, trimmed, (text) => { draftAnswer.value += text; void scrollToLatest(); }, requestId, (event) => { activeProgressEvents.value = [...activeProgressEvents.value, event]; void scrollToLatest(); });
    messages.value.push({ id: nextId--, role: 'assistant', text: result.answer, refused: result.refused, citations: result.citations, progressEvents: result.progressEvents ?? activeProgressEvents.value, createdAt: new Date().toISOString() }); clearPendingRequest(); writeDraftInput(id, '');
    try { conversations.value = await conversationApi.list(); } catch { /* Answer was saved. */ }
  } catch (error) {
    let recovered = false;
    if (activeConversationId.value) { try { const saved = await conversationApi.messages(activeConversationId.value); const last = saved.slice(-2); if (last[0]?.role === 'user' && last[0].content === trimmed && last[1]?.role === 'assistant') { messages.value = displayMessages(saved); errorMessage.value = '连接中断，但回答已保存并恢复。'; clearPendingRequest(); recovered = true; } } catch { /* Keep original error. */ } }
    if (!recovered) { if (error instanceof ChatApiError && error.status === 429) errorMessage.value = error.code ? error.message : '提问有些频繁，请稍后再试。'; else if (error instanceof ChatApiError && error.status === 409) errorMessage.value = error.message || '上一轮请求仍在处理中，请稍后再试。'; else if (error instanceof ChatApiError && error.status === 503) { errorMessage.value = '回答服务暂时不可用，请稍后再试。'; clearPendingRequest(); } else errorMessage.value = '发送失败，请检查网络后重试。'; question.value = trimmed; writeDraftInput(activeConversationId.value, trimmed); if (pushed) messages.value.pop(); }
  } finally { isSending.value = false; draftAnswer.value = ''; activeProgressEvents.value = []; await scrollToLatest(); }
}
function handleKeydown(event: KeyboardEvent) { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send(); } }
function chooseSuggestion(value: string) { void send(value); }
function selectMobileConversation(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  if (id) void openConversation(id);
  else void newConversation();
}
</script>

<template>
  <div class="app-shell" :class="{ 'app-shell-embedded': isWidget, 'chat-page-embedded': embedded }">
    <aside v-if="showSidebar" class="sidebar" aria-label="对话导航">
      <div v-if="!embedded" class="brand"><BrandMark /><span>{{ siteBrand.name }}</span></div>
      <div class="sidebar-body sidebar-conversations">
        <button class="new-conversation" type="button" :disabled="isSending || isLoadingConversations" @click="newConversation"><span aria-hidden="true">＋</span> 新建对话</button>
        <div class="conversation-list-head"><p class="section-label">最近对话</p><span>{{ conversations.length }}</span></div>
        <p v-if="isLoadingConversations" class="sidebar-copy">正在加载对话…</p>
        <p v-else-if="!conversations.length" class="sidebar-copy">还没有对话。发送问题即可开始。</p>
        <div v-else class="conversation-list" aria-label="对话列表"><div v-for="item in conversations" :key="item.id" class="conversation-list-item" :class="{ active: activeConversationId === item.id }"><button type="button" class="conversation-open" :disabled="isSending" @click="openConversation(item.id)">{{ item.title }}</button><div class="conversation-actions"><button type="button" class="conversation-menu-trigger" :aria-label="`打开对话操作：${item.title}`" :aria-expanded="openConversationMenuId === item.id" aria-haspopup="menu" @click="toggleConversationMenu(item.id, $event)"><MoreHorizontal :size="17" /></button><div v-if="openConversationMenuId === item.id" class="conversation-menu" role="menu"><button type="button" role="menuitem" class="conversation-menu-item conversation-menu-danger" @click="removeConversation(item)">删除对话</button></div></div></div></div>
      </div>
      <div v-if="!embedded" class="sidebar-footer"><span class="health-dot" :class="health" aria-hidden="true"></span><span>{{ health === 'online' ? '服务运行中' : health === 'checking' ? '正在连接服务' : '服务暂时不可用' }}</span></div>
    </aside>
    <main class="workspace">
      <header v-if="showHeader" class="workspace-header"><div><p class="section-label">当前对话</p><h2>{{ activeConversationId ? (conversations.find((item) => item.id === activeConversationId)?.title || '对话') : '新对话' }}</h2></div></header>
      <div v-if="embedded && !isWidget" class="embedded-mobile-nav"><label for="embedded-conversation" class="sr-only">选择对话</label><select id="embedded-conversation" :value="activeConversationId || ''" :disabled="isSending || isLoadingConversations" @change="selectMobileConversation"><option value="">新对话</option><option v-for="item in conversations" :key="item.id" :value="item.id">{{ item.title }}</option></select><button type="button" :disabled="isSending || isLoadingConversations" @click="newConversation">＋ 新对话</button></div>
      <section ref="conversation" class="conversation" aria-label="问答记录" aria-live="polite">
        <div v-if="messages.length === 0" class="welcome"><BrandMark class="welcome-symbol" /><p class="section-label">{{ siteBrand.assistantName }}</p><h3>{{ presentation?.title || '你好，有什么可以帮你？' }}</h3><p v-if="presentation">{{ presentation.description }}</p><div v-if="suggestions.length" class="suggestions" aria-label="示例问题"><button v-for="item in suggestions" :key="item" type="button" :disabled="isSending" @click="chooseSuggestion(item)">{{ item }}<span aria-hidden="true">↗</span></button></div></div>
        <div v-for="message in messages" :key="message.id" class="message" :class="message.role">
          <template v-if="message.role === 'visitor'"><div class="message-column"><div class="message-bubble visitor-bubble"><ProductMessageContent class="answer-text" :content="message.text" :context="message.context" /></div><time class="message-time" :datetime="message.createdAt">{{ formatMessageTime(message.createdAt) }}</time></div><span class="message-avatar visitor-avatar" aria-hidden="true"><UserRound :size="18" :stroke-width="2.2" /></span></template>
          <template v-else><BrandMark class="message-avatar assistant-avatar" /><div class="message-column"><div class="message-meta"><span>{{ siteBrand.assistantName }}</span><time :datetime="message.createdAt">{{ formatMessageTime(message.createdAt) }}</time></div><ChatProgress v-if="!isWidget" :steps="progressSteps(message.progressEvents)" :commentary="commentaryLines(message.progressEvents)" settled /><div class="message-bubble assistant-bubble"><p class="answer-text">{{ message.text }}</p><p v-if="message.refused" class="answer-note">可用数据不足，未生成推测性回答。</p><div v-if="message.citations.length" class="message-reference"><FileText :size="18" :stroke-width="1.8" aria-hidden="true" /><span>{{ message.citations.length === 1 ? `参考资料 · ${message.citations[0].documentTitle || message.citations[0].originalFilename}` : `参考资料 · ${message.citations.length} 条` }}</span></div></div><div class="message-actions" aria-label="回答操作"><button type="button" :aria-label="copiedMessageId === message.id ? '已复制' : '复制回答'" @click="copyAnswer(message)"><Check v-if="copiedMessageId === message.id" :size="16" /><Copy v-else :size="16" /></button><button type="button" :class="{ selected: feedback[message.id] === 'up' }" aria-label="回答有帮助" @click="setFeedback(message, 'up')"><ThumbsUp :size="16" /></button><button type="button" :class="{ selected: feedback[message.id] === 'down' }" aria-label="回答需要改进" @click="setFeedback(message, 'down')"><ThumbsDown :size="16" /></button></div></div></template>
        </div>
        <div v-if="isSending" class="message assistant pending" role="status"><BrandMark class="message-avatar assistant-avatar" /><div class="message-column"><div class="message-meta"><span>{{ siteBrand.assistantName }}</span></div><p v-if="activeCommentary" class="public-commentary" aria-live="polite">{{ activeCommentary.text }}</p><ChatProgress v-if="!isWidget" :steps="activeSteps" /><div v-if="!draftAnswer && (isWidget || !activeSteps.length)" class="message-bubble assistant-bubble"><div class="typing" aria-label="正在生成回答"><i></i><i></i><i></i><span>{{ activeStatus }}</span></div></div><div v-else-if="draftAnswer" class="message-bubble assistant-bubble"><p class="answer-text">{{ draftAnswer }}</p><p class="answer-note">正在输出回答…</p></div></div></div>
      </section>
      <div class="composer-area"><p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p><form class="composer" @submit.prevent="send()"><label for="question-input" class="sr-only">输入问题</label><textarea id="question-input" v-model="question" rows="2" maxlength="2000" :disabled="isSending || isLoadingConversations" placeholder="继续提问，或描述你想了解的产品…" @keydown="handleKeydown"></textarea><button type="submit" :disabled="isSending || isLoadingConversations || !question.trim()" aria-label="发送问题"><span aria-hidden="true">➜</span></button></form></div>
    </main>
  </div>
</template>
