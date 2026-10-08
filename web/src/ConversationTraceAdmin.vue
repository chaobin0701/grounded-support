<script setup lang="ts">
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  List,
  LoaderCircle,
  RefreshCw,
  Search,
} from '@lucide/vue';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  adminApi,
  AdminApiError,
  type ChatTraceDetail,
  type ConversationDetail,
  type ConversationListItem,
} from './admin-api';
import {
  conversationTurns,
  formatDuration,
  turnStatus,
  type ConversationTurn,
} from './conversation-view';
import ConversationTraceInspector from './ConversationTraceInspector.vue';
import AdminPageHeader from './ui/AdminPageHeader.vue';
import MarkdownContent from './ui/MarkdownContent.vue';
import ToastNotice from './ui/ToastNotice.vue';
import UiDrawer from './ui/UiDrawer.vue';

const props = defineProps<{ token: string; canDebug?: boolean }>();
const route = useRoute();
const router = useRouter();
const page = ref<HTMLElement | null>(null);
const wideLayout = ref(false);
const sessions = ref<ConversationListItem[]>([]);
const selectedId = ref('');
const selectedConversation = ref<ConversationDetail | null>(null);
const selectedTrace = ref<ChatTraceDetail | null>(null);
const selectedTurnId = ref<number | null>(null);
const query = ref('');
const visitorId = ref('');
const device = ref('all');
const timeRange = ref('all');
const turnFilter = ref('all');
const visitorOptions = ref<
  { visitorId: string; conversationCount: number; clientType: string }[]
