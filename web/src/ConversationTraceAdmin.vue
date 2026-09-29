<script setup lang="ts">
import { Copy, RefreshCw, Search } from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import { adminApi, type ChatTraceDetail, type ConversationDetail, type ConversationListItem } from './admin-api';
import AdminPageHeader from './ui/AdminPageHeader.vue';

const props = defineProps<{ token: string }>();
const sessions = ref<ConversationListItem[]>([]);
const selectedConversation = ref<ConversationDetail | null>(null);
const selectedTrace = ref<ChatTraceDetail | null>(null);
const query = ref('');
const status = ref('all');
const visitorId = ref('');
const device = ref('all');
const timeRange = ref('all');
const visitorOptions = ref<{ visitorId: string; conversationCount: number; clientType: string }[]>([]);
const offset = ref(0);
const hasMore = ref(false);
const loading = ref(false);
const detailLoading = ref(false);
const error = ref('');
const inspectorTab = ref<'overview' | 'process' | 'context' | 'raw'>('overview');
const copyNotice = ref('');

const turns = computed(() => {
  const conversation = selectedConversation.value;
  if (!conversation) return [];
  const traces = conversation.traces;
  return conversation.messages.filter((message) => message.role === 'user').map((user) => {
    const assistant = conversation.messages.find((message) => message.role === 'assistant' && message.id > user.id);
    const trace = traces.find((item) => item.userMessageId === user.id) ?? null;
    return { user, assistant, trace };
  });
});

function date(value: string | null) { return value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'; }
function statusInfo(item: { status: string; refused?: boolean | null; busyUntil?: string | null }) {
  if (item.busyUntil && new Date(item.busyUntil).getTime() > Date.now()) return { text: '处理中', className: 'active' };
  if (item.status === 'failed') return { text: '失败', className: 'failed' };
  if (item.refused) return { text: '拒答', className: 'refused' };
  return { text: '已回答', className: 'answered' };
}
function sinceValue() {
  if (timeRange.value === 'all') return '';
  const hours = timeRange.value === '24h' ? 24 : timeRange.value === '7d' ? 24 * 7 : 24 * 30;
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}
async function copy(value: string, label = '内容') {
  try {
    await navigator.clipboard?.writeText(value);
    copyNotice.value = `${label}已复制`;
    window.setTimeout(() => { copyNotice.value = ''; }, 1800);
  } catch { error.value = '复制失败，请手动选择文本复制'; }
}
function copyIds(traceId: string | null, conversationId: string | null) {
  return copy(`轨迹 ID: ${traceId || '—'}\n会话 ID: ${conversationId || '—'}`, '轨迹和会话 ID');
}
function reload() { offset.value = 0; void loadSessions(); }
async function loadSessions() {
  loading.value = true; error.value = '';
  try {
    const result = await adminApi.conversations(props.token, { q: query.value, status: status.value, visitorId: visitorId.value, device: device.value, since: sinceValue(), offset: offset.value });
    sessions.value = result.items; hasMore.value = result.pagination.hasMore;
    visitorOptions.value = result.filters;
    if (!selectedConversation.value || !sessions.value.some((item) => item.id === selectedConversation.value?.id)) {
      if (sessions.value[0]) await chooseConversation(sessions.value[0].id); else selectedConversation.value = null;
    }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '加载会话失败'; }
  finally { loading.value = false; }
}
async function chooseConversation(id: string) {
  detailLoading.value = true; error.value = '';
  try {
    selectedConversation.value = await adminApi.conversation(props.token, id);
    const latest = [...selectedConversation.value.traces].reverse().find((trace) => trace.kind === 'answer');
    selectedTrace.value = latest ? await adminApi.chatTrace(props.token, latest.id) : null;
    inspectorTab.value = 'overview';
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '加载会话详情失败'; }
  finally { detailLoading.value = false; }
}
async function chooseTrace(id: string | null) {
  if (!id) { selectedTrace.value = null; return; }
  detailLoading.value = true;
  try { selectedTrace.value = await adminApi.chatTrace(props.token, id); inspectorTab.value = 'overview'; }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '加载轨迹失败'; }
  finally { detailLoading.value = false; }
}
function nextPage(direction: number) { offset.value = Math.max(0, offset.value + direction * 30); void loadSessions(); }
function stepTitle(step: NonNullable<ChatTraceDetail['contextSnapshot']['executionSteps']>[number]) {
  if (step.type === 'skill_selection') return `选择 Skill · ${step.skillId || '默认'}`;
  if (step.type === 'preflight') return '知识库预检索';
  if (step.type === 'tool_call') return `调用工具 · ${step.name || '未知工具'}`;
  if (step.type === 'llm_call') return step.stage === 'final_answer' ? '生成最终回答' : '模型规划';
  return '引用与答案校验';
}
onMounted(loadSessions);
</script>

