<script setup lang="ts">
import { Bot, Check, ChevronDown, CircleX, Clock3, Cpu, Database, MessageSquareText, RefreshCw, Search, ShieldCheck, Wrench } from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import { adminApi, type ChatTraceDetail, type ChatTraceItem } from './admin-api';
import AdminPageHeader from './ui/AdminPageHeader.vue';

const props = defineProps<{ token: string }>();
const traces = ref<ChatTraceItem[]>([]);
const selected = ref<ChatTraceDetail | null>(null);
const query = ref('');
const status = ref<'all' | 'answered' | 'refused' | 'failed'>('all');
const inspectorTab = ref<'overview' | 'context' | 'raw'>('overview');
const loading = ref(false);
const error = ref('');
const processExpanded = ref(true);

function usageLabel(step: NonNullable<ChatTraceDetail['contextSnapshot']['executionSteps']>[number]) {
  if (step.totalTokens === null || step.totalTokens === undefined) return '';
  return `${step.totalTokens} tokens`;
}

const filtered = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  return traces.value.filter((trace) => {
    const matchesQuery = !keyword || `${trace.question}${trace.conversationId || ''}${trace.id}`.toLowerCase().includes(keyword);
    const matchesStatus = status.value === 'all'
      || (status.value === 'answered' && trace.status === 'completed' && !trace.refused)
      || (status.value === 'refused' && !!trace.refused)
      || (status.value === 'failed' && trace.status === 'failed');
    return matchesQuery && matchesStatus;
  });
});

