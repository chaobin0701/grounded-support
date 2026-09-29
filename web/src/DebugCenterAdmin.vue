<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AdminPageHeader from './ui/AdminPageHeader.vue';
import UiDialog from './ui/UiDialog.vue';
import { adminApi, AdminApiError, type DebugCase, type DebugCaseStatus, type DebugConversation, type DebugFinding, type DebugInspection } from './admin-api';

const props = defineProps<{ token: string }>();
type DebugTab = 'overview' | 'conversation' | 'timeline' | 'context' | 'model' | 'raw';
const cases = ref<DebugCase[]>([]);
const selectedCase = ref<DebugCase | null>(null);
const selectedConversationId = ref<string | null>(null);
const tab = ref<DebugTab>('overview');
const caseFilter = ref<'all' | DebugCaseStatus>('all');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const createOpen = ref(false);
const form = ref({ title: '', conversationIds: '', traceIds: '', issueDescription: '' });
const statusOptions: { value: DebugCaseStatus; label: string }[] = [
  { value: 'pending', label: '待分析' }, { value: 'analyzing', label: '分析中' },
  { value: 'confirmed', label: '已确认' }, { value: 'ignored', label: '已忽略' },
];
const tabs: { id: DebugTab; label: string }[] = [
  { id: 'overview', label: '概览' }, { id: 'conversation', label: '会话' }, { id: 'timeline', label: '执行过程' },
  { id: 'context', label: '上下文' }, { id: 'model', label: '模型调用' }, { id: 'raw', label: '原始数据' },
];

const inspection = computed<DebugInspection | null>(() => selectedCase.value?.snapshot ?? null);
const conversations = computed(() => inspection.value?.conversations ?? []);
const activeConversation = computed<DebugConversation | null>(() => conversations.value.find((item) => item.id === selectedConversationId.value) ?? conversations.value[0] ?? null);
const findings = computed(() => inspection.value?.diagnostics.findings ?? activeConversation.value?.findings ?? []);
const filteredCases = computed(() => caseFilter.value === 'all' ? cases.value : cases.value.filter((item) => item.status === caseFilter.value));
const statusLabel = (status: string) => statusOptions.find((item) => item.value === status)?.label ?? status;
const severityLabel = (severity: DebugFinding['severity']) => ({ error: '错误', warning: '警告', info: '提示' })[severity];

