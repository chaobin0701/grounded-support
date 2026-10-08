<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Bot, Boxes, Cpu, Database, LayoutDashboard, MessageSquareText, ScrollText, ShieldCheck, Users } from '@lucide/vue';
import type { Component } from 'vue';
import { adminApi, AdminApiError, type AdminItem, type AdminMe, type AuditItem, type DocumentChunk, type DocumentDetail, type DocumentItem, type PermissionItem, type RoleItem } from './admin-api';
import { clearAdminSession, loadAdminSession, loadAdminView, saveAdminSession, saveAdminView } from './admin-session';
import { groupAdminNavigation } from './admin-navigation';
import './admin.css';
import KnowledgeBaseAdmin from './KnowledgeBaseAdmin.vue';
import AdminDashboard from './AdminDashboard.vue';
import ProductCatalogAdmin from './ProductCatalogAdmin.vue';
import ConversationTraceAdmin from './ConversationTraceAdmin.vue';
import AdminPageHeader from './ui/AdminPageHeader.vue';
import UiDialog from './ui/UiDialog.vue';
import ToastNotice from './ui/ToastNotice.vue';
import ModelServiceAdmin from './ModelServiceAdmin.vue';
import EmbeddingServiceAdmin from './EmbeddingServiceAdmin.vue';
import AgentConfigAdmin from './AgentConfigAdmin.vue';

type View = 'dashboard' | 'knowledge' | 'products' | 'documents' | 'conversations' | 'agent-config' | 'model-services' | 'embedding-services' | 'admins' | 'roles' | 'audit';
const route = useRoute();
const router = useRouter();
const session = ref<{ token: string; me: AdminMe } | null>(null);
const email = ref('');
const password = ref('');
const loginBusy = ref(false);
const loginError = ref('');
const view = ref<View>('documents');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const adminDialog = ref<'createAdmin' | 'assignRoles' | 'role' | null>(null);
const confirmDialog = ref<{ title: string; description: string; confirmLabel: string; run: () => Promise<void> } | null>(null);

const documents = ref<DocumentItem[]>([]);
const documentOffset = ref(0);
const selectedDocument = ref<DocumentDetail | null>(null);
const chunks = ref<DocumentChunk[]>([]);
const uploadTitle = ref('');
const uploadFile = ref<File | null>(null);
const fileInputKey = ref(0);

const admins = ref<AdminItem[]>([]);
const roles = ref<RoleItem[]>([]);
const selectedAdminId = ref<number | null>(null);
const selectedRoleId = ref<number | null>(null);
const permissions = ref<PermissionItem[]>([]);
const audits = ref<AuditItem[]>([]);
const newAdmin = ref({ email: '', displayName: '', password: '', roleIds: [] as number[] });
const editingRoleIds = ref<number[]>([]);
const roleForm = ref({ id: null as number | null, code: '', name: '', permissionCodes: [] as string[] });
const selectedAdmin = computed(() => admins.value.find((item) => item.id === selectedAdminId.value) ?? null);
const selectedRole = computed(() => roles.value.find((item) => item.id === selectedRoleId.value) ?? null);
const permissionGroups = computed(() => {
  const labels: Record<string, string> = { admins: '管理员', roles: '角色权限', documents: '资料', knowledge_bases: '知识库', conversations: '对话', agent_config: 'Agent 配置', model_profiles: '模型服务', embedding_profiles: 'Embedding 服务', audit: '操作记录' };
  const grouped = new Map<string, PermissionItem[]>();
  for (const permission of permissions.value) {
    const key = permission.code.split('.')[0] ?? 'other';
    grouped.set(key, [...(grouped.get(key) ?? []), permission]);
  }
  return [...grouped.entries()].map(([key, items]) => ({ label: labels[key] ?? key, items }));
});

