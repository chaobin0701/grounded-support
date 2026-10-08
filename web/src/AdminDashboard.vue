<script setup lang="ts">
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Database,
  FileText,
  MessageSquareText,
  RefreshCw,
  Users,
  Zap,
} from '@lucide/vue';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  adminApi,
  type DashboardOverview,
  type DashboardRange,
} from './admin-api';
import AdminPageHeader from './ui/AdminPageHeader.vue';
import ToastNotice from './ui/ToastNotice.vue';
type TrendPoint = NonNullable<DashboardOverview['activity']>['trend'][number];

const props = defineProps<{ token: string }>();
const range = ref<DashboardRange>('7d');
const data = ref<DashboardOverview | null>(null);
const loading = ref(false);
const error = ref('');
const chartElement = ref<HTMLElement | null>(null);
const plotWidth = ref(800);
let requestId = 0;
let observer: ResizeObserver | undefined;
const labels: Record<DashboardRange, string> = {
  '24h': '最近 24 小时',
  '7d': '最近 7 天',
  '30d': '最近 30 天',
};
const activity = computed(() => data.value?.activity);
const knowledge = computed(() => data.value?.knowledge);
const points = computed(() => activity.value?.trend ?? []);
const peak = computed(() =>
  Math.max(
    1,
    ...points.value.map(
      (point) => point.answered + point.refused + point.failed,
    ),
  ),
);
const chartMax = computed(() => {
  const base = Math.pow(10, Math.floor(Math.log10(peak.value)));
  return Math.ceil(peak.value / base) * base;
});
const slotWidth = computed(
  () => (plotWidth.value - 68) / Math.max(points.value.length, 1),
);
const barWidth = computed(() =>
  Math.max(2, Math.min(36, slotWidth.value * 0.58)),
);
const tickEvery = computed(() =>
  Math.max(1, Math.ceil(points.value.length / (plotWidth.value < 480 ? 4 : 8))),
);
const hasChartData = computed(() =>
  points.value.some(
    (point) => point.answered + point.refused + point.failed > 0,
  ),
);
const percentage = computed(() =>
  activity.value?.requestCount
    ? `${((activity.value.refusedCount / activity.value.requestCount) * 100).toFixed(1)}%`
    : '—',
);

function number(value: number | null | undefined) {
  return value == null ? '—' : value.toLocaleString('zh-CN');
}
function duration(value: number | null | undefined) {
  return value == null
    ? '—'
    : value >= 1000
      ? `${(value / 1000).toFixed(1)} s`
      : `${Math.round(value)} ms`;
}
function date(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function height(value: number) {
  return (value / chartMax.value) * 154;
}
function pointLabel(point: TrendPoint) {
  return `${date(point.time)}：已回答 ${point.answered}，拒答 ${point.refused}，执行失败 ${point.failed}`;
}
function showTick(index: number) {
  const last = points.value.length - 1;
  // Keep the last date, but omit the preceding regular tick if they would overlap.
  return (
    index === last ||
    (index % tickEvery.value === 0 && last - index >= tickEvery.value)
  );
}
function traceLink(
  item: NonNullable<DashboardOverview['activity']>['recentFailures'][number],
) {
  return {
    path: item.conversationId ? `/admin/conversations/${item.conversationId}` : '/admin/conversations',
    query: {
      ...(item.traceId ? { traceId: item.traceId } : {}),
    },
  };
}
async function load() {
  const request = ++requestId;
  loading.value = true;
  error.value = '';
  try {
    const result = await adminApi.dashboard(props.token, range.value);
    if (request === requestId) data.value = result;
  } catch (cause) {
    if (request === requestId)
      error.value = cause instanceof Error ? cause.message : '统计数据加载失败';
  } finally {
    if (request === requestId) loading.value = false;
  }
}
const cards = computed(() =>
  activity.value
    ? [
        {
          label: '问答请求',
          value: number(activity.value.requestCount),
          note: `已回答 ${number(activity.value.answeredCount)} · 拒答 ${number(activity.value.refusedCount)}`,
          icon: MessageSquareText,
          tone: 'blue',
        },
        {
          label: '活跃会话',
          value: number(activity.value.conversationCount),
          note: `${number(activity.value.visitorCount)} 位访客提交了问题`,
          icon: Users,
          tone: 'cyan',
        },
        {
          label: '执行失败',
          value: number(activity.value.failedCount),
          note: `运行记录失败 ${number(activity.value.failedRunCount)} 次（独立口径）`,
          icon: AlertTriangle,
          tone: activity.value.failedCount ? 'red' : 'neutral',
        },
        {
          label: '平均响应耗时',
          value: duration(activity.value.averageDurationMs),
          note: '完成请求（含拒答），非首字延迟',
          icon: Clock3,
          tone: 'violet',
        },
      ]
    : knowledge.value
      ? [
          {
            label: '知识库',
            value: number(knowledge.value.baseCount),
            note: `${knowledge.value.enabledBaseCount} 个已启用`,
            icon: Database,
            tone: 'blue',
          },
          {
            label: '可检索文档',
            value: number(knowledge.value.retrievableCount),
            note: `共 ${knowledge.value.documentCount} 份非归档文件`,
            icon: FileText,
            tone: 'cyan',
          },
          {
            label: '待处理 / 处理中',
            value: number(knowledge.value.processingCount),
            note: '文档处理队列的当前状态',
            icon: Clock3,
            tone: 'violet',
          },
          {
            label: '处理失败',
            value: number(knowledge.value.failedCount),
            note: '查看文档详情后重新解析',
            icon: AlertTriangle,
            tone: knowledge.value.failedCount ? 'red' : 'neutral',
          },
        ]
      : [],
);
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    plotWidth.value = Math.max(
      280,
      Math.round(entry?.contentRect.width ?? 800),
    );
  });
  if (chartElement.value) observer.observe(chartElement.value);
  void load();
});
// The chart mounts after the initial data request; a ref callback also attaches the observer then.
function observeChart(element: unknown) {
  chartElement.value = element instanceof HTMLElement ? element : null;
  if (chartElement.value && observer) observer.observe(chartElement.value);
}
onUnmounted(() => {
  requestId++;
  observer?.disconnect();
});
</script>

