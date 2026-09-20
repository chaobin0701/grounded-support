<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { adminApi, AdminApiError, type AdminItem, type AdminMe, type AuditItem, type ChatTraceDetail, type ChatTraceItem, type DocumentChunk, type DocumentDetail, type DocumentItem, type McpCapabilityItem, type PermissionItem, type RoleItem } from './admin-api';
import './admin.css';

type View = 'documents' | 'conversations' | 'mcp' | 'admins' | 'roles' | 'audit';
onMounted(() => { document.title = '暖巢电器 · 管理中心'; });
const session = ref<{ token: string; me: AdminMe } | null>(null);
const email = ref('');
const password = ref('');
const loginBusy = ref(false);
const loginError = ref('');
const view = ref<View>('documents');
const busy = ref(false);
const error = ref('');
const notice = ref('');

const documents = ref<DocumentItem[]>([]);
const documentOffset = ref(0);
const selectedDocument = ref<DocumentDetail | null>(null);
const chunks = ref<DocumentChunk[]>([]);
const uploadTitle = ref('');
const uploadFile = ref<File | null>(null);
const fileInputKey = ref(0);

const admins = ref<AdminItem[]>([]);
const roles = ref<RoleItem[]>([]);
const permissions = ref<PermissionItem[]>([]);
const audits = ref<AuditItem[]>([]);
const mcpCapabilities = ref<McpCapabilityItem[]>([]);
const chatTraces = ref<ChatTraceItem[]>([]);
const selectedTrace = ref<ChatTraceDetail | null>(null);
const newAdmin = ref({ email: '', displayName: '', password: '', roleIds: [] as number[] });
const editingAdminId = ref<number | null>(null);
const editingRoleIds = ref<number[]>([]);
const roleForm = ref({ id: null as number | null, code: '', name: '', permissionCodes: [] as string[] });

const views: { id: View; label: string; permissions: string[] }[] = [
  { id: 'documents', label: '资料库', permissions: ['documents.read', 'documents.upload'] },
  { id: 'conversations', label: '对话轨迹', permissions: ['conversations.read'] },
  { id: 'mcp', label: 'MCP 能力', permissions: ['mcp.read', 'mcp.manage'] },
  { id: 'admins', label: '管理员', permissions: ['admins.manage'] },
  { id: 'roles', label: '角色权限', permissions: ['roles.manage'] },
  { id: 'audit', label: '操作记录', permissions: ['audit.read'] },
];
const availableViews = computed(() => views.filter((item) => item.permissions.some(can)));
const isSuperAdmin = computed(() => session.value?.me.roles.some((role) => role.code === 'super_admin') ?? false);
const assignableRoles = computed(() => roles.value.filter((role) =>
  (!role.isSystem || isSuperAdmin.value) && role.permissionCodes.every(can),
));

function can(permission: string): boolean {
  return session.value?.me.permissionCodes.includes(permission) ?? false;
}

function describeError(cause: unknown): string {
  if (cause instanceof AdminApiError) {
    if (cause.status === 401) {
      session.value = null;
      return '登录已失效，请重新登录。';
    }
    if (cause.status === 403) return '当前账号没有执行此操作的权限。';
    return cause.message;
  }
  return '操作失败，请稍后再试。';
}

async function signIn() {
  if (loginBusy.value) return;
  loginBusy.value = true;
  loginError.value = '';
  try {
    const login = await adminApi.login(email.value.trim(), password.value);
    const me = await adminApi.me(login.accessToken);
    session.value = { token: login.accessToken, me };
    password.value = '';
    const first = availableViews.value[0];
    if (first) await openView(first.id);
  } catch (cause) {
    loginError.value = cause instanceof AdminApiError && cause.status === 401 ? '邮箱或密码不正确。' : describeError(cause);
  } finally {
    loginBusy.value = false;
  }
}

function signOut() {
  session.value = null;
  documents.value = [];
  selectedDocument.value = null;
  admins.value = [];
  roles.value = [];
  audits.value = [];
  mcpCapabilities.value = [];
  chatTraces.value = [];
  selectedTrace.value = null;
  error.value = '';
  notice.value = '';
}

async function refreshIdentity() {
  if (!session.value) return;
  session.value.me = await adminApi.me(session.value.token);
  if (!availableViews.value.some((item) => item.id === view.value)) {
    const first = availableViews.value[0];
    if (first) await openView(first.id);
  }
}