const views: { id: View; label: string; permissions: string[]; icon: Component }[] = [
  { id: 'dashboard', label: '概览', icon: LayoutDashboard, permissions: ['documents.read', 'knowledge_bases.manage', 'conversations.read'] },
  { id: 'knowledge', label: '知识库', icon: Database, permissions: ['documents.read', 'knowledge_bases.manage'] },
  { id: 'products', label: '产品管理', icon: Boxes, permissions: ['knowledge_bases.manage'] },
  { id: 'conversations', label: '会话管理', icon: MessageSquareText, permissions: ['conversations.read'] },
  { id: 'agent-config', label: 'Agent 配置', icon: Bot, permissions: ['agent_config.read', 'agent_config.manage'] },
  { id: 'model-services', label: '模型服务', icon: Cpu, permissions: ['model_profiles.read', 'model_profiles.manage'] },
  { id: 'embedding-services', label: 'Embedding 服务', icon: Database, permissions: ['embedding_profiles.read', 'embedding_profiles.manage'] },
  { id: 'admins', label: '管理员', icon: Users, permissions: ['admins.manage'] },
  { id: 'roles', label: '角色权限', icon: ShieldCheck, permissions: ['roles.manage'] },
  { id: 'audit', label: '操作记录', icon: ScrollText, permissions: ['audit.read'] },
];
function viewFromRoute(): View | null {
  const section = route.params.section;
  if (typeof section === 'string' && views.some((item) => item.id === section)) return section as View;
  if (route.path.startsWith('/admin/knowledge/')) return 'knowledge';
  if (route.path.startsWith('/admin/conversations/')) return 'conversations';
  return null;
}
const availableViews = computed(() => views.filter((item) => item.permissions.some(can)));
const navigation = computed(() => groupAdminNavigation(availableViews.value));
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
      clearAdminSession();
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
    saveAdminSession(login.accessToken, me);
    password.value = '';
    const requested = viewFromRoute();
    const target = requested && availableViews.value.some((item) => item.id === requested)
      ? requested
      : availableViews.value[0]?.id;
    if (target) {
      if (route.path.startsWith(`/admin/${target}/`)) {
        view.value = target;
        await refresh();
      } else await openView(target);
    }
  } catch (cause) {
    loginError.value = cause instanceof AdminApiError && cause.status === 401 ? '邮箱或密码不正确。' : describeError(cause);
  } finally {
    loginBusy.value = false;
  }
}

function signOut() {
  session.value = null;
  clearAdminSession();
  documents.value = [];
  selectedDocument.value = null;
  admins.value = [];
  roles.value = [];
  audits.value = [];
  error.value = '';
  notice.value = '';
  void router.replace('/admin');
}

async function refreshIdentity() {
  if (!session.value) return;
  session.value.me = await adminApi.me(session.value.token);
  saveAdminSession(session.value.token, session.value.me);
  if (!availableViews.value.some((item) => item.id === view.value)) {
    const first = availableViews.value[0];
    if (first) await openView(first.id);
  }
}

async function openView(next: View) {
  if (!session.value || !availableViews.value.some((item) => item.id === next)) return;
  view.value = next;
  saveAdminView(next);
  if (route.params.section === next) await refresh();
  else await router.push(`/admin/${next}`);
}

async function refresh() {
  if (!session.value) return;
  busy.value = true;
  error.value = '';
  try {
    const token = session.value.token;
    session.value.me = await adminApi.me(token);
    saveAdminSession(token, session.value.me);
    if (!availableViews.value.some((item) => item.id === view.value)) {
      const first = availableViews.value[0];
      if (!first) return;
      view.value = first.id;
    }
    if (view.value === 'documents' && can('documents.read')) documents.value = await adminApi.documents(token, documentOffset.value);
    if (view.value === 'admins') {
      [admins.value, roles.value] = await Promise.all([adminApi.admins(token), adminApi.roles(token)]);
      if (selectedAdminId.value === null) selectedAdminId.value = admins.value[0]?.id ?? null;
    }
    if (view.value === 'roles') {
      [roles.value, permissions.value] = await Promise.all([adminApi.roles(token), adminApi.permissions(token)]);
      if (selectedRoleId.value === null) selectedRoleId.value = roles.value[0]?.id ?? null;
    }
    if (view.value === 'audit') audits.value = await adminApi.audit(token);
  } catch (cause) {
    error.value = describeError(cause);
  } finally {
    busy.value = false;
  }
}

watch(() => route.path, async () => {
  const next = viewFromRoute();
  if (!next) return;
  view.value = next;
  saveAdminView(view.value);
  error.value = '';
  notice.value = '';
  if (session.value) await refresh();
});
onMounted(async () => {
  document.title = '产品智能客服 · 管理中心';
  const restored = loadAdminSession();
  const savedView = loadAdminView();
  if (!restored) return;
  session.value = { token: restored.token, me: restored.me };
  const requested = viewFromRoute();
  const fallback = savedView && views.some((item) => item.id === savedView) ? savedView as View : availableViews.value[0]?.id;
  if (requested && availableViews.value.some((item) => item.id === requested)) {
    view.value = requested;
    await refresh();
  } else if (fallback) await router.replace(`/admin/${fallback}`);
});

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