>([]);
const offset = ref(0);
const hasMore = ref(false);
const loading = ref(false);
const detailLoading = ref(false);
const traceLoading = ref(false);
const error = ref('');
const traceError = ref('');
const inspectorOpen = ref(false);
const listOpen = ref(true);
const expandedAnswers = ref(new Set<number>());
const notice = ref('');
const noticeType = ref<'success' | 'error'>('success');
let listRequest = 0;
let detailRequest = 0;
let traceRequest = 0;
let lookupRequest = 0;
let observer: ResizeObserver | undefined;
const turns = computed(() =>
  selectedConversation.value
    ? conversationTurns(selectedConversation.value)
    : [],
);
const visibleTurns = computed(() =>
  turns.value.filter(
    (turn) =>
      turnFilter.value === 'all' || turnStatus(turn).tone === turnFilter.value,
  ),
);
const clientLabel: Record<string, string> = {
  browser: '浏览器',
  mobile: '移动端',
  wechat: '微信',
  feishu: '飞书',
  api: 'API',
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function date(value: string | null) {
  return value
    ? new Date(value).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
}
function sinceValue() {
  return timeRange.value === 'all'
    ? ''
    : new Date(
        Date.now() -
          (timeRange.value === '24h'
            ? 24
            : timeRange.value === '7d'
              ? 168
              : 720) *
            3600000,
      ).toISOString();
}
function notify(message: string, type: 'success' | 'error' = 'success') {
  notice.value = '';
  noticeType.value = type;
  requestAnimationFrame(() => {
    notice.value = message;
  });
}
async function copy(value: string, label = '内容') {
  try {
    if (!navigator.clipboard) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(value);
    notify(`${label}已复制`);
  } catch {
    notify('复制失败，请手动选择文本复制', 'error');
  }
}
function copyIds(traceId: string | null, conversationId: string) {
  void copy(
    `轨迹 ID: ${traceId || '—'}\n会话 ID: ${conversationId}`,
    '轨迹和会话 ID',
  );
}
function copyLink() {
  const href = router.resolve({
    path: '/admin/conversations',
    query: {
      conversationId: selectedId.value,
      ...(selectedTrace.value ? { traceId: selectedTrace.value.id } : {}),
    },
  }).href;
  void copy(new URL(href, window.location.origin).href, '定位链接');
}
function syncRoute(traceId?: string) {
  void router.replace({
    path: '/admin/conversations',
    query: {
      conversationId: selectedId.value,
      ...(traceId ? { traceId } : {}),
    },
  });
}
function clearSelection() {
  detailRequest++;
  traceRequest++;
  selectedId.value = '';
  selectedConversation.value = null;
  selectedTrace.value = null;
  selectedTurnId.value = null;
  inspectorOpen.value = false;
  detailLoading.value = false;
  traceLoading.value = false;
}
function reload() {
  offset.value = 0;
  void loadSessions();
}
async function loadSessions(autoSelect = true) {
  const request = ++listRequest;
  loading.value = true;
  error.value = '';
  try {
    const result = await adminApi.conversations(props.token, {
      q: uuid.test(query.value.trim()) ? '' : query.value.trim(),
      visitorId: visitorId.value,
      device: device.value,
      since: sinceValue(),
      offset: offset.value,
    });
    if (request !== listRequest) return;
    sessions.value = result.items;
    hasMore.value = result.pagination.hasMore;
    visitorOptions.value = result.filters;
    if (
      autoSelect &&
      !sessions.value.some((item) => item.id === selectedId.value)
    ) {
      if (sessions.value[0]) await chooseConversation(sessions.value[0].id);
      else {
        clearSelection();
        void router.replace({ path: '/admin/conversations', query: {} });
      }
    }
  } catch (cause) {
    if (request === listRequest)
      error.value = cause instanceof Error ? cause.message : '加载会话失败';
  } finally {
    if (request === listRequest) loading.value = false;
  }
}
async function chooseConversation(id: string, focusTraceId?: string) {
  const request = ++detailRequest;
  traceRequest++;
  selectedId.value = id;
  selectedConversation.value = null;
  selectedTrace.value = null;
  selectedTurnId.value = null;
  detailLoading.value = true;
  traceLoading.value = false;
  inspectorOpen.value = false;
  error.value = '';
  turnFilter.value = 'all';
  expandedAnswers.value = new Set();
  try {
    const result = await adminApi.conversation(props.token, id);
    if (request !== detailRequest) return;
    selectedConversation.value = result;
    if (window.innerWidth < 800) listOpen.value = false;
    syncRoute(focusTraceId);
    if (focusTraceId) {
      selectedTurnId.value =
        turns.value.find((turn) => turn.trace?.id === focusTraceId)?.user.id ??
        null;
      await chooseTrace(focusTraceId);
    }
  } catch (cause) {
    if (request === detailRequest)
      error.value = cause instanceof Error ? cause.message : '加载会话详情失败';
  } finally {
    if (request === detailRequest) detailLoading.value = false;
  }
}
async function chooseTrace(id: string) {
  const request = ++traceRequest;
  const conversationId = selectedId.value;
  selectedTrace.value = null;
  traceLoading.value = true;
  traceError.value = '';
  inspectorOpen.value = true;
  try {
    const result = await adminApi.chatTrace(props.token, id);
    if (request !== traceRequest || selectedId.value !== conversationId) return;
    if (result.conversationId !== conversationId)
      throw new Error('这条轨迹不属于当前会话');
    selectedTrace.value = result;
    syncRoute(id);
  } catch (cause) {
    if (request === traceRequest)
      traceError.value =
        cause instanceof Error ? cause.message : '加载轨迹失败';
  } finally {
    if (request === traceRequest) traceLoading.value = false;
  }
}
function viewTurn(turn: ConversationTurn) {
  selectedTurnId.value = turn.user.id;
  if (turn.trace) void chooseTrace(turn.trace.id);
}
async function search() {
  const id = query.value.trim();
  if (!uuid.test(id)) {
    reload();
    return;
  }
  // Resolve trace IDs without fetching privileged model context.
  const lookup = ++lookupRequest;
  const selection = detailRequest;
  try {
    let conversationId = id;
    let traceId: string | undefined;
    try {
      await adminApi.conversation(props.token, id);
    } catch (cause) {
      if (!(cause instanceof AdminApiError) || cause.status !== 404)
        throw cause;
      const trace = await adminApi.chatTrace(props.token, id);
      if (!trace.conversationId) throw new Error('这条轨迹没有关联会话');
      conversationId = trace.conversationId;
      traceId = id;
    }
    if (lookup !== lookupRequest || selection !== detailRequest) return;
    await chooseConversation(conversationId, traceId);
  } catch (cause) {
    if (lookup !== lookupRequest || selection !== detailRequest) return;
    notify(
      cause instanceof Error ? cause.message : '未找到会话或轨迹',
      'error',
    );
  }
}
async function refresh() {
  const id = selectedId.value;
  const traceId = selectedTrace.value?.id;
  await loadSessions(false);
  if (id && selectedId.value === id) await chooseConversation(id, traceId);
}
function nextPage(direction: number) {
  offset.value = Math.max(0, offset.value + direction * 30);
  void loadSessions();
}
function answer(turn: ConversationTurn) {
  return turn.assistant?.content || turn.trace?.finalAnswer || '';
}
function expandAnswer(id: number) {
  const next = new Set(expandedAnswers.value);
  next.has(id) ? next.delete(id) : next.add(id);
  expandedAnswers.value = next;
}
function citationCount(turn: ConversationTurn) {
  return Array.isArray(turn.assistant?.citations)
    ? turn.assistant.citations.length
    : 0;
}
function toolCount(turn: ConversationTurn) {
  return Array.isArray(turn.assistant?.toolSteps)
    ? turn.assistant.toolSteps.length
    : null;
}
onMounted(async () => {
  observer = new ResizeObserver(([entry]) => {
    wideLayout.value = (entry?.contentRect.width ?? 0) >= 1320;
  });
  if (page.value) observer.observe(page.value);
  await loadSessions(false);
  const conversationId =
    typeof route.query.conversationId === 'string'
      ? route.query.conversationId
      : '';
  const traceId =
    typeof route.query.traceId === 'string' ? route.query.traceId : '';
  if (conversationId && uuid.test(conversationId))
    await chooseConversation(
      conversationId,
      uuid.test(traceId) ? traceId : undefined,
    );
  else if (traceId && uuid.test(traceId)) {
    query.value = traceId;
    await search();
  } else if (sessions.value[0]) await chooseConversation(sessions.value[0].id);
});
onUnmounted(() => {
  observer?.disconnect();
  listRequest++;
  detailRequest++;
  traceRequest++;
});
</script>

<template>
  <section ref="page" class="conversation-page">
    <AdminPageHeader
      eyebrow="运行记录"
      title="会话管理"
      description="查看访客会话，按轮次检查回答、执行过程与模型上下文。"
      ><template #actions
        ><button
          class="ui-button secondary"
          :disabled="loading || detailLoading"
          @click="refresh"
        >
          <RefreshCw :size="15" />刷新
        </button></template
      ></AdminPageHeader
    >
    <ToastNotice :message="notice" :type="noticeType" @dismiss="notice = ''" />
    <form class="conversation-toolbar" @submit.prevent="search">
      <label class="conversation-search"
        ><Search :size="15" /><input
          v-model="query"
          class="ui-input"
          placeholder="搜索问题，或粘贴会话 / 轨迹 ID"
          aria-label="搜索会话或轨迹" /><button
          type="submit"
          aria-label="执行搜索"
        >
          <ChevronRight :size="16" /></button></label
      ><select
        v-model="visitorId"
        class="ui-input"
        aria-label="访客筛选"
        @change="reload"
      >
        <option value="">全部访客</option>
        <option
          v-for="item in visitorOptions"
          :key="item.visitorId"
          :value="item.visitorId"
        >
          访客 {{ item.visitorId.slice(0, 8) }} ·
          {{ item.conversationCount }} 个会话
        </option></select
      ><select
        v-model="device"
        class="ui-input"
        aria-label="设备筛选"
        @change="reload"
      >
        <option value="all">全部设备</option>
        <option v-for="(label, key) in clientLabel" :key="key" :value="key">
          {{ label }}
        </option></select
      ><select
        v-model="timeRange"
        class="ui-input"
        aria-label="时间筛选"
        @change="reload"
      >
        <option value="all">全部时间</option>
        <option value="24h">最近 24 小时</option>
        <option value="7d">最近 7 天</option>
        <option value="30d">最近 30 天</option>
      </select>
    </form>
    <p v-if="error" class="conversation-error" role="alert">{{ error }}</p>
    <div
      class="session-workspace"
      :class="{
        'with-inspector': wideLayout && inspectorOpen,
        'list-collapsed': !listOpen,
      }"
    >
      <aside class="session-list-panel">
        <header class="pane-heading">
          <strong>访客会话</strong
          ><span>{{ loading ? '加载中…' : `本页 ${sessions.length} 个` }}</span>
        </header>
        <div class="session-list">
          <button
            v-for="item in sessions"
            :key="item.id"
            class="session-item"
            :class="{ selected: item.id === selectedId }"
            :aria-pressed="item.id === selectedId"
            @click="chooseConversation(item.id)"
          >
            <strong>{{
              item.title || item.lastQuestion || '未命名会话'
            }}</strong
            ><span class="session-preview">{{
              item.lastQuestion || '暂无问题'
            }}</span
            ><span class="session-meta"
              ><span>{{ item.turnCount }} 轮 · {{ date(item.updatedAt) }}</span
              ><i
                v-if="item.hasFailed"
                title="存在执行失败的轮次"
                class="issue-dot"
              ></i></span
            ><span class="session-visitor"
              >{{
                clientLabel[item.clientType] || item.clientType || '浏览器'
              }}
              · 访客 {{ item.visitorSessionId.slice(0, 8) }}</span
            >
          </button>
          <p v-if="!sessions.length && !loading" class="empty-copy">
            没有匹配的会话
          </p>
        </div>
        <footer class="session-pagination">
          <button
            aria-label="上一页"
            :disabled="offset === 0 || loading"
            @click="nextPage(-1)"
          >
            <ChevronLeft :size="15" /></button
          ><span>第 {{ Math.floor(offset / 30) + 1 }} 页</span
          ><button
            aria-label="下一页"
            :disabled="!hasMore || loading"
            @click="nextPage(1)"
          >
            <ChevronRight :size="15" />
          </button>
        </footer>
      </aside>
      <main class="conversation-detail-panel">
        <div v-if="detailLoading" class="conversation-empty" role="status">
          <LoaderCircle class="spin" :size="22" />正在加载会话…
        </div>
        <template v-else-if="selectedConversation"
          ><header class="conversation-detail-header">
            <div class="conversation-title-row">
              <button
                class="pane-toggle"
                :aria-label="listOpen ? '收起会话列表' : '显示会话列表'"
                :aria-expanded="listOpen"
                @click="listOpen = !listOpen"
              >
                <List :size="17" />
              </button>
              <h2>{{ selectedConversation.title || '未命名会话' }}</h2>
              <button
                class="pane-toggle"
                aria-label="复制会话 ID"
                @click="copy(selectedConversation.id, '会话 ID')"
              >
                <Copy :size="15" />
              </button>
            </div>
            <div class="conversation-metadata">
              <code :title="selectedConversation.id">{{
                selectedConversation.id
              }}</code
              ><span>{{ date(selectedConversation.updatedAt) }}</span>
            </div>
            <div class="turn-filter">
              <span>{{ turns.length }} 轮对话</span
              ><select
                v-model="turnFilter"
                class="ui-input"
                aria-label="本会话轮次状态"
              >
                <option value="all">全部轮次</option>
                <option value="answered">已回答</option>
                <option value="refused">拒答</option>
                <option value="failed">执行失败</option>
                <option value="active">处理中</option>
                <option value="neutral">未完成 / 无轨迹</option>
              </select>
            </div>
          </header>
          <div class="turn-list">
            <article
              v-for="turn in visibleTurns"
              :key="turn.user.id"
              class="turn-item"
              :class="{ selected: selectedTurnId === turn.user.id }"
            >
              <div class="turn-heading">
                <span>第 {{ turn.index }} 轮</span
                ><time>{{ date(turn.user.createdAt) }}</time
                ><span :class="['turn-status', turnStatus(turn).tone]">{{
                  turnStatus(turn).text
                }}</span>
              </div>
              <div class="turn-question">
                <span class="turn-label">用户</span>
                <p>{{ turn.user.content }}</p>
              </div>
              <div class="turn-answer">
                <span class="turn-label assistant-label">AI</span>
                <div class="turn-response">
                  <div
                    v-if="answer(turn)"
                    :class="{
                      'answer-collapsed':
                        answer(turn).length > 700 &&
                        !expandedAnswers.has(turn.user.id),
                    }"
                  >
                    <MarkdownContent :content="answer(turn)" />
                  </div>
                  <p v-else class="missing-answer">
                    {{
                      turn.run?.status === 'running'
                        ? '请求仍在处理中，刷新后查看。'
                        : '本轮未保存助手回答。'
                    }}
                  </p>
                  <button
                    v-if="answer(turn).length > 700"
                    class="text-action"
                    :aria-expanded="expandedAnswers.has(turn.user.id)"
                    @click="expandAnswer(turn.user.id)"
                  >
                    {{
                      expandedAnswers.has(turn.user.id)
                        ? '收起回答'
                        : '展开完整回答'
                    }}
                  </button>
                </div>
              </div>
              <footer class="turn-footer">
                <span
                  >{{ citationCount(turn) }} 个引用<template
                    v-if="toolCount(turn) !== null"
                  >
                    · {{ toolCount(turn) }} 次工具</template
                  ><template v-if="turn.trace">
                    · {{ formatDuration(turn.trace.durationMs) }}</template
                  ></span
                >
                <div v-if="turn.trace">
                  <button
                    class="text-action"
                    @click="copyIds(turn.trace.id, selectedConversation.id)"
                  >
                    <Copy :size="12" />复制 ID</button
                  ><button
                    class="trace-action"
                    :aria-pressed="
                      selectedTurnId === turn.user.id && inspectorOpen
                    "
                    @click="viewTurn(turn)"
                  >
                    查看轨迹<ChevronRight :size="13" />
                  </button>
                </div>
                <span v-else class="missing-trace">暂无轨迹记录</span>
              </footer>
              <p v-if="turn.run?.errorCode" class="turn-error">
                运行错误：{{ turn.run.errorCode }}
              </p>
            </article>
            <p v-if="!visibleTurns.length" class="empty-copy">
              {{
                turns.length ? '没有匹配此状态的轮次' : '这个会话还没有用户消息'
              }}
            </p>
          </div>
        </template>
        <div v-else class="conversation-empty">
          <button
            v-if="!listOpen"
            class="ui-button secondary"
            @click="listOpen = true"
          >
            显示会话列表</button
          >选择左侧会话查看消息
        </div>
      </main>
      <aside v-if="wideLayout && inspectorOpen" class="desktop-inspector">
        <ConversationTraceInspector
          :token="token"
          :trace="selectedTrace"
          :loading="traceLoading"
          :error="traceError"
          :can-debug="canDebug"
          @close="inspectorOpen = false"
          @copy="copy"
          @link="copyLink"
        />
      </aside>
    </div>
    <UiDrawer
      :open="inspectorOpen && !wideLayout"
      title="执行轨迹"
      @update:open="inspectorOpen = $event"
      ><ConversationTraceInspector
        :show-heading="false"
        :token="token"
        :trace="selectedTrace"
        :loading="traceLoading"
        :error="traceError"
        :can-debug="canDebug"
        @close="inspectorOpen = false"
        @copy="copy"
        @link="copyLink"
    /></UiDrawer>
  </section>
