<script setup lang="ts">
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  LoaderCircle,
  RefreshCw,
  Search,
} from '@lucide/vue';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
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
import ProductMessageContent from './ui/ProductMessageContent.vue';
import ToastNotice from './ui/ToastNotice.vue';
import UiDrawer from './ui/UiDrawer.vue';
import {
  conversationDetailLocation,
  conversationListPath,
  conversationListQuery,
  conversationUuid as uuid,
  queryString,
  readConversationListState,
} from './conversation-navigation';

const props = defineProps<{ token: string; canDebug?: boolean }>();
const route = useRoute();
const router = useRouter();
const page = ref<HTMLElement | null>(null);
const listScroller = ref<HTMLElement | null>(null);
const wideLayout = ref(false);
const isDetailPage = computed(() => typeof route.params.conversationId === 'string');
const backTo = computed(() => router.resolve({
  path: conversationListPath,
  query: conversationListQuery(readConversationListState(route.query)),
}).href);
const sessions = ref<ConversationListItem[]>([]);
const selectedId = ref('');
const selectedConversation = ref<ConversationDetail | null>(null);
const selectedTrace = ref<ChatTraceDetail | null>(null);
const selectedTurnId = ref<number | null>(null);
const query = ref('');
const visitorId = ref('');
const applicationId = ref('');
const applicationOptions = ref<{ id: string; name: string }[]>([]);
const device = ref('all');
const timeRange = ref('all');
const turnFilter = ref('all');
const visitorOptions = ref<
  { visitorId: string; conversationCount: number; clientType: string }[]
>([]);
const offset = ref(0);
const hasMore = ref(false);
const loading = ref(false);
const lookupLoading = ref(false);
const detailLoading = ref(false);
const traceLoading = ref(false);
const error = ref('');
const traceError = ref('');
const inspectorOpen = ref(false);
const expandedAnswers = ref(new Set<number>());
const notice = ref('');
const noticeType = ref<'success' | 'error'>('success');
let listRequest = 0;
let detailRequest = 0;
let traceRequest = 0;
let lookupRequest = 0;
let savedListScroll = 0;
let appliedPagePath = '';
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