function parseIds(value: string): string[] {
  return [...new Set(value.split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean))];
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringValue(value: unknown): string { return typeof value === 'string' ? value : value == null ? '' : String(value); }
function formatDate(value: string | null | undefined): string { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'; }
function formatDuration(value: unknown): string { const ms = typeof value === 'number' ? value : 0; return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`; }

async function loadCases() {
  busy.value = true; error.value = '';
  try {
    cases.value = await adminApi.debugCases(props.token);
    if (cases.value.length && !selectedCase.value) await selectCase(cases.value[0]);
  } catch (cause) { error.value = cause instanceof AdminApiError ? cause.message : '无法加载调试案例。'; }
  finally { busy.value = false; }
}

async function selectCase(item: DebugCase) {
  busy.value = true; error.value = '';
  try {
    selectedCase.value = await adminApi.debugCase(props.token, item.id);
    selectedConversationId.value = selectedCase.value.snapshot?.conversations[0]?.id ?? null;
    tab.value = 'overview';
  } catch (cause) { error.value = cause instanceof AdminApiError ? cause.message : '无法加载调试案例详情。'; }
  finally { busy.value = false; }
}

async function createCase() {
  const conversationIds = parseIds(form.value.conversationIds);
  if (!conversationIds.length) { error.value = '请至少填写一个会话 ID。'; return; }
  busy.value = true; error.value = ''; notice.value = '';
  try {
    const created = await adminApi.createDebugCase(props.token, {
      title: form.value.title.trim() || undefined,
      conversationIds,
      traceIds: parseIds(form.value.traceIds),
      issueDescription: form.value.issueDescription.trim() || undefined,
    });
    cases.value = [created, ...cases.value.filter((item) => item.id !== created.id)];
    createOpen.value = false;
    form.value = { title: '', conversationIds: '', traceIds: '', issueDescription: '' };
    await selectCase(created);
    notice.value = '调试案例已保存。';
  } catch (cause) { error.value = cause instanceof AdminApiError ? cause.message : '创建调试案例失败。'; }
  finally { busy.value = false; }
}

async function updateStatus(status: DebugCaseStatus) {
  if (!selectedCase.value || selectedCase.value.status === status) return;
  busy.value = true; error.value = '';
  try {
    const updated = await adminApi.updateDebugCaseStatus(props.token, selectedCase.value.id, status);
    selectedCase.value = { ...selectedCase.value, ...updated };
    cases.value = cases.value.map((item) => item.id === updated.id ? { ...item, status: updated.status, updatedAt: updated.updatedAt } : item);
    notice.value = '案例状态已更新。';
  } catch (cause) { error.value = cause instanceof AdminApiError ? cause.message : '更新案例状态失败。'; }
  finally { busy.value = false; }
}

function onStatusChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (statusOptions.some((item) => item.value === value)) void updateStatus(value as DebugCaseStatus);
}

function setTab(value: string) {
  if (tabs.some((item) => item.id === value)) tab.value = value as DebugTab;
}

async function copy(value: unknown) {
  await navigator.clipboard.writeText(json(value));
  notice.value = '结构化调试 JSON 已复制。';
}

onMounted(loadCases);
</script>

<template>
  <section class="debug-center">
    <AdminPageHeader eyebrow="诊断工具" title="调试中心" description="聚合会话、运行、轨迹和模型上下文，帮助定位一次回答链路中的具体问题。">
      <template #actions><button type="button" class="admin-primary" @click="createOpen = true">新建调试案例</button></template>
    </AdminPageHeader>
    <div v-if="error" class="admin-error debug-notice">{{ error }}</div>
    <div v-if="notice" class="admin-success debug-notice">{{ notice }}</div>
    <div class="debug-layout">
      <aside class="debug-case-list">
        <div class="admin-section-head"><div><h2>案例</h2><span>{{ cases.length }} 个保存的快照</span></div><button type="button" class="admin-text-button" :disabled="busy" @click="loadCases">刷新</button></div>
        <select v-model="caseFilter" class="debug-case-filter" aria-label="按状态筛选案例"><option value="all">全部状态</option><option v-for="item in statusOptions" :key="item.value" :value="item.value">{{ item.label }}</option></select>
        <button v-for="item in filteredCases" :key="item.id" type="button" class="debug-case-item" :class="{ selected: selectedCase?.id === item.id }" @click="selectCase(item)">
          <strong>{{ item.title }}</strong><small>{{ item.issueDescription || '未填写问题描述' }}</small><span><em :class="`debug-status-${item.status}`">{{ statusLabel(item.status) }}</em> · {{ formatDate(item.updatedAt) }}</span>
        </button>
        <p v-if="!filteredCases.length && !busy" class="admin-muted debug-empty">{{ cases.length ? '没有符合筛选条件的案例。' : '还没有调试案例。粘贴会话 ID 开始检查。' }}</p>
      </aside>
      <main v-if="selectedCase && inspection" class="debug-detail">
        <div class="debug-detail-head"><div><p class="section-label">案例 · {{ selectedCase.id }}</p><h2>{{ selectedCase.title }}</h2><p class="admin-muted">{{ selectedCase.issueDescription || '未填写问题描述' }} · 检查于 {{ formatDate(inspection.inspectedAt) }}</p></div><label class="debug-status-select">状态<select :value="selectedCase.status" @change="onStatusChange"><option v-for="item in statusOptions" :key="item.value" :value="item.value">{{ item.label }}</option></select></label></div>
        <div class="debug-tabs" role="tablist"><button v-for="item in tabs" :key="item.id" type="button" :class="{ active: tab === item.id }" @click="setTab(item.id)">{{ item.label }}</button></div>
        <div v-if="conversations.length > 1" class="debug-conversation-switch"><button v-for="item in conversations" :key="item.id" type="button" :class="{ active: activeConversation?.id === item.id }" @click="selectedConversationId = item.id">{{ item.title || item.id }}<small>{{ item.id.slice(0, 8) }}…</small></button></div>

        <div v-if="tab === 'overview'" class="debug-panel"><div class="debug-metric-grid"><div><strong>{{ inspection.conversations.length }}</strong><span>会话</span></div><div><strong>{{ inspection.diagnostics.metrics.traceCount }}</strong><span>轨迹</span></div><div><strong>{{ inspection.diagnostics.metrics.toolCallCount }}</strong><span>工具调用</span></div><div><strong>{{ formatDuration(inspection.diagnostics.metrics.totalDurationMs) }}</strong><span>总耗时</span></div><div><strong>{{ inspection.diagnostics.metrics.totalTokens || '—' }}</strong><span>Token</span></div></div><div v-if="inspection.notFoundIds.length" class="debug-warning">未找到会话：{{ inspection.notFoundIds.join('、') }}</div><div class="debug-findings"><div class="admin-section-head"><div><h3>规则诊断</h3><span>{{ findings.length }} 条发现</span></div><button type="button" class="admin-text-button" @click="copy(inspection)">复制完整 JSON</button></div><article v-for="finding in findings" :key="`${finding.code}-${finding.traceId || finding.conversationId || ''}`" class="debug-finding"><span class="debug-severity" :class="`debug-severity-${finding.severity}`">{{ severityLabel(finding.severity) }}</span><div><strong>{{ finding.title }}</strong><p>{{ finding.detail }}</p><small>{{ finding.code }}<template v-if="finding.traceId"> · 轨迹 {{ finding.traceId }}</template></small></div></article></div></div>

        <div v-else-if="tab === 'conversation' && activeConversation" class="debug-panel"><div class="debug-subhead"><h3>{{ activeConversation.title }}</h3><span>{{ activeConversation.id }}</span></div><dl class="debug-detail-grid"><dt>访客会话</dt><dd>{{ activeConversation.visitorSessionId }}</dd><dt>创建时间</dt><dd>{{ formatDate(activeConversation.createdAt) }}</dd><dt>更新时间</dt><dd>{{ formatDate(activeConversation.updatedAt) }}</dd><dt>busyUntil</dt><dd>{{ formatDate(activeConversation.busyUntil) }}</dd><dt>摘要</dt><dd>{{ activeConversation.summary || '—' }}</dd></dl><div class="debug-message-list"><article v-for="message in activeConversation.messages" :key="message.id" :class="`debug-message debug-message-${message.role}`"><header><strong>{{ message.role === 'user' ? '用户' : '助手' }}</strong><time>{{ formatDate(message.createdAt) }}</time><span v-if="message.refused" class="debug-refused">拒答</span></header><p>{{ message.content || '（空内容）' }}</p><details v-if="message.citations && asArray(message.citations).length"><summary>引用（{{ asArray(message.citations).length }}）</summary><pre>{{ json(message.citations) }}</pre></details></article></div></div>

        <div v-else-if="tab === 'timeline' && activeConversation" class="debug-panel"><div v-for="run in activeConversation.runs" :key="run.id" class="debug-run"><div><span class="debug-dot" :class="`debug-dot-${run.status}`"></span><strong>{{ run.status }}</strong><span>{{ formatDate(run.createdAt) }}</span></div><p>{{ run.question }}</p><small>run {{ run.id }} · client {{ run.clientRequestId }}<template v-if="run.errorCode"> · {{ run.errorCode }}</template></small></div><div v-for="trace in activeConversation.traces" :key="trace.id" class="debug-run debug-trace"><div><span class="debug-dot" :class="`debug-dot-${trace.status}`"></span><strong>{{ trace.kind }} / {{ trace.status }}</strong><span>{{ formatDuration(trace.durationMs) }}</span><span>{{ formatDate(trace.createdAt) }}</span></div><p>{{ trace.question }}</p><small>trace {{ trace.id }}<template v-if="trace.errorCode"> · {{ trace.errorCode }}</template></small></div><p v-if="!activeConversation.runs.length && !activeConversation.traces.length" class="admin-muted">没有运行或轨迹记录。</p></div>

        <div v-else-if="tab === 'context' && activeConversation" class="debug-panel"><div v-for="trace in activeConversation.traces" :key="trace.id" class="debug-context-block"><div class="debug-subhead"><div><h3>{{ trace.kind }} · {{ trace.question }}</h3><span>{{ trace.id }}</span></div><button type="button" class="admin-text-button" @click="copy(trace.contextSnapshot)">复制上下文</button></div><div class="debug-context-grid"><div><span>Skill</span><strong>{{ stringValue(asRecord(trace.contextSnapshot.skill).name) || stringValue(asRecord(trace.contextSnapshot.skill).id) || '—' }}</strong></div><div><span>预检索</span><strong>{{ stringValue(asRecord(trace.contextSnapshot.preflight).hitCount) || '0' }} 条</strong></div><div><span>来源</span><strong>{{ asArray(trace.contextSnapshot.sources).length }} 条</strong></div><div><span>模型调用</span><strong>{{ asArray(trace.contextSnapshot.modelCalls).length }} 次</strong></div></div><details><summary>查看结构化上下文</summary><pre>{{ json(trace.contextSnapshot) }}</pre></details></div><p v-if="!activeConversation.traces.length" class="admin-muted">没有轨迹上下文。</p></div>

        <div v-else-if="tab === 'model' && activeConversation" class="debug-panel"><div v-for="trace in activeConversation.traces" :key="trace.id" class="debug-model-trace"><h3>{{ trace.question }} <small>{{ trace.id }}</small></h3><details v-for="(call, index) in asArray(trace.contextSnapshot.modelCalls)" :key="index" open><summary>调用 {{ index + 1 }} · {{ stringValue(asRecord(call).purpose) }} · {{ stringValue(asRecord(call).model) }} · {{ formatDuration(asRecord(call).durationMs) }}</summary><div class="debug-model-grid"><div><h4>请求</h4><pre>{{ json(asRecord(call).request) }}</pre></div><div><h4>响应</h4><pre>{{ json(asRecord(call).response) }}</pre></div></div></details><p v-if="!asArray(trace.contextSnapshot.modelCalls).length" class="admin-muted">该轨迹没有保存模型调用上下文（可能产生于调试记录启用之前）。</p></div><p v-if="!activeConversation.traces.length" class="admin-muted">没有模型调用记录。</p></div>

        <div v-else-if="tab === 'raw'" class="debug-panel debug-raw"><div class="debug-subhead"><h3>完整快照</h3><button type="button" class="admin-text-button" @click="copy(inspection)">复制 JSON</button></div><pre>{{ json(inspection) }}</pre></div>
      </main>
      <section v-else class="admin-empty debug-no-selection"><h2>选择一个调试案例</h2><p>从左侧选择案例，或创建新案例检查会话链路。</p></section>
    </div>
    <UiDialog :open="createOpen" title="新建调试案例" description="粘贴会话 ID 后，系统会保存一次完整的上下文检查快照。" size="lg" @update:open="createOpen = $event">
      <form class="admin-dialog-form" @submit.prevent="createCase"><label>案例标题<input v-model="form.title" maxlength="200" placeholder="例如：第二轮回复为空" /></label><label>会话 ID（必填）<textarea v-model="form.conversationIds" rows="4" required placeholder="每行一个 UUID，也可以用逗号分隔" /></label><label>轨迹 ID（可选）<textarea v-model="form.traceIds" rows="3" placeholder="只查看指定轨迹时填写" /></label><label>问题描述（可选）<textarea v-model="form.issueDescription" rows="3" maxlength="2000" placeholder="描述你观察到的现象和怀疑的步骤" /></label><footer><button type="button" @click="createOpen = false">取消</button><button class="admin-primary" type="submit" :disabled="busy">{{ busy ? '检查中…' : '检查并保存' }}</button></footer></form>
    </UiDialog>
  </section>
</template>

<style scoped>
.debug-center { min-width: 0; }
.debug-notice { margin: 0 0 14px; }
.debug-layout { display: grid; grid-template-columns: 285px minmax(0, 1fr); gap: 18px; min-height: 600px; }
.debug-case-list, .debug-detail, .debug-panel { min-width: 0; }
.debug-case-list { border: 1px solid var(--admin-border, #e7e9ee); border-radius: 16px; background: var(--admin-surface, #fff); padding: 16px; align-self: start; }
.debug-case-filter { width: 100%; margin: 0 0 10px; border: 1px solid var(--admin-border, #dfe3ea); border-radius: 8px; padding: 8px; background: #fff; color: #536172; }
.debug-case-item { display: grid; gap: 6px; width: 100%; padding: 13px 12px; border: 1px solid transparent; border-radius: 10px; background: transparent; text-align: left; color: inherit; cursor: pointer; }
.debug-case-item:hover, .debug-case-item.selected { background: #f4f7ff; border-color: #cbd8ff; }
.debug-case-item strong { font-size: 13px; }
.debug-case-item small { color: var(--admin-muted, #7d8794); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.debug-case-item span { font-size: 11px; color: #8d97a3; }
.debug-case-item em { font-style: normal; }
.debug-status-pending { color: #946200; }.debug-status-analyzing { color: #2968c8; }.debug-status-confirmed { color: #15805b; }.debug-status-ignored { color: #8b929c; }
.debug-empty { padding: 18px 4px; }
.debug-detail { border: 1px solid var(--admin-border, #e7e9ee); border-radius: 16px; background: var(--admin-surface, #fff); padding: 20px; overflow: hidden; }
.debug-detail-head, .debug-subhead { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.debug-detail-head h2 { margin: 3px 0 4px; }
.debug-status-select { display: grid; gap: 5px; min-width: 120px; font-size: 12px; color: #7c8795; }
.debug-status-select select { border: 1px solid var(--admin-border, #dfe3ea); border-radius: 8px; padding: 8px; background: #fff; }
.debug-tabs { display: flex; gap: 4px; overflow-x: auto; margin: 18px -4px 14px; padding: 0 4px 4px; border-bottom: 1px solid var(--admin-border, #e7e9ee); }
.debug-tabs button, .debug-conversation-switch button { border: 0; background: transparent; padding: 9px 12px; border-radius: 8px; color: #6f7987; cursor: pointer; white-space: nowrap; }
.debug-tabs button.active, .debug-tabs button:hover { color: #245ed1; background: #f1f5ff; }
.debug-conversation-switch { display: flex; gap: 7px; overflow-x: auto; margin-bottom: 14px; }
.debug-conversation-switch button { display: grid; gap: 2px; border: 1px solid var(--admin-border, #e7e9ee); text-align: left; }.debug-conversation-switch button.active { border-color: #b9ccff; background: #f1f5ff; color: #245ed1; }.debug-conversation-switch small { color: #8a94a1; }
.debug-metric-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin-bottom: 18px; }.debug-metric-grid div { padding: 15px; border-radius: 12px; background: #f7f9fc; }.debug-metric-grid strong, .debug-metric-grid span { display: block; }.debug-metric-grid strong { font-size: 20px; color: #1d2b43; }.debug-metric-grid span { margin-top: 5px; font-size: 12px; color: #7d8794; }
.debug-warning { padding: 10px 12px; border-radius: 9px; background: #fff7e7; color: #8e6200; margin-bottom: 15px; font-size: 13px; }
.debug-findings h3 { margin: 0; }.debug-finding { display: flex; gap: 11px; padding: 13px 0; border-bottom: 1px solid #eef0f3; }.debug-finding strong { font-size: 13px; }.debug-finding p { margin: 4px 0; color: #5e6875; font-size: 13px; }.debug-finding small { color: #9aa2ad; }.debug-severity { flex: 0 0 auto; align-self: flex-start; border-radius: 999px; padding: 3px 7px; font-size: 11px; }.debug-severity-error { color: #b13636; background: #fff0f0; }.debug-severity-warning { color: #956400; background: #fff7df; }.debug-severity-info { color: #32705b; background: #eaf8f1; }
.debug-detail-grid { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 9px 14px; margin: 16px 0 22px; font-size: 13px; }.debug-detail-grid dt { color: #87919d; }.debug-detail-grid dd { margin: 0; color: #394656; word-break: break-word; }
.debug-message-list { display: grid; gap: 10px; }.debug-message { border: 1px solid #e8ebf0; border-radius: 12px; padding: 13px; }.debug-message-user { background: #f6f9ff; }.debug-message header { display: flex; gap: 9px; align-items: center; color: #7f8995; font-size: 12px; }.debug-message header strong { color: #2c5eae; }.debug-message header time { margin-right: auto; }.debug-message p { white-space: pre-wrap; line-height: 1.65; margin: 9px 0 0; font-size: 13px; }.debug-refused { color: #b33d3d; }.debug-message details { margin-top: 10px; }.debug-message pre, .debug-panel pre { max-height: 420px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
.debug-run { border-left: 3px solid #dbe4f6; padding: 5px 0 16px 15px; margin-left: 6px; }.debug-run > div { display: flex; gap: 10px; align-items: center; font-size: 12px; color: #7d8794; }.debug-run > div strong { color: #43546d; }.debug-run p { margin: 8px 0 4px; font-size: 13px; }.debug-run small { color: #9ba3ae; word-break: break-all; }.debug-dot { width: 8px; height: 8px; border-radius: 50%; background: #8cb5ff; }.debug-dot-completed { background: #26a572; }.debug-dot-failed { background: #d75151; }.debug-dot-running { background: #3275ef; box-shadow: 0 0 0 4px #e6efff; }
.debug-context-block, .debug-model-trace { border-bottom: 1px solid #edf0f3; padding-bottom: 18px; margin-bottom: 18px; }.debug-context-block h3, .debug-model-trace h3 { margin: 0; font-size: 14px; }.debug-context-block h3 + span, .debug-model-trace h3 small { display: block; margin-top: 5px; color: #929ba7; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }.debug-context-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 9px; margin: 14px 0; }.debug-context-grid div { padding: 10px; border-radius: 9px; background: #f7f9fc; }.debug-context-grid span, .debug-context-grid strong { display: block; }.debug-context-grid span { color: #87919d; font-size: 11px; }.debug-context-grid strong { margin-top: 5px; font-size: 13px; }.debug-model-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }.debug-model-grid h4 { margin: 12px 0 6px; font-size: 12px; color: #768190; }.debug-raw pre { max-height: 650px; border-radius: 10px; background: #f7f9fc; padding: 15px; }
.debug-no-selection { min-height: 300px; }.admin-success { color: #177552; background: #ebf9f2; border: 1px solid #c8edda; padding: 10px 12px; border-radius: 9px; }
@media (max-width: 980px) { .debug-layout { grid-template-columns: 1fr; }.debug-case-list { display: block; }.debug-case-item { display: inline-grid; width: 250px; margin: 0 6px 6px 0; vertical-align: top; } .debug-metric-grid { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 620px) { .debug-detail { padding: 14px; }.debug-detail-head { display: grid; }.debug-metric-grid { grid-template-columns: repeat(2, 1fr); }.debug-context-grid, .debug-model-grid { grid-template-columns: 1fr; }.debug-detail-grid { grid-template-columns: 1fr; gap: 3px; }.debug-detail-grid dd { margin-bottom: 8px; } }
</style>