async function openView(next: View) {
  if (!session.value || !availableViews.value.some((item) => item.id === next)) return;
  view.value = next;
  error.value = '';
  notice.value = '';
  await refresh();
}

async function refresh() {
  if (!session.value) return;
  busy.value = true;
  error.value = '';
  try {
    const token = session.value.token;
    session.value.me = await adminApi.me(token);
    if (!availableViews.value.some((item) => item.id === view.value)) {
      const first = availableViews.value[0];
      if (!first) return;
      view.value = first.id;
    }
    if (view.value === 'documents' && can('documents.read')) documents.value = await adminApi.documents(token, documentOffset.value);
    if (view.value === 'admins') [admins.value, roles.value] = await Promise.all([adminApi.admins(token), adminApi.roles(token)]);
    if (view.value === 'roles') [roles.value, permissions.value] = await Promise.all([adminApi.roles(token), adminApi.permissions(token)]);
    if (view.value === 'audit') audits.value = await adminApi.audit(token);
    if (view.value === 'mcp') mcpCapabilities.value = await adminApi.mcpCapabilities(token);
    if (view.value === 'conversations' && can('conversations.read')) chatTraces.value = await adminApi.chatTraces(token);
  } catch (cause) {
    error.value = describeError(cause);
  } finally {
    busy.value = false;
  }
}

async function action(work: (token: string) => Promise<unknown>, success: string, after?: () => Promise<void>) {
  if (!session.value || busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await work(session.value.token);
    notice.value = success;
    if (after) await after();
  } catch (cause) {
    error.value = describeError(cause);
  } finally {
    busy.value = false;
  }
}

function chooseFile(event: Event) {
  uploadFile.value = (event.target as HTMLInputElement).files?.[0] ?? null;
}

async function upload() {
  const file = uploadFile.value;
  if (!file) { error.value = '请选择资料文件。'; return; }
  if (!/\.(md|markdown|docx|pdf)$/i.test(file.name) || file.size === 0 || file.size > 2 * 1024 * 1024) {
    error.value = '仅支持不超过 2 MB 的非空 Markdown、DOCX 或 PDF 文件。'; return;
  }
  await action((token) => adminApi.upload(token, file, uploadTitle.value), '资料已上传，正在后台处理。', async () => {
    uploadTitle.value = '';
    uploadFile.value = null;
    fileInputKey.value += 1;
    documentOffset.value = 0;
    if (can('documents.read') && session.value) documents.value = await adminApi.documents(session.value.token, 0);
  });
}

async function selectDocument(id: number) {
  if (!session.value || !can('documents.read')) return;
  error.value = '';
  try {
    [selectedDocument.value, chunks.value] = await Promise.all([
      adminApi.document(session.value.token, id), adminApi.chunks(session.value.token, id),
    ]);
  } catch (cause) { error.value = describeError(cause); }
}

async function selectTrace(id: string) {
  if (!session.value || !can('conversations.read')) return;
  try {
    selectedTrace.value = await adminApi.chatTrace(session.value.token, id);
  } catch (cause) { error.value = describeError(cause); }
}

async function changePage(direction: -1 | 1) {
  documentOffset.value = Math.max(0, documentOffset.value + direction * 50);
  await refresh();
}

async function archiveDocument(item: DocumentItem) {
  if (!window.confirm(`下架「${item.title}」？下架后新问题将不再检索这份资料。`)) return;
  await action((token) => adminApi.archive(token, item.id), '资料已下架。', async () => {
    await refresh();
    if (selectedDocument.value?.id === item.id) await selectDocument(item.id);
  });
}

async function processDocument(item: DocumentItem) {
  const retry = item.status === 'failed';
  await action((token) => retry ? adminApi.retry(token, item.id) : adminApi.reprocess(token, item.id),
    retry ? '已重新入队。' : '已安排重新处理。', async () => {
      await refresh();
      if (selectedDocument.value?.id === item.id) await selectDocument(item.id);
    });
}

async function createAdmin() {
  if (!newAdmin.value.roleIds.length) { error.value = '请至少选择一个角色。'; return; }
  const input = { ...newAdmin.value };
  await action((token) => adminApi.createAdmin(token, input), '管理员已创建。', async () => {
    newAdmin.value = { email: '', displayName: '', password: '', roleIds: [] };
    if (session.value) admins.value = await adminApi.admins(session.value.token);
  });
}