<template>
  <section class="conversation-page">
    <AdminPageHeader eyebrow="运行记录" title="会话管理" description="按会话查看多轮消息，并定位某一轮的执行轨迹与模型上下文。">
      <template #actions><button class="admin-text-button" :disabled="loading" @click="loadSessions"><RefreshCw :size="15" /> 刷新</button></template>
    </AdminPageHeader>
    <p v-if="error" class="admin-error" role="alert">{{ error }}</p>
    <div v-if="copyNotice" class="copy-toast" role="status">{{ copyNotice }}</div>
    <div class="session-workspace">
      <aside class="session-list-panel">
        <div class="session-filters"><select v-model="status" aria-label="回答状态" @change="reload"><option value="all">全部状态</option><option value="answered">已回答</option><option value="refused">已拒答</option><option value="failed">失败</option><option value="active">处理中</option></select><select v-model="visitorId" aria-label="访客筛选" @change="reload"><option value="">全部访客</option><option v-for="item in visitorOptions" :key="item.visitorId" :value="item.visitorId">访客 {{ item.visitorId.slice(0, 8) }} · {{ item.conversationCount }} 个会话</option></select><select v-model="device" aria-label="设备筛选" @change="reload"><option value="all">全部设备</option><option value="browser">浏览器</option><option value="mobile">移动端</option><option value="wechat">微信</option><option value="feishu">飞书</option><option value="api">API</option></select><select v-model="timeRange" aria-label="时间筛选" @change="reload"><option value="all">全部时间</option><option value="24h">最近 24 小时</option><option value="7d">最近 7 天</option><option value="30d">最近 30 天</option></select><label><Search :size="14" /><input v-model="query" placeholder="搜索会话或问题" @keyup.enter="reload" /></label></div>
        <div class="session-list"><button v-for="item in sessions" :key="item.id" class="session-item" :class="{ active: item.id === selectedConversation?.id }" @click="chooseConversation(item.id)"><span class="session-item-main"><strong>{{ item.title || '未命名会话' }}</strong><small>{{ item.lastQuestion || '暂无问题' }}</small><small>{{ item.turnCount }} 轮 · {{ date(item.updatedAt) }}</small></span><span :class="['status-pill', statusInfo({ status: item.lastStatus || 'completed', refused: item.lastRefused, busyUntil: item.busyUntil }).className]">{{ statusInfo({ status: item.lastStatus || 'completed', refused: item.lastRefused, busyUntil: item.busyUntil }).text }}</span></button><p v-if="!sessions.length && !loading" class="empty-copy">没有匹配的会话。</p></div>
        <div class="session-pagination"><button :disabled="offset === 0 || loading" @click="nextPage(-1)">上一页</button><span>{{ Math.floor(offset / 30) + 1 }}</span><button :disabled="!hasMore || loading" @click="nextPage(1)">下一页</button></div>
      </aside>

      <main v-if="selectedConversation" class="conversation-detail-panel">
        <header class="conversation-detail-header"><div><h2>{{ selectedConversation.title || '未命名会话' }}</h2><p>{{ selectedConversation.visitorSessionId }} · 更新于 {{ date(selectedConversation.updatedAt) }}</p></div><button class="icon-button" title="复制会话 ID" @click="copy(selectedConversation.id, '会话 ID')"><Copy :size="15" /></button></header>
        <div class="conversation-id">会话 ID <code>{{ selectedConversation.id }}</code></div>
        <div class="turn-list"><article v-for="turn in turns" :key="turn.user.id" class="turn-item" :class="{ selected: selectedTrace?.id === turn.trace?.id }" @click="chooseTrace(turn.trace?.id || null)"><div class="turn-question"><span class="turn-label">用户</span><p>{{ turn.user.content }}</p></div><div v-if="turn.assistant" class="turn-answer"><span class="turn-label assistant-label">AI</span><p>{{ turn.assistant.content || '（没有生成回答）' }}</p></div><footer><span :class="['status-pill', statusInfo({ status: turn.trace?.status || 'failed', refused: turn.trace?.refused }).className]">{{ statusInfo({ status: turn.trace?.status || 'failed', refused: turn.trace?.refused }).text }}</span><span v-if="turn.trace">{{ turn.assistant?.citations && Array.isArray(turn.assistant.citations) ? turn.assistant.citations.length : 0 }} 个引用 · {{ turn.trace.durationMs }} ms</span><button v-if="turn.trace" class="trace-id-button" @click.stop="copyIds(turn.trace.id, selectedConversation.id)">复制轨迹 + 会话 ID</button></footer></article><p v-if="!turns.length" class="empty-copy">这个会话还没有消息。</p></div>
      </main>
      <div v-else class="conversation-empty">选择左侧会话查看消息。</div>

      <aside class="trace-inspector">
        <div v-if="!selectedTrace" class="inspector-empty">选择一轮对话查看对应的执行轨迹。</div>
        <template v-else>
        <nav><button :class="{ active: inspectorTab === 'overview' }" @click="inspectorTab = 'overview'">概览</button><button :class="{ active: inspectorTab === 'process' }" @click="inspectorTab = 'process'">执行过程</button><button :class="{ active: inspectorTab === 'context' }" @click="inspectorTab = 'context'">上下文</button><button :class="{ active: inspectorTab === 'raw' }" @click="inspectorTab = 'raw'">原始数据</button></nav>
        <div class="inspector-ids"><span>轨迹 ID</span><code>{{ selectedTrace.id }}</code><button title="复制轨迹 ID" @click="copy(selectedTrace.id, '轨迹 ID')"><Copy :size="13" /></button><span>会话 ID</span><code>{{ selectedTrace.conversationId || '—' }}</code><button title="复制轨迹和会话 ID" @click="copyIds(selectedTrace.id, selectedTrace.conversationId)"><Copy :size="13" /></button><button class="copy-both" @click="copyIds(selectedTrace.id, selectedTrace.conversationId)">复制两项</button></div>
        <section v-if="inspectorTab === 'overview'"><h3>本轮回答</h3><p class="inspector-answer">{{ selectedTrace.finalAnswer || '没有生成最终回答。' }}</p><dl><dt>模型</dt><dd>{{ selectedTrace.model || '—' }}</dd><dt>状态</dt><dd>{{ statusInfo(selectedTrace).text }}</dd><dt>总耗时</dt><dd>{{ selectedTrace.durationMs }} ms</dd><dt>Token</dt><dd>{{ selectedTrace.totalTokens ?? '—' }}</dd></dl></section>
        <section v-else-if="inspectorTab === 'process'"><h3>执行时间线</h3><ol class="inspector-timeline"><li v-for="(step, index) in selectedTrace.contextSnapshot.executionSteps || []" :key="`${step.type}-${index}`"><strong>{{ stepTitle(step) }}</strong><small>{{ step.detail || (step.ok ? '执行完成' : '执行失败') }} · {{ step.durationMs }} ms</small></li></ol></section>
        <section v-else-if="inspectorTab === 'context'"><h3>检索资料</h3><article v-for="source in selectedTrace.contextSnapshot.sources || []" :key="source.chunkId" class="source-item"><strong>#{{ source.chunkId }} · {{ source.title }}</strong><p>{{ source.content }}</p></article><p v-if="!selectedTrace.contextSnapshot.sources?.length" class="empty-copy">本轮没有知识库命中。</p><h3>模型调用</h3><pre>{{ JSON.stringify(selectedTrace.contextSnapshot.modelCalls || selectedTrace.contextSnapshot.executionSteps || [], null, 2) }}</pre></section>
        <section v-else><h3>原始模型输出</h3><pre>{{ selectedTrace.rawModelOutput || '没有保存原始模型输出。' }}</pre><h3>上下文快照</h3><pre>{{ JSON.stringify(selectedTrace.contextSnapshot, null, 2) }}</pre></section>
        </template>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.inspector-empty{display:grid;min-height:260px;place-items:center;padding:20px;color:#8a96a8;text-align:center;font-size:12px}
.copy-toast{position:fixed;top:78px;left:50%;z-index:20;transform:translateX(-50%);padding:9px 15px;border:1px solid #b7e4ca;border-radius:8px;background:#effaf3;color:#247b4c;font-size:12px;box-shadow:0 8px 22px #25304718}.session-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.session-filters label{grid-column:1/-1}.status-pill.active{background:#e9f1ff;color:#2457e6}.inspector-ids{grid-template-columns:45px minmax(0,1fr) 22px 45px minmax(0,1fr) 22px auto}.copy-both{padding:4px 7px!important;border:1px solid #d7e2fa!important;border-radius:6px;background:#f3f6ff!important;font-size:10px!important;white-space:nowrap}
.inspector-empty{display:grid;min-height:260px;place-items:center;padding:20px;color:#8a96a8;text-align:center;font-size:12px}
</style>
