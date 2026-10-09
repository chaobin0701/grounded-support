<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Bot, Boxes, Cpu, Database, LayoutDashboard, MessageSquareText, ShieldCheck, Users, Plug, Plus, RefreshCw, Search, Pencil, UserRound, Ban, Check } from '@lucide/vue';
import type { Component } from 'vue';
import { adminApi, AdminApiError, type AdminItem, type AdminMe, type AuditItem, type DocumentChunk, type DocumentDetail, type DocumentItem, type PermissionItem, type RoleItem } from './admin-api';
import { clearAdminSession, loadAdminSession, loadAdminView, saveAdminSession, saveAdminView } from './admin-session';
import { groupAdminNavigation } from './admin-navigation';
import { filterAdmins, filterRoles, groupPermissions } from './access-management';
import type { ChoiceOption } from './ui/choice-list';
import './admin.css';
import './access-management.css';
import KnowledgeBaseAdmin from './KnowledgeBaseAdmin.vue';
import AdminDashboard from './AdminDashboard.vue';
import ProductCatalogAdmin from './ProductCatalogAdmin.vue';
import ConversationTraceAdmin from './ConversationTraceAdmin.vue';
import AdminPageHeader from './ui/AdminPageHeader.vue';
import UiDialog from './ui/UiDialog.vue';
import UiChoiceList from './ui/UiChoiceList.vue';
import UiMasterDetail from './ui/UiMasterDetail.vue';
import UiStatusBadge from './ui/UiStatusBadge.vue';
import ToastNotice from './ui/ToastNotice.vue';
import ModelServiceAdmin from './ModelServiceAdmin.vue';
import EmbeddingServiceAdmin from './EmbeddingServiceAdmin.vue';
import AgentConfigAdmin from './AgentConfigAdmin.vue';
import IntegrationAdmin from './IntegrationAdmin.vue';
import BrandMark from './ui/BrandMark.vue';
import { pageTitle, siteBrand } from './brand';

type View = 'dashboard' | 'knowledge' | 'products' | 'documents' | 'conversations' | 'agent-config' | 'model-services' | 'embedding-services' | 'integrations' | 'admins' | 'roles' | 'audit';
const route = useRoute();
const router = useRouter();
const session = ref<{ token: string; me: AdminMe } | null>(null);
const email = ref('demo-user');
const password = ref('demo123456');
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
const adminQuery = ref('');
const adminStatus = ref('all');
const roleQuery = ref('');
const roleKind = ref('all');
const permissionQuery = ref('');
const audits = ref<AuditItem[]>([]);
const newAdmin = ref({ email: '', displayName: '', password: '', roleIds: [] as number[] });
const editingRoleIds = ref<number[]>([]);
const roleForm = ref({ id: null as number | null, code: '', name: '', permissionCodes: [] as string[] });
const selectedAdmin = computed(() => admins.value.find((item) => item.id === selectedAdminId.value) ?? null);
const selectedRole = computed(() => roles.value.find((item) => item.id === selectedRoleId.value) ?? null);
const filteredAdmins = computed(() => filterAdmins(admins.value, adminQuery.value, adminStatus.value));
const filteredRoles = computed(() => filterRoles(roles.value, roleQuery.value, roleKind.value));
const permissionGroups = computed(() => {
  const keyword = permissionQuery.value.trim().toLocaleLowerCase();
  return groupPermissions(permissions.value.filter(item => `${item.description} ${item.code}`.toLocaleLowerCase().includes(keyword)));
});
const selectedPermissionGroups = computed(() => groupPermissions((selectedRole.value?.permissionCodes ?? []).map(code =>
  permissions.value.find(item => item.code === code) ?? { code, description: code },
)));
const selectedAdminRoles = computed(() => (selectedAdmin.value?.roles ?? []).map(role => roles.value.find(item => item.id === role.id))
  .filter((role): role is RoleItem => !!role));
const selectedAdminPermissionCount = computed(() => new Set(selectedAdminRoles.value.flatMap(role => role.permissionCodes)).size);