async function changePage(direction: -1 | 1) {
  documentOffset.value = Math.max(0, documentOffset.value + direction * 50);
  await refresh();
}

async function archiveDocument(item: DocumentItem) {
  confirmDialog.value = { title: '下架资料', description: `确定下架「${item.title}」？下架后新问题将不再检索这份资料。`, confirmLabel: '确认下架', run: async () => {
    await action((token) => adminApi.archive(token, item.id), '资料已下架。', async () => {
      await refresh();
      if (selectedDocument.value?.id === item.id) await selectDocument(item.id);
    });
  } };
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
    adminDialog.value = null;
    if (session.value) admins.value = await adminApi.admins(session.value.token);
  });
}

async function saveAdminRoles(id: number) {
  await action((token) => adminApi.assignRoles(token, id, editingRoleIds.value), '角色分配已更新。', async () => {
    adminDialog.value = null;
    if (session.value) admins.value = await adminApi.admins(session.value.token);
    await refreshIdentity();
  });
}

async function toggleAdmin(item: AdminItem) {
  const disable = !item.disabledAt;
  confirmDialog.value = { title: `${disable ? '停用' : '启用'}管理员`, description: `确定${disable ? '停用' : '启用'}「${item.displayName}」(${item.email})？`, confirmLabel: disable ? '确认停用' : '确认启用', run: async () => {
    await action((token) => adminApi.setStatus(token, item.id, disable), disable ? '管理员已停用。' : '管理员已启用。', async () => {
      if (session.value) admins.value = await adminApi.admins(session.value.token);
    });
  } };
}

function editRole(item?: RoleItem) {
  roleForm.value = item
    ? { id: item.id, code: item.code, name: item.name, permissionCodes: [...item.permissionCodes] }
    : { id: null, code: '', name: '', permissionCodes: [] };
  adminDialog.value = 'role';
}

function selectAdmin(item: AdminItem) {
  selectedAdminId.value = item.id;
}

function selectRole(item: RoleItem) {
  selectedRoleId.value = item.id;
}

async function saveRole() {
  const form = roleForm.value;
  const input = { name: form.name.trim(), permissionCodes: form.permissionCodes };
  if (!input.name) { error.value = '请输入角色名称。'; return; }
  await action((token) => form.id === null
    ? adminApi.createRole(token, { code: form.code.trim(), ...input })
    : adminApi.updateRole(token, form.id, input), '角色权限已保存。', async () => {
    editRole();
    adminDialog.value = null;
    if (session.value) roles.value = await adminApi.roles(session.value.token);
    await refreshIdentity();
  });
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
}

function auditActionLabel(action: string): string {
  const labels: Record<string, string> = {
    'admin.created': '创建管理员', 'admin.disabled': '停用管理员', 'admin.enabled': '启用管理员', 'admin.roles_updated': '调整管理员角色',
    'role.created': '创建角色', 'role.updated': '更新角色权限', 'document.uploaded': '上传资料', 'document.archived': '下架资料',
    'document.reprocessed': '重新处理资料', 'document.retried': '重试资料处理', 'document.reprocess_all': '批量重新处理资料',
    'knowledge_base.created': '创建知识库', 'knowledge_base.updated': '更新知识库', 'knowledge_base.archived': '归档知识库',
    'knowledge_base.configured': '更新索引配置', 'knowledge_index.build_requested': '请求构建索引', 'knowledge_index.activated': '启用索引版本',
    'embedding_profile.created': '添加 Embedding 配置', 'embedding_profile.updated': '更新 Embedding 配置', 'faq.saved': '保存 FAQ',
    'embedding_profile.deleted': '删除 Embedding 配置', 'embedding_profile.tested': '测试 Embedding 连接', 'knowledge_index.preserved': '保留旧索引',
    'debug.inspected': '检查会话调试上下文',
    'agent_config.updated': '更新 Agent 配置',
    'llm_profile.created': '添加模型配置', 'llm_profile.updated': '更新模型配置',
    'llm_profile.activated': '切换当前模型', 'llm_profile.deleted': '删除模型配置',
  };
  return labels[action] ?? action;
}

function auditTargetLabel(targetType: string): string {
  return ({ admin: '管理员', role: '角色', document: '资料', knowledge_base: '知识库', knowledge_index: '知识索引', embedding_profile: 'Embedding 配置', llm_profile: '模型配置', debug_inspection: '调试检查' } as Record<string, string>)[targetType] ?? targetType;
}

