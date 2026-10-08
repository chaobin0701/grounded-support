<script setup lang="ts">
import { Copy, ExternalLink, LoaderCircle, X } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { adminApi, type ChatTraceDetail, type DebugTrace } from './admin-api';
import {
  formatDuration,
  groupTraceSteps,
  type TraceStep,
} from './conversation-view';
const props = withDefaults(
  defineProps<{
    token: string;
    trace: ChatTraceDetail | null;
    loading?: boolean;
    error?: string;
    canDebug?: boolean;
    showHeading?: boolean;
  }>(),
  { showHeading: true },
);
const emit = defineEmits<{
  close: [];
  copy: [value: string, label: string];
  link: [];
}>();
const tab = ref('overview');
const expanded = ref<DebugTrace | null>(null);
const debugLoading = ref(false);
const debugError = ref('');
let debugRequest = 0;
watch(
  () => props.trace?.id,
  () => {
    debugRequest++;
    expanded.value = null;
    debugLoading.value = false;
    debugError.value = '';
    tab.value = 'overview';
  },
);
const context = computed(() => props.trace?.contextSnapshot ?? {});
const groups = computed(() =>
  groupTraceSteps(context.value.executionSteps ?? []),
);
const toolSteps = computed(
  () =>
    context.value.executionSteps?.filter((step) => step.type === 'tool_call') ??
    [],
);
const modelCalls = computed(
  () =>
    (expanded.value?.contextSnapshot.modelCalls ?? []) as Record<
      string,
      unknown
    >[],
);
const snapshot = computed(
  () => expanded.value?.contextSnapshot ?? context.value,
);
const skill = computed(
  () =>
    context.value.executionSteps?.find(
      (step) => step.type === 'skill_selection',
    )?.skillId ?? '—',
);
const traceStatus = computed(() =>
  props.trace?.status === 'failed'
    ? '执行失败'
    : props.trace?.refused
      ? '拒答'
      : props.trace?.status === 'completed'
        ? '已回答'
        : (props.trace?.status ?? '—'),
);
function json(value: unknown) {
  return JSON.stringify(value, null, 2);
}
function stepLabel(step: TraceStep) {
  if (step.type === 'tool_call') return step.name || '工具调用';
  if (step.type === 'llm_call')
    return step.stage === 'final_answer' ? '生成回答' : '模型规划';
  if (step.type === 'preflight') return '预检索';
  if (step.type === 'skill_selection') return '选择能力';
  return '格式校验';
}
async function loadDebug() {
  if (!props.canDebug || !props.trace || debugLoading.value) return;
  const id = props.trace.id;
  const request = ++debugRequest;
  debugLoading.value = true;
  debugError.value = '';
  try {
    const result = await adminApi.debugInspect(props.token, { traceIds: [id] });
    if (request !== debugRequest) return;
    const trace = result.conversations
      .flatMap((item) => item.traces)
      .find((item) => item.id === id);
    if (!trace) throw new Error('未找到这条轨迹的完整上下文');
    expanded.value = trace;
  } catch (cause) {
    if (request === debugRequest)
      debugError.value =
        cause instanceof Error ? cause.message : '加载完整上下文失败';
  } finally {
    if (request === debugRequest) debugLoading.value = false;
  }
}
function copyIds() {
  if (props.trace)
    emit(
      'copy',
      `轨迹 ID: ${props.trace.id}\n会话 ID: ${props.trace.conversationId || '—'}`,
      '轨迹和会话 ID',
    );
}
</script>
<template>
  <div class="trace-panel">
    <header v-if="showHeading" class="trace-panel-heading">
      <strong>轨迹检查</strong
      ><button type="button" aria-label="关闭轨迹面板" @click="emit('close')">
        <X :size="16" />
      </button>
    </header>
    <div v-if="loading" class="trace-empty" role="status">
      <LoaderCircle class="spin" :size="20" /> 正在加载轨迹…
    </div>
    <div v-else-if="error" class="trace-empty trace-error" role="alert">
      {{ error }}
    </div>
    <div v-else-if="!trace" class="trace-empty">
      这轮对话暂无轨迹，可先查看消息和运行状态。
    </div>
    <template v-else>
      <nav class="trace-tabs" aria-label="轨迹信息">
        <button
          v-for="item in [
            { id: 'overview', label: '概览' },
            { id: 'process', label: '执行过程' },
            { id: 'context', label: '上下文' },
            ...(canDebug ? [{ id: 'raw', label: '原始数据' }] : []),
          ]"
          :key="item.id"
          :class="{ selected: tab === item.id }"
          :aria-pressed="tab === item.id"
          @click="tab = item.id"
        >
          {{ item.label }}
        </button>
      </nav>
      <div class="trace-panel-scroll">
        <div class="trace-identifiers">
          <label
            >轨迹 ID <code>{{ trace.id }}</code></label
          ><label
            >会话 ID <code>{{ trace.conversationId || '—' }}</code></label
          >
          <div>
            <button @click="copyIds"><Copy :size="13" />复制两项 ID</button
            ><button @click="emit('link')">
              <ExternalLink :size="13" />复制定位链接
            </button>
          </div>
        </div>
        <section v-if="tab === 'overview'" class="trace-section">
          <div class="trace-metrics">
            <div>
              <span>状态</span
              ><strong :class="{ 'trace-error': trace.status === 'failed' }">{{
                traceStatus
              }}</strong>
            </div>
            <div>
              <span>总耗时</span
              ><strong>{{ formatDuration(trace.durationMs) }}</strong>
            </div>
            <div>
              <span>模型调用</span
              ><strong
                >{{
                  context.executionSteps?.filter(
                    (step) => step.type === 'llm_call',
                  ).length ?? 0
                }}
                次</strong
              >
            </div>
            <div>
              <span>工具调用</span><strong>{{ toolSteps.length }} 次</strong>
            </div>
          </div>
          <dl>
            <dt>模型</dt>
            <dd>{{ trace.model || '—' }}</dd>
            <dt>Skill</dt>
            <dd>{{ skill }}</dd>
            <dt>输入 / 输出</dt>
            <dd>
              {{ trace.inputTokens ?? '—' }} /
              {{ trace.outputTokens ?? '—' }} tokens
            </dd>
            <dt>总 Token</dt>
            <dd>{{ trace.totalTokens ?? '—' }}</dd>
            <dt>错误码</dt>
            <dd>{{ trace.errorCode || '无' }}</dd>
            <template v-if="context.contextBudget"
              ><dt>上下文压力</dt>
              <dd>{{ context.contextBudget.pressure }}</dd>
              <dt>估算 / 预算</dt>
              <dd>
                {{ context.contextBudget.estimatedInputTokens }} /
                {{ context.contextBudget.inputBudgetTokens }}
              </dd>
              <dt>历史压缩</dt>
              <dd>
                {{ context.contextBudget.compacted ? '已压缩' : '未压缩' }}
              </dd></template
            >
          </dl>
          <p class="trace-note">
            回答内容在对话中查看；这里展示执行状态，不对答案正确性作额外判断。
          </p>
        </section>
        <section v-else-if="tab === 'process'" class="trace-section">
          <div
            v-for="(group, index) in groups"
            :key="index"
            class="trace-group"
          >
            <header>
              <strong>{{ group.label }}</strong
              ><span>{{ formatDuration(group.durationMs) }}</span>
            </header>
            <details
              v-for="(step, stepIndex) in group.steps"
              :key="stepIndex"
              class="trace-step"
            >
              <summary>
                <i :class="{ failed: !step.ok }"></i
                ><span>{{ stepLabel(step) }}</span
                ><small
                  >{{ step.ok ? '完成' : '失败' }} ·
                  {{ formatDuration(step.durationMs) }}</small
                >
              </summary>
              <div class="step-detail">
                <p>{{ step.detail || (step.ok ? '执行完成' : '执行失败') }}</p>
                <p v-if="step.errorCode" class="trace-error">
                  {{ step.errorCode }}
                </p>
                <p v-if="step.toolBatchId">
                  顺序执行批次 · 第 {{ (step.toolIndex ?? 0) + 1 }} 个工具
                </p>
                <template v-if="step.arguments"
                  ><h4>工具参数</h4>
                  <pre>{{ json(step.arguments) }}</pre></template
                ><template v-if="step.result !== undefined"
                  ><h4>工具结果</h4>
                  <pre>{{ json(step.result) }}</pre>
                </template>
                <p v-if="step.type === 'llm_call'">
                  {{ step.model }} · {{ step.totalTokens ?? '—' }} tokens ·
                  {{ step.attempts ?? 1 }} 次尝试
                </p>
              </div>
            </details>
          </div>
          <p v-if="!groups.length" class="trace-note">
            这条历史轨迹未记录分步执行过程。
          </p>
        </section>
        <section v-else-if="tab === 'context'" class="trace-section">
          <h3>
            检索资料 <span>{{ context.sources?.length ?? 0 }}</span>
          </h3>
          <details
            v-for="source in context.sources ?? []"
            :key="source.chunkId"
            class="context-block"
          >
            <summary>#{{ source.chunkId }} · {{ source.title }}</summary>
            <p>{{ source.heading }}</p>
            <p>{{ source.content }}</p>
          </details>
          <p v-if="!context.sources?.length" class="trace-note">
            本轮没有知识库命中。
          </p>
          <details class="context-block">
            <summary>产品工具结果</summary>
            <pre>{{
              json({
                products: context.products ?? [],
                details: context.productDetails ?? [],
                categories: context.categories ?? [],
              })
            }}</pre>
          </details>
          <details class="context-block">
            <summary>会话摘要与最近消息</summary>
            <pre>{{
              json({
                summary: context.summary ?? context.previousSummary,
                history: context.history,
                messages: context.messages ?? context.recentMessages,
              })
            }}</pre>
          </details>
          <h3>模型调用上下文</h3>
          <template v-if="canDebug"
            ><button
              v-if="!expanded"
              class="debug-load"
              :disabled="debugLoading"
              @click="loadDebug"
            >
              {{ debugLoading ? '正在读取…' : '加载完整模型请求与响应' }}
            </button>
            <p v-if="debugError" class="trace-error" role="alert">
              {{ debugError }}
            </p>
            <details
              v-for="(call, index) in modelCalls"
              :key="index"
              class="context-block"
            >
              <summary>
                {{ index + 1 }}. {{ call.purpose || '模型调用' }} ·
                {{ call.model || '—' }}
              </summary>
              <pre>{{ json(call) }}</pre>
            </details>
            <p v-if="expanded && !modelCalls.length" class="trace-note">
              这条历史轨迹没有完整模型调用记录。
            </p></template
          >
          <p v-else class="trace-note">
            完整模型请求和系统提示词仅向拥有会话调试权限的管理员开放。
          </p>
        </section>
        <section v-else class="trace-section">
          <p class="trace-note">
            完整上下文可能较长，按需加载。读取操作会记录审计日志。
          </p>
          <button
            v-if="!expanded"
            class="debug-load"
            :disabled="debugLoading"
            @click="loadDebug"
          >
            {{ debugLoading ? '正在读取…' : '加载原始数据' }}
          </button>
          <p v-if="debugError" class="trace-error" role="alert">
            {{ debugError }}
          </p>
          <template v-if="expanded"
            ><button
              class="debug-load"
              @click="emit('copy', json(expanded), '完整轨迹 JSON')"
            >
              <Copy :size="13" />复制完整轨迹 JSON
            </button>
            <details class="context-block">
              <summary>原始模型输出</summary>
              <pre>{{ expanded.rawModelOutput || '未记录原始输出' }}</pre>
            </details>
            <details class="context-block">
              <summary>完整上下文快照</summary>
              <pre>{{ json(snapshot) }}</pre>
            </details></template
          >
        </section>
      </div>
    </template>
  </div>