function listState() {
  return { query: query.value, visitorId: visitorId.value, applicationId: applicationId.value, device: device.value, timeRange: timeRange.value, offset: offset.value };
}
function detailLocation(id: string, traceId?: string) {
  return conversationDetailLocation(id, traceId, readConversationListState(route.query));
}
function rememberListScroll() {
  savedListScroll = listScroller.value?.scrollTop ?? 0;
  lookupRequest++;
}
function focusHeading() {
  page.value?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
}

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
  const href = router.resolve(detailLocation(selectedId.value, selectedTrace.value?.id)).href;
  void copy(new URL(href, window.location.origin).href, '定位链接');
}
function syncRoute(traceId?: string) {
  void router.replace(detailLocation(selectedId.value, traceId));
}
function closeInspector() {
  traceRequest++;
  traceLoading.value = false;
  selectedTrace.value = null;
  selectedTurnId.value = null;
  inspectorOpen.value = false;
  syncRoute();
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
  savedListScroll = 0;
  void updateListRoute();
}
async function updateListRoute() {
  const target = { path: conversationListPath, query: conversationListQuery(listState()) };
  if (router.resolve(target).fullPath === route.fullPath) await loadSessions();
  else await router.push(target);
}
async function loadSessions() {
  const request = ++listRequest;
  loading.value = true;
  error.value = '';
  try {
    const result = await adminApi.conversations(props.token, {
      q: uuid.test(query.value.trim()) ? '' : query.value.trim(),
      visitorId: visitorId.value,
      applicationId: applicationId.value,
      device: device.value,
      since: sinceValue(),
      offset: offset.value,
    });
    if (request !== listRequest) return;
    sessions.value = result.items;
    applicationOptions.value = result.applications;
    hasMore.value = result.pagination.hasMore;
    visitorOptions.value = result.filters;
  } catch (cause) {
    if (request === listRequest) {
      sessions.value = [];
      hasMore.value = false;
      error.value = cause instanceof Error ? cause.message : '加载会话失败';
    }
  } finally {
    if (request === listRequest) {
      loading.value = false;
      await nextTick();
      if (listScroller.value) listScroller.value.scrollTop = savedListScroll;
    }
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
  if (loading.value || lookupLoading.value) return;
  const id = query.value.trim();
  if (!uuid.test(id)) {
    reload();
    return;
  }
  // Resolve trace IDs without fetching privileged model context.
  const lookup = ++lookupRequest;
  const selection = detailRequest;
  lookupLoading.value = true;
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
    rememberListScroll();
    await router.push(conversationDetailLocation(conversationId, traceId, listState()));
  } catch (cause) {
    if (lookup !== lookupRequest || selection !== detailRequest) return;
    notify(
      cause instanceof Error ? cause.message : '未找到会话或轨迹',
      'error',
    );
  } finally {
    if (lookup === lookupRequest) lookupLoading.value = false;
  }
}
async function refresh() {
  if (isDetailPage.value) await chooseConversation(String(route.params.conversationId), queryString(route.query.traceId));
  else await loadSessions();
}
function nextPage(direction: number) {
  offset.value = Math.max(0, offset.value + direction * 30);
  savedListScroll = 0;
  void updateListRoute();
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
async function applyRoute() {
  const lookup = ++lookupRequest;
  lookupLoading.value = false;
  const pageChanged = route.path !== appliedPagePath;
  appliedPagePath = route.path;
  const id = queryString(route.params.conversationId);
  const traceId = queryString(route.query.traceId);
  if (isDetailPage.value) {
    listRequest++;
    loading.value = false;
    if (!uuid.test(id)) {
      clearSelection();
      error.value = '会话 ID 无效，请返回列表重新选择。';
      return;
    }
    if (selectedId.value !== id) await chooseConversation(id, uuid.test(traceId) ? traceId : undefined);
    else if (uuid.test(traceId) && selectedTrace.value?.id !== traceId) {
      selectedTurnId.value = turns.value.find(turn => turn.trace?.id === traceId)?.user.id ?? null;
      await chooseTrace(traceId);
    } else if (!traceId) {
      traceRequest++;
      traceLoading.value = false;
      selectedTrace.value = null;
      selectedTurnId.value = null;
      inspectorOpen.value = false;
    }
  } else {
    clearSelection();
    const state = readConversationListState(route.query);
    const legacyId = queryString(route.query.conversationId);
    // Existing dashboard links and bookmarked trace URLs remain usable.
    if (uuid.test(legacyId)) {
      await router.replace(conversationDetailLocation(legacyId, traceId, state));
      return;
    }
    if (uuid.test(traceId)) {
      try {
        const trace = await adminApi.chatTrace(props.token, traceId);
        if (lookup !== lookupRequest) return;
        if (!trace.conversationId) throw new Error('这条轨迹没有关联会话');
        await router.replace(conversationDetailLocation(trace.conversationId, traceId, state));
        return;
      } catch (cause) {
        if (lookup !== lookupRequest) return;
        notify(cause instanceof Error ? cause.message : '无法定位轨迹所属会话', 'error');
      }
    }
    query.value = state.query;
    visitorId.value = state.visitorId;
    applicationId.value = state.applicationId ?? '';
    device.value = state.device;
    timeRange.value = state.timeRange;
    offset.value = state.offset;
    await loadSessions();
  }
  if (lookup !== lookupRequest) return;
  await nextTick();
  const heading = page.value?.querySelector<HTMLElement>('h1');
  heading?.setAttribute('tabindex', '-1');
  if (pageChanged && !inspectorOpen.value) focusHeading();
}
watch(() => route.fullPath, applyRoute);
onMounted(async () => {
  observer = new ResizeObserver(([entry]) => {
    wideLayout.value = (entry?.contentRect.width ?? 0) >= 1060;
  });
  if (page.value) observer.observe(page.value);
  await applyRoute();
});
onUnmounted(() => {
  observer?.disconnect();
  listRequest++;
  detailRequest++;
  traceRequest++;
  lookupRequest++;
});
</script>

<template>
  <section ref="page" class="conversation-page">
    <AdminPageHeader
      :title="isDetailPage ? '会话详情' : '会话管理'"
      :back-to="isDetailPage ? backTo : undefined"
      back-label="返回会话列表"
      ><template #actions
        ><button
          class="ui-button secondary"
          :disabled="loading || lookupLoading || detailLoading || (isDetailPage && !uuid.test(String(route.params.conversationId)))"
          @click="refresh"
        >
          <RefreshCw :size="15" />刷新
        </button></template
      ></AdminPageHeader
    >
    <ToastNotice :message="notice" :type="noticeType" @dismiss="notice = ''" />
    <form v-if="!isDetailPage" class="conversation-toolbar" @submit.prevent="search">
      <label class="conversation-search"
        ><Search :size="15" /><input
          v-model="query"
          class="ui-input"
          placeholder="搜索问题，或粘贴会话 / 轨迹 ID"
          aria-label="搜索会话或轨迹" /><button
          type="submit"
          aria-label="执行搜索"
          :disabled="loading || lookupLoading"
        >
          <LoaderCircle v-if="lookupLoading" class="spin" :size="16" /><ChevronRight v-else :size="16" /></button></label
      ><select v-model="applicationId" class="ui-input" aria-label="接入应用筛选" @change="reload"><option value="">全部应用</option><option v-for="app in applicationOptions" :key="app.id" :value="app.id">{{ app.name }}</option></select><select
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
    <section v-if="!isDetailPage" class="session-list-panel" aria-label="会话列表" :aria-busy="loading">
        <header class="pane-heading">
          <strong>访客会话</strong
          ><span>{{ loading ? '加载中…' : `本页 ${sessions.length} 个` }}</span>
        </header>
        <div ref="listScroller" class="session-list" role="region" aria-label="会话记录" tabindex="0">
          <div v-if="loading" class="conversation-empty" role="status"><LoaderCircle class="spin" :size="20" />正在加载会话…</div>
          <table v-else-if="sessions.length" class="session-table">
            <thead><tr><th scope="col">会话</th><th scope="col">访客 / 设备</th><th scope="col">轮数</th><th scope="col">最近更新</th><th scope="col"><span class="visually-hidden">操作</span></th></tr></thead>
            <tbody>
              <tr v-for="item in sessions" :key="item.id" class="session-item">
                <td class="session-summary">
                  <RouterLink class="session-link" :to="detailLocation(item.id)" @click="rememberListScroll">
                    <strong :title="item.title || item.lastQuestion || ''">{{ item.title || item.lastQuestion || '未命名会话' }}</strong>
                    <span class="session-preview" :title="item.lastQuestion || ''">{{ item.lastQuestion || '暂无问题' }}</span>
                  </RouterLink>
                  <div class="session-flags"><code :title="item.id">{{ item.id.slice(0, 8) }}</code><span v-if="item.hasFailed" class="session-flag failed">含执行失败</span><span v-if="item.hasRefused" class="session-flag refused">含拒答</span></div>
                </td>
                <td class="session-audience"><span :title="item.visitorSessionId">访客 {{ item.visitorSessionId.slice(0, 8) }}</span><small>{{ item.applicationName }} · {{ clientLabel[item.clientType] || item.clientType || '浏览器' }}</small></td>
                <td class="session-rounds">{{ item.turnCount }}<span class="mobile-unit"> 轮</span></td>
                <td class="session-date"><time>{{ date(item.updatedAt) }}</time></td>
                <td class="session-actions"><button class="pane-toggle" :aria-label="`复制会话 ID：${item.id}`" title="复制会话 ID" @click="copy(item.id, '会话 ID')"><Copy :size="15" /></button><RouterLink class="session-detail-link" :to="detailLocation(item.id)" :aria-label="`查看会话：${item.title || item.id}`" @click="rememberListScroll">查看详情<ChevronRight :size="15" aria-hidden="true" /></RouterLink></td>
              </tr>
            </tbody>
          </table>
          <div v-else-if="!error" class="conversation-empty"><p>没有匹配的会话</p><button v-if="query || visitorId || applicationId || device !== 'all' || timeRange !== 'all' || offset" class="ui-button secondary" @click="query = ''; visitorId = ''; applicationId = ''; device = 'all'; timeRange = 'all'; reload()">清除筛选</button></div>
          <div v-else class="conversation-empty"><button class="ui-button secondary" @click="refresh">重新加载</button></div>
        </div>
        <footer class="session-pagination">
          <button
            aria-label="上一页"
            :disabled="offset === 0 || loading"
            @click="nextPage(-1)"
          >
            <ChevronLeft :size="15" />上一页</button
          ><span>第 {{ Math.floor(offset / 30) + 1 }} 页</span
          ><button
            aria-label="下一页"
            :disabled="!hasMore || loading"
            @click="nextPage(1)"
          >
            下一页<ChevronRight :size="15" />
          </button>
        </footer>
    </section>
    <div v-else class="session-workspace" :class="{ 'with-inspector': wideLayout && inspectorOpen }">
      <main class="conversation-detail-panel">
        <div v-if="detailLoading" class="conversation-empty" role="status">
          <LoaderCircle class="spin" :size="22" />正在加载会话…
        </div>
        <template v-else-if="selectedConversation"
          ><header class="conversation-detail-header">
            <div class="conversation-title-row">
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
              ><span>更新于 {{ date(selectedConversation.updatedAt) }}</span><span :title="selectedConversation.visitorSessionId">访客 {{ selectedConversation.visitorSessionId.slice(0, 8) }}</span>
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
                <ProductMessageContent :content="turn.user.content" :context="turn.user.context" />
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
        <div v-else class="conversation-empty"><p>无法加载这个会话</p><RouterLink class="ui-button secondary" :to="backTo">返回会话列表</RouterLink></div>
      </main>
      <aside v-if="wideLayout && inspectorOpen" class="desktop-inspector">
        <ConversationTraceInspector
          :token="token"
          :trace="selectedTrace"
          :loading="traceLoading"
          :error="traceError"
          :can-debug="canDebug"
          @close="closeInspector"
          @copy="copy"
          @link="copyLink"
        />
      </aside>
    </div>
    <UiDrawer
      :open="inspectorOpen && !wideLayout"
      title="执行轨迹"
      @update:open="!$event && closeInspector()"
      ><ConversationTraceInspector
        :show-heading="false"
        :token="token"
        :trace="selectedTrace"
        :loading="traceLoading"
        :error="traceError"
        :can-debug="canDebug"
        @close="closeInspector"
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
.conversation-page :deep(h1:focus) { outline: none; box-shadow: none; }
.conversation-toolbar {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(120px, 160px) minmax(140px, 170px) 120px 130px;
  gap: 10px;
  flex: none;
  margin-bottom: 18px;
}
.conversation-toolbar .ui-input {
  height: 40px;
  font-size: 13px;
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
  font-size: 13px;
}
.session-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  border: 1px solid #e3e8ef;
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}
.session-workspace.with-inspector {
  grid-template-columns: minmax(0, 1fr) 390px;
}
.session-list-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  flex: 1;
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}
.pane-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  padding: 16px 20px;
  border-bottom: 1px solid #e7ecf2;
  font-size: 13px;
}
.pane-heading > span {
  font-size: 12px;
  color: var(--muted);
}
.session-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  isolation: isolate;
  scroll-padding-top: 44px;
}
/* Keep a native table so header/body columns stay aligned. Separate borders
   paint correctly when the sticky cells cover rows scrolling underneath. */