async function runConfirmation() {
  const pending = confirmDialog.value;
  if (!pending || busy.value) return;
  await pending.run();
  confirmDialog.value = null;
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
    <div class="admin-login-brand"><span class="brand-mark" aria-hidden="true"><Bot :size="22" /></span><span>产品智能客服 <small>管理中心</small></span></div>
    <main class="admin-login-main">
      <p class="section-label">产品智能客服 · 管理中心</p>
      <h1>欢迎回来</h1>
      <p>登录状态保存在当前浏览器，直至服务端会话到期、主动退出或账号被停用。</p>
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
    <header class="admin-global-header">
      <div class="admin-brand"><span class="brand-mark" aria-hidden="true"><Bot :size="20" /></span><span>产品智能客服</span></div>
      <div class="admin-global-user"><span>{{ session.me.displayName.slice(0, 1) }}</span><div><strong>{{ session.me.displayName }}</strong><small>{{ session.me.roles.map((role) => role.name).join(' · ') || '无角色' }}</small></div></div>
    </header>
    <aside class="admin-sidebar">
      <nav aria-label="管理导航">
        <RouterLink v-for="item in navigation.root" :key="item.id" :to="`/admin/${item.id}`" :class="{ active: view === item.id }" :aria-current="view === item.id ? 'page' : undefined"><component :is="item.icon" :size="17" /><span>{{ item.label }}</span></RouterLink>
        <section v-for="group in navigation.groups" :key="group.id" class="admin-nav-group" :aria-labelledby="`admin-nav-${group.id}`">
          <p :id="`admin-nav-${group.id}`" class="admin-nav-label">{{ group.label }}</p>
          <div class="admin-nav-items">
            <RouterLink v-for="item in group.items" :key="item.id" :to="`/admin/${item.id}`" :class="{ active: view === item.id }" :aria-current="view === item.id ? 'page' : undefined"><component :is="item.icon" :size="17" /><span>{{ item.label }}</span></RouterLink>
          </div>
        </section>
      </nav>
      <div class="admin-sidebar-bottom"><a href="/">访客页面 ↗</a><button type="button" @click="signOut">退出登录</button></div>
    </aside>

    <main class="admin-main">
      <div class="admin-content" :class="{ 'admin-conversation-content': view === 'conversations' }">
        <ToastNotice :message="error || notice" :type="error ? 'error' : 'success'" @dismiss="error ? (error = '') : (notice = '')" />

        <section v-if="!availableViews.length" class="admin-empty"><h1>暂无可用权限</h1><p>请联系超级管理员分配角色。</p></section>

        <AdminDashboard v-else-if="view === 'dashboard'" :token="session.token" />
        <KnowledgeBaseAdmin v-else-if="view === 'knowledge'" :token="session.token" :permissions="session.me.permissionCodes" />
        <ProductCatalogAdmin v-else-if="view === 'products'" :token="session.token" />
        <AgentConfigAdmin v-else-if="view === 'agent-config'" :token="session.token" :permissions="session.me.permissionCodes" />
        <section v-else-if="view === 'documents'">
          <AdminPageHeader title="资料库">
            <template #actions><button v-if="can('documents.read')" type="button" class="admin-text-button" :disabled="busy" @click="refresh">刷新状态 ↻</button></template>
          </AdminPageHeader>
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

        <ConversationTraceAdmin v-else-if="view === 'conversations'" :token="session.token" :can-debug="can('conversations.debug')" />
        <ModelServiceAdmin v-else-if="view === 'model-services'" :token="session.token" :can-manage="can('model_profiles.manage')" @notice="notice = $event" @error="error = $event" />
        <EmbeddingServiceAdmin v-else-if="view === 'embedding-services'" :token="session.token" :can-manage="can('embedding_profiles.manage')" :can-read-knowledge="can('documents.read')" @notice="notice = $event" @error="error = $event" />

        <section v-else-if="view === 'admins'">
          <AdminPageHeader title="管理员">
            <template #actions><button type="button" class="admin-text-button" :disabled="busy" @click="refresh">刷新 ↻</button></template>
          </AdminPageHeader>
          <div class="admin-section-head"><div><h2>账号列表</h2><span>{{ admins.length }} 位管理员 · 点击查看授权详情</span></div><button class="admin-primary" type="button" @click="adminDialog = 'createAdmin'">新建管理员</button></div>
          <div class="admin-management-layout">
            <div class="admin-list admin-management-list"><button v-for="item in admins" :key="item.id" type="button" class="admin-person-row" :class="{ selected: selectedAdminId === item.id }" @click="selectAdmin(item)"><div><strong>{{ item.displayName }}</strong><small>{{ item.email }}</small></div><span class="admin-status" :class="item.disabledAt ? 'archived' : 'ready'">{{ item.disabledAt ? '已停用' : '启用中' }}</span><small class="admin-row-meta">{{ item.roles.map((role) => role.code).join('、') || '未分配角色' }}</small></button></div>
            <aside v-if="selectedAdmin" class="admin-detail-panel"><div class="admin-detail-title"><div><p class="section-label">管理员详情 · #{{ selectedAdmin.id }}</p><h2>{{ selectedAdmin.displayName }}</h2><p>{{ selectedAdmin.email }}</p></div><span class="admin-status" :class="selectedAdmin.disabledAt ? 'archived' : 'ready'">{{ selectedAdmin.disabledAt ? '已停用' : '启用中' }}</span></div><dl class="admin-detail-grid"><dt>账号状态</dt><dd>{{ selectedAdmin.disabledAt ? '已停用' : '可登录' }}</dd><dt>当前角色</dt><dd>{{ selectedAdmin.roles.map((role) => roles.find((item) => item.id === role.id)?.name ?? role.code).join('、') || '未分配角色' }}</dd><dt>可分配角色</dt><dd>{{ assignableRoles.length }} 个</dd></dl><div class="admin-actions"><button v-if="selectedAdmin.roles.every((role) => assignableRoles.some((candidate) => candidate.id === role.id))" type="button" @click="editingRoleIds = selectedAdmin.roles.map((role) => role.id); adminDialog = 'assignRoles'">调整角色</button><button v-if="selectedAdmin.id !== session.me.id" type="button" :disabled="busy" @click="toggleAdmin(selectedAdmin)">{{ selectedAdmin.disabledAt ? '启用账号' : '停用账号' }}</button></div></aside>
          </div>
        </section>

        <section v-else-if="view === 'roles'">
          <AdminPageHeader title="角色权限">
            <template #actions><button type="button" class="admin-text-button" :disabled="busy" @click="refresh">刷新 ↻</button></template>
          </AdminPageHeader>
          <div class="admin-section-head"><div><h2>现有角色</h2><span>{{ roles.length }} 个角色 · 点击查看权限范围</span></div><button class="admin-primary" type="button" @click="editRole()">新建角色</button></div>
          <div class="admin-management-layout">
            <div class="admin-list admin-management-list"><button v-for="item in roles" :key="item.id" type="button" class="admin-role-row" :class="{ selected: selectedRoleId === item.id }" @click="selectRole(item)"><div><strong>{{ item.name }} <small v-if="item.isSystem">系统角色</small></strong><small>{{ item.code }}</small></div><span class="admin-status ready">{{ item.permissionCodes.length }} 项权限</span></button></div>
            <aside v-if="selectedRole" class="admin-detail-panel"><div class="admin-detail-title"><div><p class="section-label">角色详情 · #{{ selectedRole.id }}</p><h2>{{ selectedRole.name }}</h2><p>{{ selectedRole.code }}</p></div><span class="admin-status" :class="selectedRole.isSystem ? 'archived' : 'ready'">{{ selectedRole.isSystem ? '系统角色' : '自定义角色' }}</span></div><div class="permission-summary"><span v-for="code in selectedRole.permissionCodes" :key="code">{{ code }}</span><p v-if="!selectedRole.permissionCodes.length" class="admin-muted">这个角色暂未分配权限。</p></div><div class="admin-actions"><button v-if="!selectedRole.isSystem && selectedRole.permissionCodes.every(can)" type="button" @click="editRole(selectedRole)">编辑权限</button></div></aside>
          </div>
        </section>

        <section v-else-if="view === 'audit'">
          <AdminPageHeader title="操作记录">
            <template #actions><button type="button" class="admin-text-button" :disabled="busy" @click="refresh">刷新 ↻</button></template>
          </AdminPageHeader>
          <div class="admin-audit-table"><table><thead><tr><th>时间</th><th>操作</th><th>对象</th><th>操作者</th><th>变更详情</th></tr></thead><tbody><tr v-for="item in audits" :key="item.id"><td><time>{{ formatDate(item.createdAt) }}</time></td><td><strong :title="item.action">{{ auditActionLabel(item.action) }}</strong></td><td>{{ auditTargetLabel(item.targetType) }} <span class="admin-mono">#{{ item.targetId }}</span></td><td>管理员 #{{ item.actorAdminId }}</td><td><details v-if="Object.keys(item.details).length" class="admin-audit-details"><summary>查看</summary><pre>{{ JSON.stringify(item.details, null, 2) }}</pre></details><span v-else class="admin-muted">—</span></td></tr></tbody></table><p v-if="!audits.length && !busy" class="admin-muted">暂无操作记录。</p></div>
        </section>

        <UiDialog :open="adminDialog === 'createAdmin'" title="新建管理员" description="创建后台账号并分配可由你管理的角色。" @update:open="adminDialog = $event ? adminDialog : null">
          <form class="admin-dialog-form" @submit.prevent="createAdmin">
            <div class="admin-form-grid"><label>显示名称<input v-model.trim="newAdmin.displayName" required maxlength="120" /></label><label>邮箱<input v-model.trim="newAdmin.email" type="email" required /></label><label>初始密码<input v-model="newAdmin.password" type="password" minlength="12" maxlength="72" autocomplete="new-password" required /><small>至少 12 个字符。</small></label></div>
            <fieldset><legend>分配角色</legend><label v-for="role in assignableRoles" :key="role.id" class="admin-check"><input v-model="newAdmin.roleIds" type="checkbox" :value="role.id" />{{ role.name }} <small>{{ role.code }}</small></label><p v-if="!assignableRoles.length" class="admin-muted">当前账号没有可分配的角色。</p></fieldset>
            <footer><button type="button" @click="adminDialog = null">取消</button><button class="admin-primary" type="submit" :disabled="busy || !assignableRoles.length">{{ busy ? '创建中…' : '创建账号' }}</button></footer>
          </form>
        </UiDialog>
        <UiDialog :open="adminDialog === 'assignRoles'" :title="`调整 ${selectedAdmin?.displayName || '管理员'} 的角色`" description="变更保存后立即影响该管理员可访问的后台功能。" @update:open="adminDialog = $event ? adminDialog : null">
          <form class="admin-dialog-form" @submit.prevent="selectedAdmin && saveAdminRoles(selectedAdmin.id)"><fieldset><legend>角色</legend><label v-for="role in assignableRoles" :key="role.id" class="admin-check"><input v-model="editingRoleIds" type="checkbox" :value="role.id" />{{ role.name }} <small>{{ role.code }}</small></label></fieldset><footer><button type="button" @click="adminDialog = null">取消</button><button class="admin-primary" type="submit" :disabled="busy">保存角色</button></footer></form>
        </UiDialog>
        <UiDialog :open="adminDialog === 'role'" :title="roleForm.id === null ? '新建角色' : '编辑角色权限'" description="权限代码由系统定义；这里只组合权限，不创建新的权限代码。" size="lg" @update:open="adminDialog = $event ? adminDialog : null">
          <form class="admin-dialog-form" @submit.prevent="saveRole"><div class="admin-form-grid role-fields"><label>角色代码<input v-model.trim="roleForm.code" :disabled="roleForm.id !== null" pattern="[a-z][a-z0-9_]{2,79}" required placeholder="knowledge_editor" /></label><label>角色名称<input v-model.trim="roleForm.name" required maxlength="120" /></label></div><div class="permission-groups"><fieldset v-for="group in permissionGroups" :key="group.label"><legend>{{ group.label }}</legend><label v-for="permission in group.items" :key="permission.code" class="admin-check"><input v-model="roleForm.permissionCodes" type="checkbox" :value="permission.code" :disabled="!can(permission.code)" /><span>{{ permission.description }}<small>{{ permission.code }}</small></span></label></fieldset></div><footer><button type="button" @click="adminDialog = null">取消</button><button class="admin-primary" type="submit" :disabled="busy">{{ busy ? '保存中…' : '保存角色' }}</button></footer></form>
        </UiDialog>
        <UiDialog :open="confirmDialog !== null" :title="confirmDialog?.title || '确认操作'" :description="confirmDialog?.description" size="sm" @update:open="confirmDialog = $event ? confirmDialog : null"><div class="admin-confirm-actions"><button type="button" @click="confirmDialog = null">取消</button><button class="danger" type="button" :disabled="busy" @click="runConfirmation">{{ busy ? '处理中…' : confirmDialog?.confirmLabel }}</button></div></UiDialog>
      </div>
    </main>
  </div>
</template>