</template>
<style scoped>
.trace-panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
  color: #344054;
  font-size: 12px;
}
.trace-panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  padding: 14px 18px;
  border-bottom: 1px solid #e7ecf2;
  font-size: 13px;
}
.trace-panel button {
  cursor: pointer;
}
.trace-panel-heading button {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #667085;
}
.trace-panel-heading button:hover {
  background: #f2f4f7;
}
.trace-tabs {
  display: flex;
  flex: none;
  padding: 0 12px;
  border-bottom: 1px solid #e7ecf2;
}
.trace-tabs button {
  flex: 1;
  min-height: 42px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: #fff;
  color: #667085;
  font-size: 12px;
  white-space: nowrap;
}
.trace-tabs button.selected {
  border-bottom-color: #2457e6;
  color: #2457e6;
  font-weight: 650;
}
.trace-panel-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}
.trace-identifiers {
  padding: 16px 18px;
  border-bottom: 1px solid #e7ecf2;
}
.trace-identifiers label {
  display: grid;
  gap: 4px;
  margin-bottom: 10px;
  color: #98a2b3;
  font-size: 10px;
}
.trace-identifiers code {
  font:
    11px/1.6 ui-monospace,
    monospace;
  color: #475467;
  overflow-wrap: anywhere;
}
.trace-identifiers > div {
  display: flex;
  gap: 16px;
}
.trace-identifiers button {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: #2457e6;
  font-size: 11px;
}
.trace-section {
  padding: 18px;
}
.trace-metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 22px;
}
.trace-metrics div {
  display: grid;
  gap: 6px;
}
.trace-metrics span {
  color: #98a2b3;
  font-size: 11px;
}
.trace-metrics strong {
  font-size: 16px;
  color: #27344a;
}
.trace-section dl {
  display: grid;
  grid-template-columns: 90px minmax(0, 1fr);
  gap: 12px;
  margin: 0;
}
.trace-section dt {
  color: #98a2b3;
}
.trace-section dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.trace-note {
  color: #8a96a8;
  line-height: 1.7;
  font-size: 11px;
  margin: 18px 0;
}
.trace-error {
  color: #bd3d3d !important;
  line-height: 1.7;
}
.trace-group {
  margin-bottom: 20px;
}
.trace-group > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  font-size: 12px;
}
.trace-group > header span {
  font-size: 11px;
  color: #8a96a8;
}
.trace-step {
  padding-left: 10px;
  margin-left: 4px;
  border-left: 1px solid #e7ecf2;
}
.trace-step summary {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 0;
  cursor: pointer;
  list-style: none;
}
.trace-step summary::after {
  content: '›';
  color: #98a2b3;
  transform: rotate(90deg);
}
.trace-step[open] summary::after {
  transform: rotate(-90deg);
}
.trace-step i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #35a572;
  flex: none;
}
.trace-step i.failed {
  background: #dd5c5c;
}
.trace-step summary span {
  overflow-wrap: anywhere;
  min-width: 0;
  flex: 1;
}
.trace-step small {
  font-size: 10px;
  white-space: nowrap;
  color: #8a96a8;
}
.step-detail {
  padding: 0 0 10px 13px;
  font-size: 11px;
  line-height: 1.7;
  color: #667085;
}
.trace-section h3 {
  font-size: 13px;
  color: #27344a;
  margin: 0 0 12px;
}
.trace-section h3:not(:first-child) {
  margin-top: 24px;
}
.trace-section h3 span {
  color: #98a2b3;
  margin-left: 6px;
}
.trace-section h4 {
  margin: 10px 0 4px;
  font-size: 11px;
  font-weight: 500;
}
.trace-panel pre {
  max-height: 360px;
  overflow: auto;
  padding: 12px;
  border: 1px solid #e7ecf2;
  border-radius: 6px;
  background: #f8fafc;
  font:
    11px/1.7 ui-monospace,
    monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.context-block {
  margin-bottom: 10px;
  border-bottom: 1px solid #edf0f4;
}
.context-block summary {
  padding: 10px 0;
  color: #475467;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.context-block p {
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.debug-load {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 6px 12px;
  border: 1px solid #dbe2eb;
  border-radius: 7px;
  background: #fff;
  color: #2457e6;
  font-size: 12px;
}
.debug-load:disabled {
  opacity: 0.5;
  cursor: wait;
}
.trace-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex: 1;
  padding: 28px;
  line-height: 1.7;
  color: #98a2b3;
  text-align: center;
}
.spin {
  animation: trace-spin 1s linear infinite;
}
@keyframes trace-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}
</style>
