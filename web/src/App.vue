<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { askQuestion, ChatApiError, type ChatAnswer, type Citation } from './chat-api';
import AdminApp from './AdminApp.vue';

const isAdminRoute = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');

type Message = { id: number; role: 'visitor'; text: string } | { id: number; role: 'assistant'; text: string; refused: boolean; citations: Citation[] };

const suggestions = ['暖风机保修多久？', '满多少钱免基础配送费？', '退款一般多久能到账？'];
const messages = ref<Message[]>([]);
const question = ref('');
const isSending = ref(false);
const errorMessage = ref('');
const health = ref<'checking' | 'online' | 'offline'>('checking');
const conversation = ref<HTMLElement | null>(null);
let nextId = 1;

onMounted(async () => {
  if (isAdminRoute) return;
  try {
    const response = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
    health.value = response.ok ? 'online' : 'offline';
  } catch {
    health.value = 'offline';
  }
});

async function scrollToLatest() {
  await nextTick();
  conversation.value?.scrollTo({ top: conversation.value.scrollHeight, behavior: 'smooth' });
}

async function send(value = question.value) {
  const trimmed = value.trim();
  if (isSending.value || !trimmed) return;
  if (Array.from(trimmed).length < 2 || Array.from(trimmed).length > 200) {
    errorMessage.value = '请输入 2–200 个字的问题。';
    return;
  }

  errorMessage.value = '';
  question.value = '';
  messages.value.push({ id: nextId++, role: 'visitor', text: trimmed });
  isSending.value = true;
  await scrollToLatest();
  try {
    const result: ChatAnswer = await askQuestion(trimmed);
    messages.value.push({ id: nextId++, role: 'assistant', text: result.answer, refused: result.refused, citations: result.citations });
  } catch (error) {
    if (error instanceof ChatApiError && error.status === 429) {
      errorMessage.value = '提问有些频繁，请稍后再试。';
    } else if (error instanceof ChatApiError && error.status === 503) {
      errorMessage.value = '回答服务暂时不可用，请稍后再试。';
    } else {
      errorMessage.value = '发送失败，请检查网络后重试。';
    }
    question.value = trimmed;
    messages.value.pop();
  } finally {
    isSending.value = false;
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
    <aside class="sidebar" aria-label="服务说明">
      <div class="brand"><span class="brand-mark" aria-hidden="true">暖</span><span>暖巢电器<span class="brand-sub">客服实验室</span></span></div>
      <div class="sidebar-body">
        <p class="section-label">资料问答</p>
        <h1>关于产品与服务，<br />从资料中找答案。</h1>
        <p class="sidebar-copy">回答仅依据当前已收录的资料。找不到明确依据时，我们会建议你联系人工。</p>
      </div>
      <div class="sidebar-footer">
        <span class="health-dot" :class="health" aria-hidden="true"></span>
        <span>{{ health === 'online' ? '服务运行中' : health === 'checking' ? '正在连接服务' : '服务暂时不可用' }}</span>
        <small>演示环境 · 虚构商家资料</small>
        <a class="admin-entry" href="/admin">管理员入口 ↗</a>
      </div>
    </aside>

    <main class="workspace">
      <header class="workspace-header">
        <div><p class="section-label">在线咨询</p><h2>向资料提问</h2></div>
        <span class="header-note">每个问题独立检索</span>
      </header>

      <section ref="conversation" class="conversation" aria-label="问答记录" aria-live="polite">
        <div v-if="messages.length === 0" class="welcome">
          <div class="welcome-symbol" aria-hidden="true"><span>?</span></div>
          <p class="section-label">开始咨询</p>
          <h3>你想了解什么？</h3>
          <p>可以询问配送、退换货、保修等已收录资料中的内容。</p>
          <div class="suggestions" aria-label="示例问题">
            <button v-for="item in suggestions" :key="item" type="button" :disabled="isSending" @click="chooseSuggestion(item)">{{ item }}<span aria-hidden="true">↗</span></button>
          </div>
        </div>

        <div v-for="message in messages" :key="message.id" class="message" :class="message.role">
          <div class="message-meta"><span class="message-avatar" aria-hidden="true">{{ message.role === 'assistant' ? '暖' : '我' }}</span><span>{{ message.role === 'assistant' ? '资料助手' : '你' }}</span></div>
          <div class="message-body">
            <p>{{ message.text }}</p>
            <template v-if="message.role === 'assistant'">
              <p v-if="message.refused" class="answer-note">资料不足，未生成推测性回答。</p>
              <details v-if="message.citations.length" class="citations">
                <summary>查看资料出处 <span>{{ message.citations.length }}</span></summary>
                <ol>
                  <li v-for="citation in message.citations" :key="citation.chunkId">
                    <strong>{{ citation.documentTitle }}</strong>
                    <span><template v-if="citation.documentTitle !== citation.originalFilename.replace(/\.md$/i, '')">{{ citation.originalFilename }} · </template>原文第 {{ citation.sourceStartLine }}{{ citation.sourceEndLine !== citation.sourceStartLine ? `–${citation.sourceEndLine}` : '' }} 行</span>
                  </li>
                </ol>
              </details>
            </template>
          </div>
        </div>

        <div v-if="isSending" class="message assistant pending" role="status">
          <div class="message-meta"><span class="message-avatar" aria-hidden="true">暖</span><span>资料助手</span></div>
          <div class="typing" aria-label="正在查找资料"><i></i><i></i><i></i><span>正在查找资料并整理回答…</span></div>
        </div>
      </section>

      <div class="composer-area">
        <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
        <form class="composer" @submit.prevent="send()">
          <label for="question-input" class="sr-only">输入问题</label>
          <textarea id="question-input" v-model="question" rows="2" maxlength="200" :disabled="isSending" placeholder="输入你的问题…" @keydown="handleKeydown"></textarea>
          <button type="submit" :disabled="isSending || !question.trim()" aria-label="发送问题"><span aria-hidden="true">↗</span></button>
        </form>
        <div class="composer-caption"><span>Enter 发送 · Shift + Enter 换行</span><span>{{ Array.from(question).length }}/200</span></div>
        <p class="privacy-note">请勿填写订单号、银行卡号等敏感信息。此演示不能查询订单或办理退款。</p>
      </div>
    </main>
  </div>
</template>