async function saveAdminRoles(id: number) {
  await action((token) => adminApi.assignRoles(token, id, editingRoleIds.value), '角色分配已更新。', async () => {
    editingAdminId.value = null;
    if (session.value) admins.value = await adminApi.admins(session.value.token);
    await refreshIdentity();
  });
}

async function toggleAdmin(item: AdminItem) {
  const disable = !item.disabledAt;
  if (!window.confirm(`${disable ? '停用' : '启用'}管理员「${item.displayName}」？`)) return;
  await action((token) => adminApi.setStatus(token, item.id, disable), disable ? '管理员已停用。' : '管理员已启用。', async () => {
    if (session.value) admins.value = await adminApi.admins(session.value.token);
  });
}

async function toggleMcpCapability(item: McpCapabilityItem) {
  const enabled = !item.enabled;
  await action((token) => adminApi.setMcpCapability(token, item.id, enabled),
    enabled ? 'MCP 能力已启用。' : 'MCP 能力已关闭；后续工具调用将被拒绝。', async () => {
      if (session.value) mcpCapabilities.value = await adminApi.mcpCapabilities(session.value.token);
    });
}

async function toggleMcpTool(item: McpCapabilityItem, tool: McpCapabilityItem['tools'][number]) {
  const enabled = !tool.enabled;
  await action((token) => adminApi.setMcpTool(token, item.id, tool.name, enabled),
    enabled ? '工具已授权。' : '工具已停用；后续调用将被拒绝。', async () => {
      if (session.value) mcpCapabilities.value = await adminApi.mcpCapabilities(session.value.token);
    });
}

function editRole(item?: RoleItem) {
  roleForm.value = item
    ? { id: item.id, code: item.code, name: item.name, permissionCodes: [...item.permissionCodes] }
    : { id: null, code: '', name: '', permissionCodes: [] };
}

async function saveRole() {
  const form = roleForm.value;
  const input = { name: form.name.trim(), permissionCodes: form.permissionCodes };
  if (!input.name) { error.value = '请输入角色名称。'; return; }
  await action((token) => form.id === null
    ? adminApi.createRole(token, { code: form.code.trim(), ...input })
    : adminApi.updateRole(token, form.id, input), '角色权限已保存。', async () => {
    editRole();
    if (session.value) roles.value = await adminApi.roles(session.value.token);
    await refreshIdentity();
  });
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
}

function statusLabel(item: DocumentItem): string {
  if (item.archivedAt) return '已下架';
  return ({ queued: '排队中', processing: '处理中', ready: '可检索', failed: '失败', extracted: '待重建' } as Record<string, string>)[item.status] ?? item.status;
}

function sourceLocation(filename: string, start: number, end: number): string {
  const unit = /\.pdf$/i.test(filename) ? '页' : /\.docx$/i.test(filename) ? '段' : '行';
  return `第 ${start}${end !== start ? `–${end}` : ''} ${unit}`;
}
</script>