<template>
  <section class="dashboard-page" :aria-busy="loading">
    <AdminPageHeader
      title="概览"
      ><template #actions
        ><select
          v-model="range"
          class="ui-input dashboard-range"
          aria-label="统计时间范围"
          @change="load"
        >
          <option v-for="(label, key) in labels" :key="key" :value="key">
            {{ label }}
          </option></select
        ><button class="ui-button" :disabled="loading" @click="load">
          <RefreshCw :size="15" :class="{ spinning: loading }" />刷新
        </button></template
      ></AdminPageHeader
    >
    <ToastNotice :message="error" type="error" @dismiss="error = ''" />
    <div
      v-if="loading && !data"
      class="dashboard-skeleton"
      role="status"
      aria-label="正在加载统计数据"
    >
      <div v-for="index in 4" :key="index">
        <span></span><i></i><span></span>
      </div>
    </div>
    <div v-else-if="!data" class="dashboard-empty" role="alert">
      <AlertTriangle :size="24" />
      <h2>暂时无法读取统计数据</h2>
      <p>{{ error || '请刷新重试。' }}</p>
      <button class="ui-button" :disabled="loading" @click="load">
        重新加载
      </button>
    </div>
    <template v-else>
      <div class="dashboard-period">
        <span
          >{{ activity ? labels[data.range.key] : '当前资料快照'
          }}<span v-if="loading"> · 正在更新…</span
          ><span v-else-if="error"> · 显示上次成功加载的数据</span></span
        ><time>更新于 {{ date(data.generatedAt) }} · 北京时间</time>
      </div>
      <div class="dashboard-metrics">
        <article
          v-for="card in cards"
          :key="card.label"
          class="dashboard-metric"
        >
          <div>
            <span>{{ card.label }}</span
            ><span class="metric-icon" :class="card.tone"
              ><component :is="card.icon" :size="17"
            /></span>
          </div>
          <strong>{{ card.value }}</strong
          ><small>{{ card.note }}</small>
        </article>
      </div>
      <div
        class="dashboard-main-grid"
        :class="{ 'knowledge-only': !activity || !knowledge }"
      >
        <section v-if="activity" class="dashboard-panel dashboard-trend">
          <header>
            <div>
              <h2>问答趋势</h2>
              <p>
                {{
                  data.range.bucket === 'hour' ? '按小时统计' : '按自然日统计'
                }}
                · {{ labels[data.range.key] }}
              </p>
            </div>
            <RouterLink to="/admin/conversations"
              >查看会话<ArrowUpRight :size="14"
            /></RouterLink>
          </header>
          <div class="chart-legend">
            <span
              ><i class="answered"></i>已回答
              {{ number(activity.answeredCount) }}</span
            ><span
              ><i class="refused"></i>拒答
              {{ number(activity.refusedCount) }}</span
            ><span
              ><i class="failed"></i>失败
              {{ number(activity.failedCount) }}</span
            >
          </div>
          <div :ref="observeChart" class="dashboard-chart">
            <svg
              v-if="hasChartData"
              :viewBox="`0 0 ${plotWidth} 232`"
              role="img"
              :aria-label="`${labels[data.range.key]}问答趋势，已回答 ${activity.answeredCount}，拒答 ${activity.refusedCount}，执行失败 ${activity.failedCount}`"
            >
              <g v-for="ratio in [0, 0.5, 1]" :key="ratio">
                <line
                  x1="44"
                  :x2="plotWidth - 24"
                  :y1="190 - ratio * 154"
                  :y2="190 - ratio * 154"
                  class="chart-gridline"
                />
                <text
                  x="35"
                  :y="194 - ratio * 154"
                  text-anchor="end"
                  class="chart-axis"
                >
                  {{ number(Math.round(chartMax * ratio)) }}
                </text>
              </g>
              <g
                v-for="(point, index) in points"
                :key="point.time"
                tabindex="0"
                :aria-label="pointLabel(point)"
              >
                <title>{{ pointLabel(point) }}</title>
                <rect
                  :x="44 + slotWidth * index + (slotWidth - barWidth) / 2"
                  :y="190 - height(point.answered)"
                  :width="barWidth"
                  :height="height(point.answered)"
                  class="chart-answered"
                />
                <rect
                  :x="44 + slotWidth * index + (slotWidth - barWidth) / 2"
                  :y="190 - height(point.answered + point.refused)"
                  :width="barWidth"
                  :height="height(point.refused)"
                  class="chart-refused"
                />
                <rect
                  :x="44 + slotWidth * index + (slotWidth - barWidth) / 2"
                  :y="
                    190 - height(point.answered + point.refused + point.failed)
                  "
                  :width="barWidth"
                  :height="height(point.failed)"
                  class="chart-failed"
                />
                <text
                  v-if="
                    points.length <= 8 &&
                    point.answered + point.refused + point.failed
                  "
                  :x="44 + slotWidth * (index + 0.5)"
                  :y="
                    182 - height(point.answered + point.refused + point.failed)
                  "
                  text-anchor="middle"
                  class="chart-value"
                >
                  {{ point.answered + point.refused + point.failed }}
                </text>
                <text
                  v-if="showTick(index)"
                  :x="44 + slotWidth * (index + 0.5)"
                  y="217"
                  text-anchor="middle"
                  class="chart-axis"
                >
                  {{ point.label }}
                </text>
              </g>
            </svg>
            <div v-else class="chart-empty">
              <MessageSquareText :size="26" /><strong
                >此范围内暂无问答记录</strong
              >
              <p>用户完成问答后，真实统计会显示在这里。</p>
            </div>
          </div>
          <div class="dashboard-secondary">
            <div>
              <span>拒答比例</span><strong>{{ percentage }}</strong>
            </div>
            <div>
              <span>P95 响应耗时</span
              ><strong>{{ duration(activity.p95DurationMs) }}</strong>
            </div>
            <div>
              <span>问答 Token</span
              ><strong>{{ number(activity.totalTokens) }}</strong>
            </div>
          </div>
          <details class="dashboard-data-table">
            <summary>查看统计明细与口径</summary>
            <p>
              问答量来自回答轨迹，排除摘要轨迹；耗时只统计已完成请求，拒答不算执行失败。Token
              记录覆盖 {{ activity.tokenRecordedCount }} /
              {{ activity.requestCount }}
              条，未记录的用量不会估算。活跃会话仅统计此期间提交过问题的会话。
            </p>
            <div>
              <table>
                <thead>
                  <tr>
                    <th>北京时间</th>
                    <th>已回答</th>
                    <th>拒答</th>
                    <th>执行失败</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="point in points" :key="point.time">
                    <td>{{ date(point.time) }}</td>
                    <td>{{ point.answered }}</td>
                    <td>{{ point.refused }}</td>
                    <td>{{ point.failed }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
        </section>
        <section v-if="knowledge" class="dashboard-panel dashboard-knowledge">
          <header>
            <div>
              <h2>资料状态</h2>
              <p>当前快照，不受问答时间筛选影响</p>
            </div>
            <RouterLink to="/admin/knowledge"
              >管理<ArrowUpRight :size="14"
            /></RouterLink>
          </header>
          <div class="knowledge-heading">
            <span class="metric-icon blue"><Database :size="19" /></span
            ><strong
              >{{ number(knowledge.baseCount) }}<small>个知识库</small></strong
            ><span>{{ number(knowledge.enabledBaseCount) }} 个已启用</span>
          </div>
          <dl>
            <div>
              <dt><FileText :size="15" />文档总数</dt>
              <dd>{{ number(knowledge.documentCount) }}</dd>
            </div>
            <div>
              <dt><CheckCircle2 :size="15" class="green-icon" />可检索文档</dt>
              <dd>{{ number(knowledge.retrievableCount) }}</dd>
            </div>
            <div>
              <dt><Clock3 :size="15" class="amber-icon" />待处理 / 处理中</dt>
              <dd>{{ number(knowledge.processingCount) }}</dd>
            </div>
            <div>
              <dt><AlertTriangle :size="15" class="red-icon" />处理失败</dt>
              <dd :class="{ 'red-icon': knowledge.failedCount }">
                {{ number(knowledge.failedCount) }}
              </dd>
            </div>
            <div>
              <dt><Zap :size="15" />可检索分段</dt>
              <dd>{{ number(knowledge.chunkCount) }}</dd>
            </div>
          </dl>
          <p class="dashboard-note">
            排除已归档知识库、归档文档和
            FAQ。可检索文档需启用检索，且知识库已启用并存在可用分段。
          </p>
        </section>
      </div>
      <div
        v-if="activity?.runningCount || activity?.expiredCount"
        class="dashboard-run-state"
      >
        <Clock3 :size="16" /><span
          >当前正在执行 {{ activity.runningCount }} 个请求<span
            v-if="activity.expiredCount"
            >，另有 {{ activity.expiredCount }} 个运行记录已超时但尚未结束</span
          >。</span
        ><RouterLink to="/admin/conversations"
          >查看会话<ArrowUpRight :size="14"
        /></RouterLink>
      </div>
      <div
        class="dashboard-attention-grid"
        :class="{ 'knowledge-only': !activity || !knowledge }"
      >
        <section v-if="activity" class="dashboard-panel">
          <header>
            <div>
              <h2>最近异常请求</h2>
              <p>执行失败或超时，最多显示 5 条</p>
            </div>
            <RouterLink to="/admin/conversations"
              >查看全部<ArrowUpRight :size="14"
            /></RouterLink>
          </header>
          <div v-if="!activity.recentFailures.length" class="attention-empty">
            <CheckCircle2 :size="20" /><span>没有需要关注的异常请求</span>
          </div>
          <RouterLink
            v-for="(item, index) in activity.recentFailures"
            :key="item.traceId || `${item.conversationId}-${index}`"
            :to="traceLink(item)"
            class="attention-item"
            ><span class="attention-icon"><AlertTriangle :size="16" /></span>
            <div>
              <strong>{{ item.question || '未记录问题' }}</strong
              ><small
                >{{ item.traceId ? '回答轨迹' : '运行记录' }} ·
                {{
                  item.errorCode ||
                  (item.status === 'expired' ? '运行超时' : '执行失败')
                }}
                · {{ date(item.createdAt) }}</small
              >
            </div>
            <ArrowUpRight :size="15"
          /></RouterLink>
        </section>
        <section v-if="knowledge" class="dashboard-panel">
          <header>
            <div>
              <h2>待处理的失败文档</h2>
              <p>当前未归档的失败文档，最多显示 5 条</p>
            </div>
            <RouterLink to="/admin/knowledge"
              >查看全部<ArrowUpRight :size="14"
            /></RouterLink>
          </header>
          <div v-if="!knowledge.recentFailures.length" class="attention-empty">
            <CheckCircle2 :size="20" /><span>没有处理失败的文档</span>
          </div>
          <RouterLink
            v-for="item in knowledge.recentFailures"
            :key="item.id"
            :to="`/admin/knowledge/${item.baseId}/documents/${item.id}`"
            class="attention-item"
            ><span class="attention-icon"><FileText :size="16" /></span>
            <div>
              <strong>{{ item.title }}</strong
              ><small>{{ item.baseName }} · {{ date(item.updatedAt) }}</small>
            </div>
            <ArrowUpRight :size="15"
          /></RouterLink>
        </section>
      </div>
    </template>
  </section>
</template>

<style scoped>
.dashboard-page {
  min-width: 0;
  color: #344054;
}
.dashboard-range {
  width: 146px;
  height: 39px;
  font-size: 12px;
}
.dashboard-period {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  color: #667085;
  font-size: 12px;
  flex-wrap: wrap;
}
.dashboard-period time {
  font-size: 11px;
  color: #8a96a8;
}
.dashboard-metrics,
.dashboard-skeleton {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}
.dashboard-metric {
  padding: 19px 20px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fff;
  min-width: 0;
}
.dashboard-metric > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  color: #667085;
}
.metric-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 8px;
}
.metric-icon.blue {
  color: #2457e6;
  background: #eef4ff;
}
.metric-icon.cyan {
  color: #07888e;
  background: #edfafa;
}
.metric-icon.violet {
  color: #7c55bd;
  background: #f4effa;
}
.metric-icon.red {
  color: #c24141;
  background: #fff0ef;
}
.metric-icon.neutral {
  color: #667085;
  background: #f4f6f8;
}
.dashboard-metric > strong {
  display: block;
  margin: 13px 0 9px;
  font-size: 30px;
  line-height: 1.2;
  font-weight: 650;
  letter-spacing: -0.035em;
  color: #172033;
  font-variant-numeric: tabular-nums;
}
.dashboard-metric > small {
  font-size: 11px;
  color: #8a96a8;
  line-height: 1.6;
}
.dashboard-main-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.8fr) minmax(290px, 1fr);
  gap: 20px;
  margin-bottom: 20px;
  align-items: start;
}
.dashboard-panel {
  min-width: 0;
  padding: 22px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fff;
}
.dashboard-panel > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 19px;
}
.dashboard-panel h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #27344a;
}
.dashboard-panel header p {
  margin: 7px 0 0;
  font-size: 11px;
  color: #8a96a8;
  line-height: 1.6;
}
.dashboard-panel header > a,
.dashboard-run-state > a {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  padding-top: 3px;
  font-size: 11px;
  color: #2457e6;
  text-decoration: none;
}
.chart-legend {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  font-size: 11px;
  color: #667085;
}
.chart-legend > span {
  display: flex;
  align-items: center;
  gap: 6px;
}
.chart-legend i {
  width: 7px;
  height: 7px;
  border-radius: 2px;
}
.chart-legend .answered {
  background: #2457e6;
}
.chart-legend .refused {
  background: #d99a1d;
}
.chart-legend .failed {
  background: #d45252;
}
.dashboard-chart {
  width: 100%;
  min-height: 232px;
}
.dashboard-chart svg {
  display: block;
  width: 100%;
  height: 232px;
}
.chart-gridline {
  stroke: #edf0f4;
  stroke-dasharray: 3 4;
}
.chart-axis {
  fill: #8090a3;
  font-size: 11px;
}
.chart-value {
  fill: #536176;
  font-size: 11px;
}
.chart-answered {
  fill: #2457e6;
}
.chart-refused {
  fill: #d99a1d;
}
.chart-failed {
  fill: #d45252;
}
.dashboard-chart g:focus-visible {
  outline: 2px solid #93b4ff;
  outline-offset: 4px;
}
.dashboard-secondary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  padding-top: 18px;
  border-top: 1px solid #edf0f4;
}
.dashboard-secondary > div {
  display: grid;
  gap: 7px;
}
.dashboard-secondary span {
  font-size: 11px;
  color: #8a96a8;
}
.dashboard-secondary strong {
  font-size: 18px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: #344054;
}
.dashboard-data-table {
  margin-top: 18px;
  font-size: 11px;
  color: #8a96a8;
}
.dashboard-data-table summary {
  cursor: pointer;
  width: fit-content;
}
.dashboard-data-table p {
  line-height: 1.8;
}
.dashboard-data-table > div {
  max-height: 250px;
  overflow: auto;
}
.dashboard-data-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  color: #667085;
}
.dashboard-data-table th,
.dashboard-data-table td {
  padding: 8px;
  text-align: left;
  border-bottom: 1px solid #edf0f4;
  white-space: nowrap;
}
.knowledge-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 26px 0 22px;
}
.knowledge-heading > strong {
  font-size: 25px;
  font-weight: 600;
  color: #27344a;
}
.knowledge-heading small {
  margin-left: 6px;
  font-size: 12px;
  color: #667085;
  font-weight: 400;
}
.knowledge-heading > span:last-child {
  margin-left: auto;
  color: #8a96a8;
  font-size: 11px;
}
.dashboard-knowledge dl {
  margin: 0;
}
.dashboard-knowledge dl > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 15px 0;
  border-bottom: 1px solid #edf0f4;
}
.dashboard-knowledge dt {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #667085;
  font-size: 12px;
}
.dashboard-knowledge dd {
  margin: 0;
  color: #344054;
  font-weight: 600;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}