</template>

<style scoped>
.conversation-page {
  display: flex;
  flex-direction: column;
  container-type: inline-size;
  height: 100%;
  min-height: 0;
  max-width: none;
  color: #344054;
}
.conversation-page :deep(.admin-page-header) {
  flex: none;
}
.conversation-toolbar {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(140px, 190px) 130px 140px;
  gap: 10px;
  flex: none;
  margin-bottom: 18px;
}
.conversation-toolbar .ui-input {
  height: 36px;
  font-size: 12px;
  min-width: 0;
}
.conversation-search {
  position: relative;
  display: flex;
  align-items: center;
}
.conversation-search > svg {
  position: absolute;
  left: 11px;
  color: #98a2b3;
}
.conversation-search input {
  padding-left: 34px;
  padding-right: 32px;
  width: 100%;
}
.conversation-search button {
  position: absolute;
  right: 5px;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 5px;
  color: #667085;
  background: transparent;
}
.conversation-search button:hover {
  background: #f2f4f7;
}
.conversation-error {
  flex: none;
  margin: 0 0 14px;
  color: #bd3d3d;
  font-size: 12px;
}
.session-workspace {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  border: 1px solid #e3e8ef;
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}
.session-workspace.with-inspector {
  grid-template-columns: 240px minmax(0, 1fr) 390px;
}
.session-workspace.list-collapsed {
  grid-template-columns: minmax(0, 1fr);
}
.session-workspace.list-collapsed.with-inspector {
  grid-template-columns: minmax(0, 1fr) 390px;
}
.list-collapsed .session-list-panel {
  display: none;
}
.session-list-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  border-right: 1px solid #e7ecf2;
  background: #fcfdfe;
}
.pane-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  padding: 16px 14px;
  border-bottom: 1px solid #e7ecf2;
  font-size: 12px;
}
.pane-heading > span {
  font-size: 10px;
  color: #98a2b3;
}
.session-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}
.session-item {
  display: block;
  width: 100%;
  padding: 14px;
  border: 0;
  border-bottom: 1px solid #edf0f4;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.session-item:hover {
  background: #f5f8fc;
}
.session-item.selected {
  background: #eef4ff;
  box-shadow: inset 3px 0 #2457e6;
}
.session-item strong,
.session-preview {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-item strong {
  font-size: 12px;
  color: #27344a;
  font-weight: 600;
}
.session-preview {
  margin: 6px 0 10px;
  color: #8a96a8;
  font-size: 11px;
}
.session-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #8a96a8;
  font-size: 10px;
}
.issue-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #dd5c5c;
}
.session-visitor {
  display: block;
  margin-top: 5px;
  font-size: 10px;
  color: #98a2b3;
}
.session-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  min-height: 45px;
  padding: 0 10px;
  border-top: 1px solid #e7ecf2;
  font-size: 11px;
  color: #98a2b3;
}
.session-pagination button,
.pane-toggle {
  display: grid;
  place-items: center;
  min-width: 30px;
  min-height: 30px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #667085;
  cursor: pointer;
}
.session-pagination button:hover:not(:disabled),
.pane-toggle:hover {
  background: #eef4ff;
  color: #2457e6;
}
.session-pagination button:disabled {
  opacity: 0.3;
  cursor: default;
}
.conversation-detail-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.conversation-detail-header {
  flex: none;
  padding: 18px 24px 12px;
  border-bottom: 1px solid #e7ecf2;
}
.conversation-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.conversation-title-row h2 {
  flex: 1;
  min-width: 0;
  margin: 0;
  color: #27344a;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conversation-metadata {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 8px 0;
  color: #98a2b3;
  font-size: 10px;
  flex-wrap: wrap;
}
.conversation-metadata code {
  font:
    10px ui-monospace,
    monospace;
  overflow-wrap: anywhere;
}
.turn-filter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
  color: #8a96a8;
}
.turn-filter .ui-input {
  width: 146px;
  height: 30px;
  font-size: 11px;
}
.turn-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 0 24px;
}
.turn-item {
  padding: 22px 0;
  border-bottom: 1px solid #e7ecf2;
}
.turn-item.selected {
  border-left: 2px solid #2457e6;
  padding-left: 14px;
  margin-left: -16px;
}
.turn-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  color: #98a2b3;
  font-size: 10px;
}
.turn-heading > span:first-child {
  color: #667085;
}
.turn-status {
  margin-left: auto;
  padding: 3px 7px;
  border-radius: 5px;
  white-space: nowrap;
  font-size: 10px;
}
.turn-status.answered {
  color: #248554;
  background: #eaf7ef;
}
.turn-status.refused {
  color: #9a6800;
  background: #fff5df;
}
.turn-status.failed {
  color: #bd3d3d;
  background: #ffeded;
}
.turn-status.active {
  color: #2457e6;
  background: #eef4ff;
}
.turn-status.neutral {
  color: #667085;
  background: #f2f4f7;
}
.turn-question,
.turn-answer {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 10px;
}
.turn-question {
  margin-bottom: 17px;
}
.turn-question p {
  margin: 0;
  color: #27344a;
  line-height: 1.8;
  font-size: 13px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.turn-label {
  color: #2457e6;
  font-size: 11px;
  font-weight: 600;
  line-height: 24px;
}
.assistant-label {
  color: #249765;
}
.turn-response {
  min-width: 0;
}
.answer-collapsed {
  max-height: 245px;
  overflow: hidden;
  mask-image: linear-gradient(#000 80%, transparent);
}
.missing-answer {
  color: #98a2b3;
  font-size: 12px;
}
.text-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 30px;
  border: 0;
  background: transparent;
  padding: 0;
  color: #667085;
  font-size: 11px;
  cursor: pointer;
}
.text-action:hover {
  color: #2457e6;
}
.turn-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 15px;
  margin-top: 14px;
  color: #98a2b3;
  font-size: 10px;
  flex-wrap: wrap;
}
.turn-footer > div {
  display: flex;
  gap: 14px;
  align-items: center;
}
.trace-action {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  min-height: 30px;
  border: 1px solid #dbe5f7;
  border-radius: 6px;
  background: #f8faff;
  color: #2457e6;
  padding: 0 8px;
  font-size: 11px;
  cursor: pointer;
}
.trace-action:hover {
  background: #eef4ff;
}
.missing-trace {
  color: #98a2b3;
}
.turn-error {
  font-size: 11px;
  color: #bd3d3d;
}
.desktop-inspector {
  min-width: 0;
  min-height: 0;
  border-left: 1px solid #e7ecf2;
}
.conversation-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  flex: 1;
  color: #98a2b3;
  font-size: 12px;
  padding: 25px;
}
.empty-copy {
  text-align: center;
  padding: 32px 16px;
  color: #98a2b3;
  font-size: 12px;
}
.spin {
  animation: conversation-spin 1s linear infinite;
}
@keyframes conversation-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}
@container (max-width:850px) {
  .conversation-toolbar {
    grid-template-columns: 1fr 1fr 1fr;
  }
  .conversation-search {
    grid-column: 1/-1;
  }
  .session-workspace {
    grid-template-columns: 210px minmax(0, 1fr);
  }
  .conversation-detail-header {
    padding: 14px 16px 12px;
  }
  .turn-list {
    padding: 0 16px;
  }
  .turn-footer > div {
    gap: 8px;
  }
}
@media (max-width: 799px) {
  .session-workspace {
    display: flex;
  }
  .session-list-panel {
    width: 100%;
    flex: none;
    border-right: 0;
  }
  .conversation-detail-panel {
    display: none;
  }
  .list-collapsed .conversation-detail-panel {
    display: flex;
    flex: 1;
  }
  .conversation-toolbar {
    grid-template-columns: 1fr 1fr 1fr;
  }
  .conversation-search {
    grid-column: 1/-1;
  }
  .conversation-title-row h2 {
    font-size: 13px;
  }
  .conversation-detail-header {
    padding: 12px;
  }
  .turn-list {
    padding: 0 12px;
  }
  .turn-question,
  .turn-answer {
    grid-template-columns: 24px minmax(0, 1fr);
    gap: 7px;
  }
}
</style>