const timeline = computed(() => {
  if (!selected.value) return [];
  const trace = selected.value;
  const steps: { title: string; detail: string; duration?: number; icon: typeof Database; ok: boolean }[] = [];
  for (const step of trace.contextSnapshot.executionSteps || []) {
    if (step.type === 'skill_selection') steps.push({
      title: `选择 Skill · ${step.skillId || 'unknown'}`,
      detail: step.detail || `选择方式：${step.selectedBy || 'default'}`,
      duration: step.durationMs,
      icon: ShieldCheck,
      ok: step.ok,
    });
    if (step.type === 'preflight') steps.push({
      title: '知识库预检索',
      detail: step.errorCode ? '预检索失败，Agent 将决定是否重试' : `命中 ${step.hitCount || 0} 个资料片段${step.retrievalMode ? ` · ${step.retrievalMode}` : ''}`,
      duration: step.durationMs,
      icon: Database,
      ok: step.ok,
    });
    if (step.type === 'llm_call') steps.push({
      title: step.stage === 'final_answer' ? '生成最终回答' : '模型规划',
      detail: [step.model || '未指定模型', usageLabel(step), step.attempts && step.attempts > 1 ? `重试 ${step.attempts - 1} 次` : ''].filter(Boolean).join(' · '),
      duration: step.durationMs,
      icon: Bot,
      ok: step.ok,
    });
    if (step.type === 'tool_call') steps.push({
      title: `调用工具 · ${step.name || '未知工具'}`,
      detail: step.ok ? `返回 ${step.result && typeof step.result === 'string' ? `${step.result.length} 字符` : '结构化结果'}` : `工具调用失败${step.errorCode ? ` · ${step.errorCode}` : ''}`,
      duration: step.durationMs,
      icon: Wrench,
      ok: step.ok,
    });
    if (step.type === 'validation') steps.push({
      title: '引用与答案校验',
      detail: step.detail || '已完成答案边界校验',
      duration: step.durationMs,
      icon: ShieldCheck,
      ok: step.ok,
    });
  }
  if (steps.length) return steps;
  if (trace.contextSnapshot.retrievalQuery || trace.contextSnapshot.sources?.length) steps.push({
    title: '检索知识库',
    detail: trace.contextSnapshot.sources?.length ? `命中 ${trace.contextSnapshot.sources.length} 个资料片段` : `检索：${trace.contextSnapshot.retrievalQuery}`,
    icon: Database,
    ok: true,
  });
  for (const call of trace.contextSnapshot.toolCalls || []) steps.push({
    title: `调用工具 · ${call.name}`,
    detail: call.ok ? '工具已返回结构化结果' : '工具调用失败',
    duration: call.durationMs,
    icon: Wrench,
    ok: call.ok,
  });
  steps.push({
    title: trace.kind === 'summary' ? '生成会话摘要' : '生成回答',
    detail: trace.status === 'completed'
      ? (trace.model ? `由 ${trace.model} 完成` : '本轮未调用模型')
      : `${trace.model || '模型'} 调用失败`,
    icon: Bot,
    ok: trace.status === 'completed',
  });
  if (trace.kind === 'answer') steps.push({
    title: trace.refused ? '安全拒答' : '引用与答案校验',
    detail: trace.refused ? '资料不足，系统没有生成无依据结论' : '回答已完成边界和引用校验',
    icon: ShieldCheck,
    ok: trace.status === 'completed',
  });
  return steps;
});

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
}
function traceState(trace: ChatTraceItem) {
  if (trace.status === 'failed') return { label: '失败', className: 'failed' };
  if (trace.kind === 'summary') return { label: '摘要', className: 'summary' };
  if (trace.refused) return { label: '拒答', className: 'refused' };
  return { label: '已回答', className: 'answered' };
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    traces.value = await adminApi.chatTraces(props.token);
    const initial = traces.value.find((trace) => trace.kind === 'answer' && trace.status === 'completed') || traces.value[0];
    if (!selected.value && initial) await choose(initial.id);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '加载对话轨迹失败';
  } finally {
    loading.value = false;
  }
}
async function choose(id: string) {
  loading.value = true;
  error.value = '';
  try {
    selected.value = await adminApi.chatTrace(props.token, id);
    inspectorTab.value = 'overview';
    processExpanded.value = true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '加载轨迹详情失败';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="trace-page">
    <AdminPageHeader eyebrow="运行记录" title="对话轨迹" description="查看访客提问、工具调用、模型输出与最终回答。">
      <template #actions><button class="admin-text-button trace-refresh" :disabled="loading" @click="load"><RefreshCw :size="15" /> 刷新</button></template>
    </AdminPageHeader>
    <p v-if="error" class="admin-error" role="alert">{{ error }}</p>
    <div class="trace-workspace">
      <aside class="trace-list-panel">
        <div class="trace-list-filters"><select v-model="status" aria-label="轨迹状态"><option value="all">全部状态</option><option value="answered">已回答</option><option value="refused">已拒答</option><option value="failed">失败</option></select><label><Search :size="15" /><input v-model="query" placeholder="搜索问题或会话 ID" /></label></div>
        <div class="trace-list" aria-label="对话轨迹列表">
          <button v-for="trace in filtered" :key="trace.id" :class="{ active: selected?.id === trace.id }" @click="choose(trace.id)">
            <span><strong>{{ trace.question || '（会话摘要）' }}</strong><small>{{ formatDate(trace.createdAt) }} · {{ trace.conversationId ? `#${trace.conversationId.slice(0, 10)}` : trace.id.slice(0, 10) }}</small></span>
            <i :class="traceState(trace).className">{{ traceState(trace).label }}</i>
          </button>
          <p v-if="!filtered.length && !loading">没有匹配的轨迹。</p>
        </div>
      </aside>

      <main v-if="selected" class="trace-detail">
        <header class="trace-detail-head"><div><h2>{{ selected.question || '（会话摘要）' }}</h2><p>{{ formatDate(selected.createdAt) }} · 会话 {{ selected.conversationId?.slice(0, 12) || '无会话 ID' }}</p></div><span :class="traceState(selected).className">{{ traceState(selected).label }}</span></header>
        <div class="trace-message visitor"><div class="trace-avatar"><MessageSquareText :size="17" /></div><div><small>访客提问</small><p>{{ selected.question }}</p></div></div>
        <div class="trace-message answer"><div class="trace-avatar"><Bot :size="18" /></div><div><small>最终回答</small><p>{{ selected.finalAnswer || (selected.status === 'failed' ? '调用失败，本轮没有生成回答。' : '—') }}</p></div></div>

        <section class="trace-process"><button class="trace-process-toggle" type="button" :aria-expanded="processExpanded" @click="processExpanded = !processExpanded"><span><h3>执行过程</h3><small>{{ timeline.length }} 个步骤 · 总耗时 {{ selected.durationMs }} ms</small></span><ChevronDown :size="17" :class="{ rotated: processExpanded }" /></button><ol v-if="processExpanded"><li v-for="(step, index) in timeline" :key="`${step.title}-${index}`" :class="{ failed: !step.ok }"><span class="trace-step-icon"><Check v-if="step.ok" :size="13" /><CircleX v-else :size="13" /></span><component :is="step.icon" :size="17" /><div><strong>{{ step.title }}</strong><small>{{ step.detail }}</small></div><time>{{ step.duration === undefined ? '' : `${step.duration} ms` }}</time></li></ol></section>
      </main>

      <aside v-if="selected" class="trace-observer">
        <nav><button :class="{ active: inspectorTab === 'overview' }" @click="inspectorTab = 'overview'">概览</button><button :class="{ active: inspectorTab === 'context' }" @click="inspectorTab = 'context'">上下文</button><button :class="{ active: inspectorTab === 'raw' }" @click="inspectorTab = 'raw'">原始数据</button></nav>
        <template v-if="inspectorTab === 'overview'">
          <section><h3>模型与用量</h3><div class="trace-model"><Cpu :size="19" /><span><strong>{{ selected.model || '未调用模型' }}</strong><small>{{ selected.kind === 'summary' ? '会话摘要' : '回答模型' }}</small></span></div><div class="trace-stats"><span><small>输入 Token</small><strong>{{ selected.inputTokens ?? '—' }}</strong></span><span><small>输出 Token</small><strong>{{ selected.outputTokens ?? '—' }}</strong></span><span><small>总耗时</small><strong>{{ (selected.durationMs / 1000).toFixed(1) }} s</strong></span></div><dl><dt>总 Token</dt><dd>{{ selected.totalTokens ?? '—' }}</dd><dt>工具调用</dt><dd>{{ selected.contextSnapshot.toolCalls?.length || 0 }}</dd><dt>拒答状态</dt><dd>{{ selected.refused ? '是' : '否' }}</dd></dl></section>
          <section><h3>会话信息</h3><dl><dt>轨迹 ID</dt><dd>{{ selected.id.slice(0, 16) }}</dd><dt>会话 ID</dt><dd>{{ selected.conversationId?.slice(0, 16) || '—' }}</dd><dt>提示词版本</dt><dd>{{ selected.contextSnapshot.promptVersion || '—' }}</dd><dt>数据来源</dt><dd>{{ selected.contextSnapshot.dataSource || '知识库与工具' }}</dd></dl></section>
        </template>
        <template v-else-if="inspectorTab === 'context'"><section><h3>会话摘要</h3><p>{{ selected.contextSnapshot.summary || selected.contextSnapshot.previousSummary || '本轮没有会话摘要。' }}</p></section><section><h3>检索资料</h3><article v-for="source in selected.contextSnapshot.sources || []" :key="source.chunkId"><strong>#{{ source.chunkId }} · {{ source.title }}</strong><small>{{ source.heading }}</small><p>{{ source.content }}</p></article><p v-if="!selected.contextSnapshot.sources?.length">本轮没有知识库命中。</p></section><section><h3>执行上下文</h3><article v-for="(step, index) in selected.contextSnapshot.executionSteps || []" :key="`${step.type}-${index}`" class="context-step"><div class="context-step-title"><strong>{{ step.type === 'llm_call' ? (step.stage === 'final_answer' ? '生成最终回答' : '模型规划') : step.type === 'tool_call' ? step.name : '答案校验' }}</strong><small>{{ step.ok ? '成功' : '失败' }} · {{ step.durationMs }} ms<span v-if="step.totalTokens !== null && step.totalTokens !== undefined"> · {{ step.totalTokens }} tokens</span></small></div><details><summary>查看上下文详情</summary><dl v-if="step.type === 'llm_call'"><dt>模型</dt><dd>{{ step.model || '—' }}</dd><dt>结束原因</dt><dd>{{ step.finishReason || '—' }}</dd><dt>重试次数</dt><dd>{{ step.attempts ? step.attempts - 1 : 0 }}</dd></dl><template v-if="step.type === 'tool_call'"><h4>调用参数</h4><pre>{{ Object.keys(step.arguments || {}).length ? JSON.stringify(step.arguments, null, 2) : '该工具无需参数' }}</pre><h4>返回结果</h4><pre>{{ typeof step.result === 'string' ? step.result : JSON.stringify(step.result, null, 2) }}</pre></template><p v-if="step.detail">{{ step.detail }}</p></details></article><p v-if="!selected.contextSnapshot.executionSteps?.length">本轮没有可展开的执行上下文。</p></section></template>
        <template v-else><section><h3>模型原始输出</h3><pre>{{ selected.rawModelOutput || '没有保存原始模型输出。' }}</pre></section><section><h3>上下文快照</h3><pre>{{ JSON.stringify(selected.contextSnapshot, null, 2) }}</pre></section></template>
      </aside>
      <div v-if="!selected && !loading" class="trace-empty">选择一条轨迹查看执行详情。</div>
    </div>
  </section>
</template>

<style scoped>
.trace-page { max-width:none; }
.trace-refresh { display:flex; align-items:center; gap:7px; }
.trace-workspace { display:grid; grid-template-columns:300px minmax(430px,1fr) 335px; min-height:700px; overflow:hidden; border:1px solid #e3e8ef; border-radius:10px; background:#fff; }
.trace-list-panel { min-width:0; border-right:1px solid #e3e8ef; }.trace-list-filters { display:grid; grid-template-columns:108px 1fr; gap:8px; padding:14px; border-bottom:1px solid #e8ecf1; }
.trace-list-filters select,.trace-list-filters input { width:100%; height:36px; box-sizing:border-box; border:1px solid #dce3ec; border-radius:7px; background:#fff; color:#344054; font:inherit; font-size:12px; }.trace-list-filters select { padding:0 9px; }.trace-list-filters label { position:relative; }.trace-list-filters label svg { position:absolute; top:10px; left:10px; color:#8a97aa; }.trace-list-filters input { padding:0 9px 0 31px; }
.trace-list { max-height:645px; overflow:auto; }.trace-list > button { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:8px; width:100%; min-height:65px; padding:11px 13px 11px 16px; border:0; border-bottom:1px solid #edf0f4; border-radius:0; background:#fff; text-align:left; }.trace-list > button:hover,.trace-list > button.active { background:#eef4ff; }.trace-list > button.active { box-shadow:inset 3px 0 #2457e6; }.trace-list span { min-width:0; }.trace-list strong { display:block; overflow:hidden; color:#253047; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }.trace-list small { display:block; overflow:hidden; margin-top:5px; color:#8a96a8; font-size:10px; text-overflow:ellipsis; white-space:nowrap; }.trace-list i,.trace-detail-head > span { padding:4px 7px; border-radius:999px; background:#e8f6ee; color:#248554; font-size:10px; font-style:normal; white-space:nowrap; }.trace-list i.refused,.trace-detail-head > span.refused { background:#fff3dc; color:#9a6800; }.trace-list i.failed,.trace-detail-head > span.failed { background:#ffeded; color:#bd3d3d; }.trace-list i.summary,.trace-detail-head > span.summary { background:#f0edff; color:#6747bd; }.trace-list > p { padding:30px 14px; color:#8a96a8; text-align:center; font-size:12px; }
.trace-detail { min-width:0; padding:18px 22px 30px; }.trace-detail-head { display:flex; justify-content:space-between; gap:16px; padding-bottom:15px; border-bottom:1px solid #edf0f4; }.trace-detail-head h2 { margin:0; color:#172033; font-size:17px; }.trace-detail-head p { margin:6px 0 0; color:#8a96a8; font-size:11px; }
.trace-message { display:grid; grid-template-columns:34px minmax(0,1fr); gap:12px; margin-top:20px; }.trace-message .trace-avatar { display:grid; width:32px; height:32px; place-items:center; border-radius:50%; background:#eef4ff; color:#2457e6; }.trace-message small { margin:0 0 7px; color:#8591a3; font-size:10px; }.trace-message p { margin:0; color:#28344a; font-size:13px; line-height:1.75; white-space:pre-wrap; }.trace-message.answer > div:last-child { padding:15px 17px; border-radius:9px; background:#f7f9fc; }.trace-message.answer .trace-avatar { background:#2457e6; color:#fff; }
.trace-process { margin-top:25px; border-top:1px solid #e7ebf0; }.trace-process-toggle { display:flex; width:100%; align-items:center; justify-content:space-between; padding:18px 0 13px; border:0; background:transparent; text-align:left; }.trace-process-toggle h3 { margin:0; color:#253047; font-size:14px; }.trace-process-toggle small { display:block; margin-top:5px; color:#8a96a8; font-size:10px; }.trace-process-toggle > svg { color:#64748b; transition:transform .18s ease; }.trace-process-toggle > svg.rotated { transform:rotate(180deg); }.trace-process ol { margin:0; padding:0; list-style:none; }.trace-process li { position:relative; display:grid; grid-template-columns:22px 18px minmax(0,1fr) auto; align-items:center; gap:10px; min-height:56px; border-top:1px solid #edf0f4; }.trace-process li::before { position:absolute; top:-20px; bottom:35px; left:10px; width:1px; background:#b9dfca; content:""; }.trace-process li:first-child::before { top:28px; }.trace-step-icon { z-index:1; display:grid; width:20px; height:20px; place-items:center; border-radius:50%; background:#2eae70; color:#fff; }.trace-process li.failed .trace-step-icon { background:#d45151; }.trace-process li > svg { color:#64748b; }.trace-process li div strong { display:block; color:#344054; font-size:12px; }.trace-process li div small { margin-top:4px; color:#8a96a8; font-size:10px; }.trace-process time { color:#8a96a8; font-size:10px; }
.trace-observer { min-width:0; border-left:1px solid #e3e8ef; }.trace-observer > nav { display:grid; grid-template-columns:repeat(3,1fr); height:49px; border-bottom:1px solid #e3e8ef; }.trace-observer > nav button { border:0; border-radius:0; background:#fff; color:#657186; font-size:12px; }.trace-observer > nav button.active { margin-bottom:-1px; border-bottom:2px solid #2457e6; color:#2457e6; font-weight:650; }.trace-observer section { padding:20px; border-bottom:1px solid #edf0f4; }.trace-observer h3 { margin:0 0 14px; color:#253047; font-size:13px; }.trace-model { display:flex; align-items:center; gap:10px; padding:12px; border-radius:8px; background:#eef4ff; color:#2457e6; }.trace-model span { min-width:0; }.trace-model strong { display:block; overflow:hidden; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }.trace-model small { margin:4px 0 0; color:#6f7f98; font-size:10px; }.trace-stats { display:grid; grid-template-columns:repeat(3,1fr); margin:16px 0; }.trace-stats span { padding:0 10px; border-right:1px solid #e8ecf1; }.trace-stats span:first-child { padding-left:0; }.trace-stats span:last-child { border:0; }.trace-stats small { display:block; margin:0 0 6px; color:#8a96a8; font-size:9px; }.trace-stats strong { color:#253047; font-size:16px; }.trace-observer dl { display:grid; grid-template-columns:86px minmax(0,1fr); gap:10px; margin:0; font-size:11px; line-height:1.5; }.trace-observer dt { color:#8a96a8; }.trace-observer dd { margin:0; color:#344054; overflow-wrap:anywhere; }.trace-observer section > p { margin:0; color:#667085; font-size:11px; line-height:1.7; white-space:pre-wrap; }.trace-observer article { padding:11px 0; border-top:1px solid #edf0f4; }.trace-observer article strong,.trace-observer article small { display:block; }.trace-observer article strong { color:#344054; font-size:11px; }.trace-observer article small { margin:4px 0; color:#8a96a8; font-size:10px; }.trace-observer article p,.trace-observer pre { max-height:180px; margin:6px 0 0; overflow:auto; color:#5c687b; font:10px/1.6 ui-monospace,monospace; white-space:pre-wrap; overflow-wrap:anywhere; }.trace-observer section > pre { max-height:270px; overflow:auto; padding:12px; border-radius:7px; background:#f6f8fb; color:#4c596d; font:10px/1.6 ui-monospace,monospace; white-space:pre-wrap; overflow-wrap:anywhere; }.trace-empty { grid-column:2/-1; display:grid; place-items:center; color:#8a96a8; font-size:13px; }
.context-step-title { display:flex; align-items:baseline; justify-content:space-between; gap:8px; }.context-step-title small { margin:0; white-space:nowrap; }.context-step details { margin-top:8px; }.context-step summary { cursor:pointer; color:#2457e6; font-size:10px; }.context-step h4 { margin:10px 0 4px; color:#667085; font-size:10px; font-weight:600; }.context-step dl { display:grid; grid-template-columns:65px minmax(0,1fr); gap:5px 8px; margin:10px 0; font-size:10px; }.context-step dd { margin:0; color:#344054; overflow-wrap:anywhere; }
@media(max-width:1450px) { .trace-workspace { grid-template-columns:260px minmax(0,1fr); }.trace-observer { grid-column:1/-1; border-top:1px solid #e3e8ef; border-left:0; }.trace-observer > template { display:block; } }
@media(max-width:850px) { .trace-workspace { display:block; }.trace-list-panel { border-right:0; }.trace-list { max-height:280px; }.trace-detail,.trace-observer section { padding-left:16px; padding-right:16px; }.trace-list-filters { grid-template-columns:105px 1fr; } }
</style>