const views: { id: View; label: string; permissions: string[]; icon: Component }[] = [
  { id: 'dashboard', label: '概览', icon: LayoutDashboard, permissions: ['documents.read', 'knowledge_bases.manage', 'conversations.read'] },
  { id: 'knowledge', label: '知识库', icon: Database, permissions: ['documents.read', 'knowledge_bases.manage'] },
  { id: 'products', label: '产品管理', icon: Boxes, permissions: ['knowledge_bases.manage'] },
  { id: 'conversations', label: '会话管理', icon: MessageSquareText, permissions: ['conversations.read'] },
  { id: 'agent-config', label: 'Agent 配置', icon: Bot, permissions: ['agent_config.read', 'agent_config.manage'] },
  { id: 'model-services', label: '模型服务', icon: Cpu, permissions: ['model_profiles.read', 'model_profiles.manage'] },
  { id: 'embedding-services', label: '向量服务', icon: Database, permissions: ['embedding_profiles.read', 'embedding_profiles.manage'] },
  { id: 'integrations', label: '接入管理', icon: Plug, permissions: ['integrations.read', 'integrations.manage'] },
  { id: 'admins', label: '管理员', icon: Users, permissions: ['admins.manage'] },
  { id: 'roles', label: '角色权限', icon: ShieldCheck, permissions: ['roles.manage'] },
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
const roleOptions = computed<ChoiceOption<number>[]>(() => assignableRoles.value.map(role => ({ value: role.id, label: role.name, detail: `${role.code} · ${role.permissionCodes.length} 项权限` })));
const canAdjustSelectedAdmin = computed(() => !!selectedAdmin.value && selectedAdmin.value.roles.every(role => assignableRoles.value.some(candidate => candidate.id === role.id)));
const canEditSelectedRole = computed(() => !!selectedRole.value && !selectedRole.value.isSystem && selectedRole.value.permissionCodes.every(can));

watch(filteredAdmins, items => {
  if (!items.some(item => item.id === selectedAdminId.value)) selectedAdminId.value = items[0]?.id ?? null;
});
watch(filteredRoles, items => {
  if (!items.some(item => item.id === selectedRoleId.value)) selectedRoleId.value = items[0]?.id ?? null;
});

function permissionOptions(items: PermissionItem[]): ChoiceOption<string>[] {
  return items.map(item => ({ value: item.code, label: item.description, detail: item.code, disabled: !can(item.code) }));
}
function roleName(id: number, fallback: string): string {
  return roles.value.find(item => item.id === id)?.name ?? fallback;
}
function closeAdminDialog() {
  if (busy.value) return;
  adminDialog.value = null;
  error.value = '';
  newAdmin.value.password = '';
}
function openCreateAdmin() {
  error.value = '';
  newAdmin.value = { email: '', displayName: '', password: '', roleIds: [] };
  adminDialog.value = 'createAdmin';
}
function openAssignRoles() {
  if (!selectedAdmin.value || !canAdjustSelectedAdmin.value) return;
  error.value = '';
  editingRoleIds.value = selectedAdmin.value.roles.map(role => role.id);
  adminDialog.value = 'assignRoles';
}

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
    loginError.value = cause instanceof AdminApiError && cause.status === 401 ? '邮箱、账号或密码不正确。' : describeError(cause);
  } finally {
    loginBusy.value = false;
  }
}

function signOut() {
  session.value = null;
  clearAdminSession();
  email.value = 'demo-user';
  password.value = 'demo123456';
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
  document.title = pageTitle(route.path);
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
  const input = { ...newAdmin.value, roleIds: [...newAdmin.value.roleIds] };
  await action((token) => adminApi.createAdmin(token, input), '管理员已创建。', async () => {
    newAdmin.value = { email: '', displayName: '', password: '', roleIds: [] };
    adminDialog.value = null;
    if (session.value) admins.value = await adminApi.admins(session.value.token);
  });
}

async function saveAdminRoles(id: number) {
  if (!editingRoleIds.value.length) { error.value = '请至少选择一个角色。'; return; }
  await action((token) => adminApi.assignRoles(token, id, editingRoleIds.value), '角色分配已更新。', async () => {
    adminDialog.value = null;
    if (session.value) admins.value = await adminApi.admins(session.value.token);
    await refreshIdentity();
  });
}