.session-table { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0; }
.session-table th { position: sticky; top: 0; z-index: 2; padding: 12px 20px; background: var(--canvas); color: var(--muted); font-size: 12px; font-weight: 500; text-align: left; box-shadow: inset 0 -1px 0 var(--line); }
.session-table th:first-child { width: 45%; }
.session-table th:nth-child(2) { width: 17%; }
.session-table th:nth-child(3) { width: 7%; }
.session-table th:nth-child(4) { width: 15%; }
.session-table th:last-child { width: 16%; }
.session-table td { padding: 14px 20px; border-top: 1px solid var(--line); font-size: 13px; }
.session-item { position: relative; transition: background .18s; }
.session-item:hover {
  background: var(--canvas);
}
.session-item:focus-within { background: var(--color-brand-50); }
.session-link { display: block; color: var(--ink); text-decoration: none; }
.session-link::after { content: ''; position: absolute; inset: 0; }
.session-link:hover { color: var(--pine); }
.session-actions { position: relative; z-index: 1; }
.session-actions .pane-toggle { display: inline-grid; vertical-align: middle; }
.session-detail-link { display: inline-flex; align-items: center; gap: 3px; padding: 0 5px; min-height: 36px; vertical-align: middle; color: var(--pine); font-size: 12px; white-space: nowrap; text-decoration: none; border-radius: 5px; }
.session-detail-link:hover { background: var(--color-brand-50); }
.session-item strong,
.session-preview {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-item strong {
  font-size: 14px;
  color: inherit;
  font-weight: 600;
}
.session-preview {
  margin: 5px 0 8px;
  color: var(--muted);
  font-size: 12px;
}
.session-flags { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 11px; }
.session-flags code { font-size: 11px; }
.session-flag { padding: 2px 5px; border-radius: 4px; }
.session-flag.failed { color: #bd3d3d; background: #ffeded; }
.session-flag.refused { color: #9a6800; background: #fff5df; }
.session-audience span, .session-audience small { display: block; }
.session-audience small { margin-top: 5px; color: var(--muted); font-size: 12px; }
.session-date { color: var(--muted); font-variant-numeric: tabular-nums; }
.session-rounds { font-variant-numeric: tabular-nums; }
.mobile-unit { display: none; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.session-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  min-height: 60px;
  padding: 0 20px;
  border-top: 1px solid #e7ecf2;
  font-size: 12px;
  color: var(--muted);
}
.session-pagination button,
.pane-toggle {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  gap: 5px;
  min-width: 36px;
  min-height: 36px;
  padding: 0 6px;
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
  overflow-wrap: anywhere;
}
.conversation-metadata {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 8px 0;
  color: var(--muted);
  font-size: 12px;
  flex-wrap: wrap;
}
.conversation-metadata code {
  font:
    12px ui-monospace,
    monospace;
  overflow-wrap: anywhere;
}
.turn-filter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  color: var(--muted);
}
.turn-filter .ui-input {
  width: 146px;
  height: 36px;
  font-size: 12px;
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
  color: var(--muted);
  font-size: 12px;
}
.turn-heading > span:first-child {
  color: #667085;
}
.turn-status {
  margin-left: auto;
  padding: 3px 7px;
  border-radius: 5px;
  white-space: nowrap;
  font-size: 12px;
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
  font-size: 14px;
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
  color: var(--muted);
  font-size: 12px;
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
  min-height: 160px;
  flex-direction: column;
  color: var(--muted);
  font-size: 13px;
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
/* In very short/landscape windows, let the existing outer content scroller
   expose the whole panel instead of shrinking away its records or pagination. */
@media (max-height:540px) {
  .session-list-panel { min-height: 220px; }
}
@container (max-width:850px) {
  .conversation-toolbar {
    grid-template-columns: 1fr 1fr 1fr;
  }
  .conversation-search {
    grid-column: 1/-1;
  }
  .session-table th, .session-table td { padding-left: 12px; padding-right: 12px; }
  .session-table th:first-child { width: 39%; }
  .session-table th:nth-child(2) { width: 19%; }
  .session-table th:nth-child(3) { width: 8%; }
  .session-table th:nth-child(4) { width: 18%; }
  .session-table th:last-child { width: 16%; }
  .session-detail-link { font-size: 0; padding: 0 8px; }
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
@container (max-width:600px) {
  .session-list { scroll-padding-top: 0; }
  .session-table, .session-table tbody { display: block; }
  .session-table thead { display: none; }
  .session-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 12px; padding: 16px; border-bottom: 1px solid var(--line); }
  .session-table td { display: block; padding: 0; border: 0; min-width: 0; }
  .session-summary { grid-column: 1 / -1; }
  .session-audience { grid-row: 2; grid-column: 1; }
  .session-audience span, .session-audience small { display: inline; margin: 0 8px 0 0; font-size: 12px; }
  .session-rounds { grid-row: 3; grid-column: 1; }
  .session-date { grid-row: 3; grid-column: 1; margin-left: 44px; }
  .session-actions { grid-row: 2 / 4; grid-column: 2; align-self: end; }
  .mobile-unit { display: inline; }
  .session-table .session-actions .pane-toggle, .session-detail-link { min-height: 44px; min-width: 44px; }
  .session-actions .session-detail-link { font-size: 0; padding: 0; }
  .conversation-toolbar { gap: 8px; }
  .conversation-toolbar .ui-input { height: 44px; font-size: 13px; }
  .session-pagination button, .pane-toggle, .text-action, .trace-action { min-height: 44px; }
  .conversation-toolbar {
    grid-template-columns: 1fr 1fr 1fr;
  }
  .conversation-search {
    grid-column: 1/-1;
  }
  .conversation-title-row h2 {
    font-size: 15px;
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