<template>
  <div v-if="!session" class="admin-login">
    <div class="admin-login-brand"><span class="brand-mark">暖</span><span>暖巢电器 <small>管理中心</small></span></div>
    <main class="admin-login-main">
      <p class="section-label">暖巢 · 管理中心</p>
      <h1>欢迎回来</h1>
      <p>使用管理员账号登录。会话只保留在当前页面，关闭或刷新后需要重新登录。</p>
      <form @submit.prevent="signIn">
        <label>邮箱<input v-model.trim="email" type="email" autocomplete="username" required placeholder="admin@example.com" /></label>
        <label>密码<input v-model="password" type="password" autocomplete="current-password" required placeholder="输入管理员密码" /></label>
        <p v-if="loginError" class="admin-error" role="alert">{{ loginError }}</p>
        <button class="admin-primary" type="submit" :disabled="loginBusy">{{ loginBusy ? '正在登录…' : '登录后台' }}</button>
      </form>
      <a href="/">← 返回访客问答</a>
    </main>
    <p class="admin-login-foot">仅授权管理员可访问资料与权限操作。</p>
  </div>

  <div v-else class="admin-shell">
    <aside class="admin-sidebar">
      <div class="admin-brand"><span class="brand-mark">暖</span><span>暖巢电器<small>管理中心</small></span></div>
      <nav aria-label="管理导航">
        <p class="admin-nav-label">工作区</p>
        <button v-for="item in availableViews" :key="item.id" type="button" :class="{ active: view === item.id }" :aria-current="view === item.id ? 'page' : undefined" @click="openView(item.id)">{{ item.label }}</button>
      </nav>
      <div class="admin-sidebar-bottom"><span>{{ session.me.displayName }}</span><small>{{ session.me.email }}</small><a href="/">访客页面 ↗</a><button type="button" @click="signOut">退出登录</button></div>
    </aside>

    <main class="admin-main">
      <header class="admin-top"><span>管理中心 <span class="admin-top-separator">/</span> {{ views.find((item) => item.id === view)?.label }}</span><span class="admin-top-identity"><i aria-hidden="true"></i>{{ session.me.roles.map((role) => role.name).join(' · ') || '无角色' }}</span></header>
      <div class="admin-content">
        <p v-if="error" class="admin-error" role="alert">{{ error }}</p>
        <p v-if="notice" class="admin-notice" role="status">{{ notice }}</p>

        <section v-if="!availableViews.length" class="admin-empty"><h1>暂无可用权限</h1><p>请联系超级管理员分配角色。</p></section>

        <section v-else-if="view === 'documents'">
          <div class="admin-heading"><div><p class="section-label">知识管理</p><h1>资料库</h1><p>维护客服可引用的资料。仅已就绪且未下架的内容参与回答。</p></div><button v-if="can('documents.read')" type="button" class="admin-text-button" :disabled="busy" @click="refresh">刷新状态 ↻</button></div>
          <form v-if="can('documents.upload')" class="admin-upload" @submit.prevent="upload">
            <div><h2>上传资料</h2><p>支持 Markdown、Word（.docx）和可选中文字的 PDF；最多 2 MB，扫描版 PDF 暂不支持。</p></div>
            <label>资料标题（可选）<input v-model="uploadTitle" maxlength="200" placeholder="不填则使用文件名" /></label>
            <label>选择文件<input :key="fileInputKey" type="file" accept=".md,.markdown,.docx,.pdf,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" @change="chooseFile" /></label>
            <button class="admin-primary" type="submit" :disabled="busy || !uploadFile">上传资料</button>
          </form>
          <template v-if="can('documents.read')">
            <div class="admin-section-head"><h2>全部资料</h2><span>每页 50 条</span></div>
            <div class="admin-work-area" :class="{ 'has-inspector': selectedDocument }"><div class="admin-work-list"><div class="admin-list admin-document-list">
              <div v-for="item in documents" :key="item.id" class="admin-row" :class="{ selected: selectedDocument?.id === item.id }">
                <button type="button" class="admin-row-main" @click="selectDocument(item.id)"><strong>{{ item.title }}</strong><small>{{ item.originalFilename }} · {{ formatDate(item.createdAt) }}</small></button>
                <span class="admin-status" :class="item.archivedAt ? 'archived' : item.status">{{ statusLabel(item) }}</span>
              </div>
              <p v-if="!documents.length && !busy" class="admin-muted">暂无资料。</p>
            </div>
            <div class="admin-pagination"><button type="button" :disabled="busy || documentOffset === 0" @click="changePage(-1)">上一页</button><span>第 {{ Math.floor(documentOffset / 50) + 1 }} 页</span><button type="button" :disabled="busy || documents.length < 50" @click="changePage(1)">下一页</button></div></div>
            <section v-if="selectedDocument" class="admin-inspector">
              <div class="admin-section-head"><div><p class="section-label">资料详情 · #{{ selectedDocument.id }}</p><h2>{{ selectedDocument.title }}</h2></div><button type="button" class="admin-text-button" @click="selectedDocument = null">关闭详情 ×</button></div>
              <p class="admin-muted">{{ selectedDocument.originalFilename }} · {{ selectedDocument.chunkCount }} 个片段 · {{ statusLabel(selectedDocument) }}</p>
              <p v-if="selectedDocument.errorMessage" class="admin-error">处理失败：{{ selectedDocument.errorMessage }}</p>
              <div class="admin-actions">
                <button v-if="can('documents.reprocess') && !selectedDocument.archivedAt && ['failed', 'ready', 'extracted'].includes(selectedDocument.status)" type="button" :disabled="busy" @click="processDocument(selectedDocument)">{{ selectedDocument.status === 'failed' ? '失败重试' : '重新处理' }}</button>
                <button v-if="can('documents.archive') && !selectedDocument.archivedAt" type="button" class="danger" :disabled="busy" @click="archiveDocument(selectedDocument)">下架资料</button>
              </div>
              <details v-if="selectedDocument.extractedText" class="admin-details"><summary>查看提取的正文</summary><pre>{{ selectedDocument.extractedText }}</pre></details>
              <details v-if="chunks.length" class="admin-details"><summary>查看片段与出处（{{ chunks.length }}）</summary><div v-for="chunk in chunks" :key="chunk.id" class="admin-chunk"><strong>{{ chunk.headingPath || `片段 ${chunk.ordinal + 1}` }}</strong><small>{{ sourceLocation(selectedDocument.originalFilename, chunk.sourceStartLine, chunk.sourceEndLine) }}</small><p>{{ chunk.content }}</p></div></details>
            </section></div>
          </template>
          <p v-else class="admin-muted">当前账号没有查看资料列表的权限。</p>
        </section>

        <section v-else-if="view === 'conversations'">
          <div class="admin-heading"><div><p class="section-label">服务观察</p><h1>对话轨迹</h1><p>查看访客提问、检索上下文、模型输出与最终回答。仅展示最近 50 次。</p></div><button type="button" class="admin-text-button" :disabled="busy" @click="refresh">刷新 ↻</button></div>
          <div class="admin-list">
            <button v-for="item in chatTraces" :key="item.id" type="button" class="trace-row" :class="{ selected: selectedTrace?.id === item.id }" @click="selectTrace(item.id)">
              <span class="trace-row-main"><strong>{{ item.question }}</strong><small>{{ formatDate(item.createdAt) }} · {{ item.model || '未调用模型' }}</small></span>
              <span class="admin-status" :class="item.status === 'failed' ? 'failed' : item.refused ? 'archived' : 'ready'">{{ item.status === 'failed' ? '失败' : item.kind === 'summary' ? '摘要' : item.refused ? '拒答' : '已回答' }}</span>
              <small class="trace-metrics">{{ item.totalTokens ?? '—' }} tokens · {{ item.durationMs }} ms</small>
            </button>
            <p v-if="!chatTraces.length && !busy" class="admin-muted">暂无对话轨迹。</p>
          </div>
          <section v-if="selectedTrace" class="admin-inspector trace-inspector">
            <div class="admin-section-head"><div><p class="section-label">轨迹 · {{ selectedTrace.id.slice(0, 8) }}</p><h2>回答详情</h2></div><button type="button" class="admin-text-button" @click="selectedTrace = null">关闭详情 ×</button></div>
            <p class="admin-muted">{{ formatDate(selectedTrace.createdAt) }} · {{ selectedTrace.model || '未调用模型' }} · {{ selectedTrace.durationMs }} ms</p>
            <p class="admin-muted">输入 {{ selectedTrace.inputTokens ?? '未提供' }} / 输出 {{ selectedTrace.outputTokens ?? '未提供' }} / 总计 {{ selectedTrace.totalTokens ?? '未提供' }} tokens</p>
            <div class="trace-field"><h3>访客提问</h3><p>{{ selectedTrace.question }}</p></div>
            <div class="trace-field"><h3>最终回答</h3><p>{{ selectedTrace.finalAnswer || (selectedTrace.status === 'failed' ? '调用失败，未产生回答。' : '—') }}</p></div>
            <details v-if="selectedTrace.contextSnapshot.systemPrompt" class="admin-details"><summary>查看系统提示词 · {{ selectedTrace.contextSnapshot.promptVersion }}</summary><pre>{{ selectedTrace.contextSnapshot.systemPrompt }}</pre></details>
            <div v-if="selectedTrace.contextSnapshot.summary || selectedTrace.contextSnapshot.previousSummary" class="trace-field"><h3>本会话摘要</h3><p>{{ selectedTrace.contextSnapshot.summary || selectedTrace.contextSnapshot.previousSummary }}</p></div>
            <details v-if="selectedTrace.contextSnapshot.history?.length || selectedTrace.contextSnapshot.recentMessages?.length || selectedTrace.contextSnapshot.messages?.length" class="admin-details"><summary>查看传入的会话上下文</summary><pre>{{ JSON.stringify(selectedTrace.contextSnapshot.history || selectedTrace.contextSnapshot.recentMessages || selectedTrace.contextSnapshot.messages, null, 2) }}</pre></details>
            <details v-if="selectedTrace.contextSnapshot.sources?.length" class="admin-details"><summary>查看当轮检索片段（{{ selectedTrace.contextSnapshot.sources.length }}）</summary><div v-for="source in selectedTrace.contextSnapshot.sources" :key="source.chunkId" class="admin-chunk"><strong>#{{ source.chunkId }} · {{ source.title }}</strong><small>{{ source.heading }}</small><p>{{ source.content }}</p></div></details>
            <details v-if="selectedTrace.contextSnapshot.toolCalls?.length" class="admin-details"><summary>查看工具调用（{{ selectedTrace.contextSnapshot.toolCalls.length }}）</summary><div v-for="(call, index) in selectedTrace.contextSnapshot.toolCalls" :key="`${call.name}-${index}`" class="admin-chunk"><strong>{{ call.name }}</strong><small>{{ call.ok ? '已完成' : '失败' }} · {{ call.durationMs }} ms</small><pre>{{ JSON.stringify(call.arguments, null, 2) }}</pre></div></details>
            <details v-if="selectedTrace.contextSnapshot.productDetails?.length" class="admin-details"><summary>查看本轮产品数据（mock）</summary><pre>{{ JSON.stringify(selectedTrace.contextSnapshot.productDetails, null, 2) }}</pre></details>
            <details v-if="selectedTrace.rawModelOutput" class="admin-details"><summary>查看模型原始输出</summary><pre>{{ selectedTrace.rawModelOutput }}</pre></details>
            <p v-if="selectedTrace.errorCode" class="admin-error">失败代码：{{ selectedTrace.errorCode }}</p>
          </section>
        </section>

        <section v-else-if="view === 'mcp'">
          <div class="admin-heading"><div><p class="section-label">能力治理</p><h1>MCP 能力</h1><p>管理已审核的 MCP 服务与工具。模型只能选择本轮获准的工具，调用前后端会再次校验。</p></div><button type="button" class="admin-text-button" :disabled="busy" @click="refresh">刷新状态 ↻</button></div>
          <div v-for="item in mcpCapabilities" :key="item.id" class="mcp-capability">
            <div class="mcp-capability-head"><div><h2>{{ item.name }}</h2><p>{{ item.id }} · 内置 {{ item.transport }} 服务 · {{ item.manifestKey }}</p></div><div class="mcp-capability-state"><span class="admin-status" :class="item.enabled ? 'ready' : 'archived'">{{ item.enabled ? '已启用' : '已关闭' }}</span><button v-if="can('mcp.manage')" type="button" :disabled="busy" @click="toggleMcpCapability(item)">{{ item.enabled ? '关闭能力' : '启用能力' }}</button></div></div>
            <div class="admin-section-head"><h3>工具授权</h3><span>{{ item.tools.filter((tool) => tool.enabled).length }} / {{ item.tools.length }} 已授权</span></div>
            <div v-for="tool in item.tools" :key="tool.name" class="mcp-tool-row"><div><strong>{{ tool.displayName }}</strong><small>{{ tool.name }}</small></div><span class="admin-status" :class="item.enabled && tool.enabled ? 'ready' : 'archived'">{{ !item.enabled ? '随服务关闭' : tool.enabled ? '可供 Agent 使用' : '已停用' }}</span><button v-if="can('mcp.manage')" type="button" :disabled="busy" @click="toggleMcpTool(item, tool)">{{ tool.enabled ? '停用工具' : '授权工具' }}</button></div>
          </div>
          <p v-if="!mcpCapabilities.length && !busy" class="admin-muted">尚无已登记的 MCP 能力。</p>
          <p class="admin-muted">本阶段仅管理内置服务；工具发现审批和外部服务接入尚未开放。</p>
        </section>

        <section v-else-if="view === 'admins'">
          <div class="admin-heading"><div><p class="section-label">账号管理</p><h1>管理员</h1><p>创建账号、分配角色和停用账号；实际授权始终由后端校验。</p></div><button type="button" class="admin-text-button" :disabled="busy" @click="refresh">刷新 ↻</button></div>
          <form class="admin-form" @submit.prevent="createAdmin">
            <h2>创建管理员</h2>
            <div class="admin-form-grid"><label>显示名称<input v-model.trim="newAdmin.displayName" required maxlength="120" /></label><label>邮箱<input v-model.trim="newAdmin.email" type="email" required /></label><label>初始密码<input v-model="newAdmin.password" type="password" minlength="12" maxlength="72" autocomplete="new-password" required /></label></div>
            <fieldset><legend>分配角色</legend><label v-for="role in assignableRoles" :key="role.id" class="admin-check"><input v-model="newAdmin.roleIds" type="checkbox" :value="role.id" />{{ role.name }} <small>{{ role.code }}</small></label></fieldset>
            <button class="admin-primary" type="submit" :disabled="busy || !assignableRoles.length">创建账号</button>
          </form>
          <div class="admin-section-head"><h2>账号列表</h2><span>{{ admins.length }} 位</span></div>
          <div class="admin-list"><div v-for="item in admins" :key="item.id" class="admin-person-row"><div><strong>{{ item.displayName }}</strong><small>{{ item.email }} · {{ item.roles.map((role) => role.code).join('、') || '未分配角色' }}</small></div><span class="admin-status" :class="item.disabledAt ? 'archived' : 'ready'">{{ item.disabledAt ? '已停用' : '启用中' }}</span><div class="admin-actions"><button v-if="item.roles.every((role) => assignableRoles.some((candidate) => candidate.id === role.id))" type="button" @click="editingAdminId = item.id; editingRoleIds = item.roles.map((role) => role.id)">调整角色</button><button v-if="item.id !== session.me.id" type="button" :disabled="busy" @click="toggleAdmin(item)">{{ item.disabledAt ? '启用' : '停用' }}</button></div><div v-if="editingAdminId === item.id" class="admin-inline-editor"><label v-for="role in assignableRoles" :key="role.id" class="admin-check"><input v-model="editingRoleIds" type="checkbox" :value="role.id" />{{ role.name }}</label><button type="button" class="admin-primary" :disabled="busy" @click="saveAdminRoles(item.id)">保存角色</button><button type="button" @click="editingAdminId = null">取消</button></div></div></div>
        </section>

        <section v-else-if="view === 'roles'">
          <div class="admin-heading"><div><p class="section-label">访问控制</p><h1>角色权限</h1><p>权限代码由后端定义；这里只组合权限，不创建新的权限代码。</p></div><button type="button" class="admin-text-button" :disabled="busy" @click="refresh">刷新 ↻</button></div>
          <form class="admin-form" @submit.prevent="saveRole"><h2>{{ roleForm.id === null ? '创建角色' : `编辑角色 #${roleForm.id}` }}</h2><div class="admin-form-grid"><label>角色代码<input v-model.trim="roleForm.code" :disabled="roleForm.id !== null" pattern="[a-z][a-z0-9_]{2,79}" required placeholder="knowledge_editor" /></label><label>角色名称<input v-model.trim="roleForm.name" required maxlength="120" /></label></div><fieldset><legend>权限</legend><label v-for="permission in permissions" :key="permission.code" class="admin-check"><input v-model="roleForm.permissionCodes" type="checkbox" :value="permission.code" :disabled="!can(permission.code)" />{{ permission.description }} <small>{{ permission.code }}</small></label></fieldset><div class="admin-actions"><button class="admin-primary" type="submit" :disabled="busy">保存角色</button><button v-if="roleForm.id !== null" type="button" @click="editRole()">取消编辑</button></div></form>
          <div class="admin-section-head"><h2>现有角色</h2><span>{{ roles.length }} 个</span></div><div class="admin-list"><div v-for="item in roles" :key="item.id" class="admin-role-row"><div><strong>{{ item.name }} <small v-if="item.isSystem">系统角色</small></strong><small>{{ item.code }} · {{ item.permissionCodes.join('、') || '无权限' }}</small></div><button v-if="!item.isSystem && item.permissionCodes.every(can)" type="button" @click="editRole(item)">编辑</button></div></div>
        </section>

        <section v-else-if="view === 'audit'">
          <div class="admin-heading"><div><p class="section-label">审计追踪</p><h1>操作记录</h1><p>最近 50 条管理员操作，用于追溯资料与权限变更。</p></div><button type="button" class="admin-text-button" :disabled="busy" @click="refresh">刷新 ↻</button></div>
          <div class="admin-list"><div v-for="item in audits" :key="item.id" class="admin-audit-row"><time>{{ formatDate(item.createdAt) }}</time><strong>{{ item.action }}</strong><span>{{ item.targetType }} #{{ item.targetId }}</span><small>操作者 #{{ item.actorAdminId }}</small></div><p v-if="!audits.length && !busy" class="admin-muted">暂无记录。</p></div>
        </section>
      </div>
    </main>
  </div>
</template>