async function toggleAdmin(item: AdminItem) {
  const disable = !item.disabledAt;
  confirmDialog.value = { title: `${disable ? '停用' : '启用'}管理员`, description: `确定${disable ? '停用' : '启用'}「${item.displayName}」(${item.username || item.email})？`, confirmLabel: disable ? '确认停用' : '确认启用', run: async () => {
    await action((token) => adminApi.setStatus(token, item.id, disable), disable ? '管理员已停用。' : '管理员已启用。', async () => {
      if (session.value) admins.value = await adminApi.admins(session.value.token);
    });
  } };
}

function editRole(item?: RoleItem) {
  if (item && (item.isSystem || !item.permissionCodes.every(can))) return;
  error.value = '';
  permissionQuery.value = '';
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
    'integration.created': '创建接入应用', 'integration.updated': '更新接入授权',
    'integration.key_created': '创建接入密钥', 'integration.key_rotated': '轮换接入密钥', 'integration.key_revoked': '撤销接入密钥',
    'agent_config.updated': '更新 Agent 配置',
    'llm_profile.created': '添加模型配置', 'llm_profile.updated': '更新模型配置',
    'llm_profile.activated': '切换当前模型', 'llm_profile.deleted': '删除模型配置',
  };
  return labels[action] ?? action;
}