.green-icon {
  color: #26845a;
}
.amber-icon {
  color: #b7811d;
}
.red-icon {
  color: #c24141 !important;
}
.dashboard-note {
  margin: 18px 0 0;
  color: #8a96a8;
  font-size: 11px;
  line-height: 1.8;
}
.dashboard-attention-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}
.knowledge-only {
  grid-template-columns: minmax(0, 1fr);
}
.dashboard-run-state {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  margin-bottom: 20px;
  border: 1px solid #efe3c3;
  border-radius: 8px;
  background: #fffbf1;
  font-size: 12px;
  color: #977126;
  flex-wrap: wrap;
}
.dashboard-run-state > a {
  margin-left: auto;
}
.attention-item {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 13px 0;
  border-top: 1px solid #edf0f4;
  text-decoration: none;
}
.attention-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: 7px;
  background: #fff5f0;
  color: #be733e;
}
.attention-item > div {
  flex: 1;
  min-width: 0;
}
.attention-item strong {
  display: block;
  font-size: 12px;
  color: #344054;
  font-weight: 500;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.attention-item small {
  display: block;
  margin-top: 6px;
  font-size: 10px;
  color: #8a96a8;
}
.attention-item > svg {
  flex: none;
  color: #8a96a8;
}
.attention-item:hover strong,
.attention-item:hover > svg {
  color: #2457e6;
}
.attention-empty,
.chart-empty,
.dashboard-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 94px;
  color: #8a96a8;
  font-size: 12px;
}
.attention-empty > svg {
  color: #26845a;
}
.chart-empty {
  min-height: 232px;
  flex-direction: column;
  gap: 10px;
}
.chart-empty strong {
  font-size: 13px;
  font-weight: 500;
  color: #667085;
}
.chart-empty p {
  margin: 0;
  font-size: 11px;
}
.dashboard-empty {
  padding: 50px 20px;
  border: 1px dashed var(--line);
  border-radius: 10px;
  flex-direction: column;
}
.dashboard-empty h2 {
  font-size: 16px;
  color: #344054;
}
.dashboard-empty p {
  margin: 0 0 8px;
}
.dashboard-skeleton > div {
  display: grid;
  gap: 16px;
  height: 151px;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 10px;
}
.dashboard-skeleton span,
.dashboard-skeleton i {
  display: block;
  width: 55%;
  height: 13px;
  border-radius: 4px;
  background: #f1f4f8;
}
.dashboard-skeleton i {
  width: 40%;
  height: 29px;
}
.dashboard-skeleton span:last-child {
  width: 80%;
}
@media (max-width: 1100px) {
  .dashboard-metrics {
    gap: 12px;
  }
  .dashboard-metric {
    padding: 16px;
  }
  .dashboard-main-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .dashboard-knowledge dl {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 24px;
  }
  .dashboard-knowledge .dashboard-note {
    max-width: 700px;
  }
}
@media (max-width: 720px) {
  .dashboard-metrics,
  .dashboard-skeleton {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .dashboard-metric {
    padding: 15px;
  }
  .dashboard-metric > strong {
    font-size: 25px;
  }
  .dashboard-attention-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .dashboard-panel {
    padding: 17px;
  }
  .dashboard-panel > header {
    gap: 8px;
  }
  .dashboard-knowledge dl {
    grid-template-columns: minmax(0, 1fr);
  }
  .dashboard-metric > small {
    font-size: 10px;
  }
  .dashboard-secondary {
    gap: 10px;
  }
  .dashboard-secondary strong {
    font-size: 16px;
  }
  .dashboard-period time {
    font-size: 10px;
  }
  .chart-legend {
    gap: 12px;
  }
}
</style>