function auditTargetLabel(targetType: string): string {
  return ({ admin: '管理员', role: '角色', document: '资料', knowledge_base: '知识库', knowledge_index: '知识索引', embedding_profile: 'Embedding 配置', llm_profile: '模型配置', debug_inspection: '调试检查', integration: '接入应用' } as Record<string, string>)[targetType] ?? targetType;
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
    <div class="admin-login-brand"><BrandMark /><span>{{ siteBrand.name }} <small>管理中心</small></span></div>
    <main class="admin-login-main">
      <p class="section-label">{{ siteBrand.name }} · 管理中心</p>
      <h1>欢迎回来</h1>
      <form @submit.prevent="signIn">
        <label>邮箱或账号<input v-model.trim="email" type="text" autocomplete="username" required maxlength="320" placeholder="邮箱或账号" /></label>
        <label>密码<input v-model="password" type="password" autocomplete="current-password" required placeholder="输入管理员密码" /></label>
        <p v-if="loginError" class="admin-error" role="alert">{{ loginError }}</p>
        <button class="admin-primary" type="submit" :disabled="loginBusy">{{ loginBusy ? '正在登录…' : '登录后台' }}</button>
      </form>
    </main>
  </div>

  <div v-else class="admin-shell">
    <header class="admin-global-header">
      <div class="admin-brand"><BrandMark /><span>{{ siteBrand.name }}</span></div>
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
      <div class="admin-sidebar-bottom"><button type="button" @click="signOut">退出登录</button></div>
    </aside>

    <main class="admin-main">
      <div class="admin-content" :class="{ 'admin-conversation-content': view === 'conversations' }">
        <ToastNotice :message="adminDialog ? '' : (error || notice)" :type="error ? 'error' : 'success'" @dismiss="error ? (error = '') : (notice = '')" />

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
        <IntegrationAdmin v-else-if="view === 'integrations'" :token="session.token" :can-manage="can('integrations.manage')" @notice="notice = $event" @error="error = $event" />

        <section v-else-if="view === 'admins'" class="access-management">
          <AdminPageHeader title="管理员">
            <template #actions>
              <button type="button" class="ui-button" :disabled="busy" @click="refresh"><RefreshCw :size="15" aria-hidden="true" />刷新</button>
              <button type="button" class="ui-button ui-button-primary" :disabled="busy" @click="openCreateAdmin"><Plus :size="16" aria-hidden="true" />新建管理员</button>
            </template>
          </AdminPageHeader>
          <div class="access-toolbar">
            <label class="access-search"><Search :size="16" aria-hidden="true" /><input v-model="adminQuery" class="ui-input" type="search" placeholder="搜索名称、账号、邮箱或角色代码" aria-label="搜索管理员" /></label>
            <select v-model="adminStatus" class="ui-input access-filter" aria-label="管理员状态"><option value="all">全部状态</option><option value="enabled">正常</option><option value="disabled">已停用</option></select>
          </div>
          <UiMasterDetail list-label="账号列表" :count="`${filteredAdmins.length} / ${admins.length} 位`" :busy="busy" :empty="!filteredAdmins.length" :empty-text="admins.length ? '没有匹配的管理员' : '暂无管理员'" detail-label="管理员详情">
            <template #list>
              <button v-for="item in filteredAdmins" :key="item.id" type="button" class="management-item access-record" :class="{ selected: selectedAdminId === item.id }" :aria-pressed="selectedAdminId === item.id" :disabled="busy" @click="selectAdmin(item)">
                <span class="access-avatar" aria-hidden="true">{{ item.displayName.slice(0, 1) }}</span>
                <span class="access-record-copy"><strong>{{ item.displayName }}<small v-if="item.id === session.me.id" class="access-self">当前账号</small></strong><span>{{ item.username || item.email }}</span><small>{{ item.roles.map(role => roleName(role.id, role.code)).join(' · ') || '未分配角色' }}</small></span>
                <UiStatusBadge :tone="item.disabledAt ? 'neutral' : 'success'">{{ item.disabledAt ? '已停用' : '正常' }}</UiStatusBadge>
              </button>
            </template>
            <template #detail>
              <template v-if="selectedAdmin">
                <div class="access-detail-heading"><div><p>账号详情 · #{{ selectedAdmin.id }}</p><h2>{{ selectedAdmin.displayName }}</h2></div><UiStatusBadge :tone="selectedAdmin.disabledAt ? 'neutral' : 'success'">{{ selectedAdmin.disabledAt ? '已停用' : '正常' }}</UiStatusBadge></div>
                <dl class="access-facts"><dt>账号</dt><dd>{{ selectedAdmin.username || '—' }}</dd><dt>邮箱</dt><dd>{{ selectedAdmin.email || '—' }}</dd><dt>角色</dt><dd>{{ selectedAdmin.roles.length }} 个</dd><dt>权限范围</dt><dd>{{ selectedAdminPermissionCount }} 项权限</dd><template v-if="selectedAdmin.disabledAt"><dt>停用时间</dt><dd>{{ formatDate(selectedAdmin.disabledAt) }}</dd></template></dl>
                <div class="access-detail-actions">
                  <button v-if="canAdjustSelectedAdmin" type="button" class="ui-button" :disabled="busy" @click="openAssignRoles"><Pencil :size="14" aria-hidden="true" />调整角色</button>
                  <button v-if="selectedAdmin.id !== session.me.id" type="button" class="ui-button" :class="{ 'access-danger': !selectedAdmin.disabledAt }" :disabled="busy" @click="toggleAdmin(selectedAdmin)"><component :is="selectedAdmin.disabledAt ? Check : Ban" :size="14" aria-hidden="true" />{{ selectedAdmin.disabledAt ? '启用账号' : '停用账号' }}</button>
                </div>
                <UiChoiceList title="已分配角色" :options="selectedAdmin.roles.map(role => ({ value: role.id, label: roleName(role.id, role.code), detail: role.code }))" :model-value="selectedAdmin.roles.map(role => role.id)" readonly />
              </template>
              <div v-else class="access-detail-empty"><UserRound :size="24" aria-hidden="true" /><p>选择管理员查看详情</p></div>
            </template>
          </UiMasterDetail>
        </section>

        <section v-else-if="view === 'roles'" class="access-management">
          <AdminPageHeader title="角色权限">
            <template #actions>
              <button type="button" class="ui-button" :disabled="busy" @click="refresh"><RefreshCw :size="15" aria-hidden="true" />刷新</button>
              <button type="button" class="ui-button ui-button-primary" :disabled="busy" @click="editRole()"><Plus :size="16" aria-hidden="true" />新建角色</button>
            </template>
          </AdminPageHeader>
          <div class="access-toolbar">
            <label class="access-search"><Search :size="16" aria-hidden="true" /><input v-model="roleQuery" class="ui-input" type="search" placeholder="搜索角色名称或代码" aria-label="搜索角色" /></label>
            <select v-model="roleKind" class="ui-input access-filter" aria-label="角色类型"><option value="all">全部类型</option><option value="system">系统角色</option><option value="custom">自定义角色</option></select>
          </div>
          <UiMasterDetail list-label="角色列表" :count="`${filteredRoles.length} / ${roles.length} 个`" :busy="busy" :empty="!filteredRoles.length" :empty-text="roles.length ? '没有匹配的角色' : '暂无角色'" detail-label="角色详情">
            <template #list>
              <button v-for="item in filteredRoles" :key="item.id" type="button" class="management-item access-record" :class="{ selected: selectedRoleId === item.id }" :aria-pressed="selectedRoleId === item.id" :disabled="busy" @click="selectRole(item)">
                <span class="access-avatar" aria-hidden="true"><ShieldCheck :size="17" /></span>
                <span class="access-record-copy"><strong>{{ item.name }}</strong><span>{{ item.code }}</span><small>{{ item.permissionCodes.length }} 项权限</small></span>
                <UiStatusBadge>{{ item.isSystem ? '系统角色' : '自定义' }}</UiStatusBadge>
              </button>
            </template>
            <template #detail>
              <template v-if="selectedRole">
                <div class="access-detail-heading"><div><p>角色详情 · #{{ selectedRole.id }}</p><h2>{{ selectedRole.name }}</h2></div><UiStatusBadge>{{ selectedRole.isSystem ? '系统角色 · 只读' : '自定义角色' }}</UiStatusBadge></div>
                <dl class="access-facts"><dt>角色代码</dt><dd class="access-code">{{ selectedRole.code }}</dd><dt>权限范围</dt><dd>{{ selectedRole.permissionCodes.length }} 项 · {{ selectedPermissionGroups.length }} 个功能分组</dd></dl>
                <div v-if="canEditSelectedRole" class="access-detail-actions"><button type="button" class="ui-button" :disabled="busy" @click="editRole(selectedRole)"><Pencil :size="14" aria-hidden="true" />编辑权限</button></div>
                <div class="access-permission-list"><UiChoiceList v-for="group in selectedPermissionGroups" :key="group.key" :title="group.label" :options="permissionOptions(group.items)" :model-value="selectedRole.permissionCodes" readonly /></div>
                <p v-if="!selectedPermissionGroups.length" class="access-empty-text">暂未分配权限</p>
              </template>
              <div v-else class="access-detail-empty"><ShieldCheck :size="24" aria-hidden="true" /><p>选择角色查看权限</p></div>
            </template>
          </UiMasterDetail>
        </section>

        <section v-else-if="view === 'audit'">
          <AdminPageHeader title="操作记录">
            <template #actions><button type="button" class="admin-text-button" :disabled="busy" @click="refresh">刷新 ↻</button></template>
          </AdminPageHeader>
          <div class="admin-audit-table"><table><thead><tr><th>时间</th><th>操作</th><th>对象</th><th>操作者</th><th>变更详情</th></tr></thead><tbody><tr v-for="item in audits" :key="item.id"><td><time>{{ formatDate(item.createdAt) }}</time></td><td><strong :title="item.action">{{ auditActionLabel(item.action) }}</strong></td><td>{{ auditTargetLabel(item.targetType) }} <span class="admin-mono">#{{ item.targetId }}</span></td><td>管理员 #{{ item.actorAdminId }}</td><td><details v-if="Object.keys(item.details).length" class="admin-audit-details"><summary>查看</summary><pre>{{ JSON.stringify(item.details, null, 2) }}</pre></details><span v-else class="admin-muted">—</span></td></tr></tbody></table><p v-if="!audits.length && !busy" class="admin-muted">暂无操作记录。</p></div>
        </section>

        <UiDialog :open="adminDialog === 'createAdmin'" title="新建管理员" @update:open="!$event && closeAdminDialog()">
          <form class="access-dialog-form" :aria-busy="busy" @submit.prevent="createAdmin">
            <div class="access-form-grid"><label class="access-field">显示名称<input v-model.trim="newAdmin.displayName" class="ui-input" required maxlength="120" :disabled="busy" placeholder="管理员姓名" autocomplete="off" /></label><label class="access-field">邮箱或账号<input v-model.trim="newAdmin.email" class="ui-input" type="text" required maxlength="320" :disabled="busy" placeholder="name@example.com 或 demo-user" autocomplete="off" /><small>账号为 3–64 位字母、数字、点、下划线或短横线，首位为字母或数字。</small></label></div>
            <label class="access-field">初始密码<input v-model="newAdmin.password" class="ui-input" type="password" minlength="10" maxlength="72" autocomplete="new-password" required :disabled="busy" placeholder="10–72 个字符" /></label>
            <UiChoiceList v-model="newAdmin.roleIds" title="分配角色" :options="roleOptions" :disabled="busy" :bulk="false" />
            <p v-if="!assignableRoles.length" class="access-empty-text">当前账号没有可分配的角色。</p>
            <p v-if="error" class="access-form-error" role="alert">{{ error }}</p>
            <footer class="access-dialog-actions"><button type="button" class="ui-button" :disabled="busy" @click="closeAdminDialog">取消</button><button class="ui-button ui-button-primary" type="submit" :disabled="busy || !assignableRoles.length">{{ busy ? '创建中…' : '创建账号' }}</button></footer>
          </form>
        </UiDialog>
        <UiDialog :open="adminDialog === 'assignRoles'" title="调整角色" @update:open="!$event && closeAdminDialog()">
          <form class="access-dialog-form" :aria-busy="busy" @submit.prevent="selectedAdmin && saveAdminRoles(selectedAdmin.id)">
            <div class="access-dialog-account"><strong>{{ selectedAdmin?.displayName }}</strong><span>{{ selectedAdmin?.username || selectedAdmin?.email }}</span></div>
            <UiChoiceList v-model="editingRoleIds" title="分配角色" :options="roleOptions" :disabled="busy" :bulk="false" />
            <p v-if="error" class="access-form-error" role="alert">{{ error }}</p>
            <footer class="access-dialog-actions"><button type="button" class="ui-button" :disabled="busy" @click="closeAdminDialog">取消</button><button class="ui-button ui-button-primary" type="submit" :disabled="busy">{{ busy ? '保存中…' : '保存角色' }}</button></footer>
          </form>
        </UiDialog>
        <UiDialog :open="adminDialog === 'role'" :title="roleForm.id === null ? '新建角色' : '编辑角色权限'" size="lg" @update:open="!$event && closeAdminDialog()">
          <form class="access-dialog-form" :aria-busy="busy" @submit.prevent="saveRole">
            <div class="access-form-grid"><label class="access-field">角色名称<input v-model.trim="roleForm.name" class="ui-input" required maxlength="120" :disabled="busy" placeholder="例如：知识库编辑员" /></label><label class="access-field">角色代码<input v-model.trim="roleForm.code" class="ui-input" :disabled="busy || roleForm.id !== null" pattern="[a-z][a-z0-9_]{2,79}" required placeholder="knowledge_editor" /><small>{{ roleForm.id === null ? '3–80 位小写字母、数字或下划线，以字母开头。' : '角色代码创建后不可修改。' }}</small></label></div>
            <div class="access-permission-toolbar"><h3>功能权限 <span>{{ roleForm.permissionCodes.length }} 项已选</span></h3><label class="access-search"><Search :size="15" aria-hidden="true" /><input v-model="permissionQuery" type="search" class="ui-input" placeholder="搜索权限名称或代码" aria-label="搜索权限" :disabled="busy" /></label></div>
            <div class="access-permission-grid"><UiChoiceList v-for="group in permissionGroups" :key="group.key" v-model="roleForm.permissionCodes" :title="group.label" :options="permissionOptions(group.items)" :disabled="busy" /></div>
            <p v-if="!permissionGroups.length" class="access-empty-text">没有匹配的权限</p>
            <p v-if="error" class="access-form-error" role="alert">{{ error }}</p>
            <footer class="access-dialog-actions"><button type="button" class="ui-button" :disabled="busy" @click="closeAdminDialog">取消</button><button class="ui-button ui-button-primary" type="submit" :disabled="busy">{{ busy ? '保存中…' : '保存角色' }}</button></footer>
          </form>
        </UiDialog>
        <UiDialog :open="confirmDialog !== null" :title="confirmDialog?.title || '确认操作'" :description="confirmDialog?.description" size="sm" @update:open="confirmDialog = $event ? confirmDialog : null"><div class="admin-confirm-actions"><button type="button" @click="confirmDialog = null">取消</button><button class="danger" type="button" :disabled="busy" @click="runConfirmation">{{ busy ? '处理中…' : confirmDialog?.confirmLabel }}</button></div></UiDialog>
      </div>
    </main>
  </div>
</template>
