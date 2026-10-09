<script setup lang="ts">
import { Database, FileText, Plus, Search, Settings2, Upload } from '@lucide/vue';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { request, type DocumentItem } from './admin-api';
import { filterKnowledgeBases, filterKnowledgeDocuments, type KnowledgeBaseStatusFilter, type DocumentStatusFilter } from './knowledge-list-filters';
import AdminPageHeader from './ui/AdminPageHeader.vue';
import UiDialog from './ui/UiDialog.vue';
import ToastNotice from './ui/ToastNotice.vue';
type View = 'documents' | 'settings' | 'recall-test';
type Config = { indexMode: 'economy' | 'high_quality'; retrievalMode: 'fulltext' | 'vector' | 'hybrid';
  chunkMode: 'general' | 'parent_child'; chunkChars: number; overlapChars: number; parentChars: number;
  childChars: number; childOverlapChars: number; embeddingProfileId: number | null; topK: number; lexicalThreshold: number; vectorThreshold: number };
type ProcessingConfig = { chunkMode: 'general' | 'parent_child'; separatorMode: 'auto' | 'heading_paragraph' | 'fixed'; preserveHeading: boolean; chunkChars: number; overlapChars: number };
type Base = { id: number; name: string; description: string; isDefault: boolean; enabledForChat: boolean;
  archivedAt: string | null; createdAt: string; updatedAt: string; documentCount: number; readyDocumentCount?: number;
  draftConfig: Partial<Config>; activeIndexVersionId: number | null };
type Profile = { id: number; name: string; enabled: boolean; config: { model: string; dimensions: number; provider: string } };
type IndexVersion = { id: number; status: 'building' | 'ready' | 'failed'; config: Config; chunkCount: number; errorMessage: string | null; createdAt: string };
type Chunk = { id: number; ordinal: number; headingPath: string; content: string; sourceStartLine: number; sourceEndLine: number };
type Hit = { chunkId: number; documentId: number; documentTitle: string; originalFilename: string; headingPath: string; content: string; score: number; matchType?: string };
type RecallResult = { hits: Hit[]; lexicalResults?: Hit[]; vectorResults?: Hit[]; retrievalMode?: string; vectorIndexedChunks?: number; durationMs?: number; embeddingCalls?: number; versionIds?: number[] };

const props = defineProps<{ token: string; permissions: string[] }>();
const route = useRoute();
const router = useRouter();
const can = (permission: string) => props.permissions.includes(permission);
const canManage = computed(() => can('knowledge_bases.manage'));
const defaults: Config = { indexMode: 'economy', retrievalMode: 'fulltext', chunkMode: 'general', chunkChars: 800,
  overlapChars: 60, parentChars: 2400, childChars: 500, childOverlapChars: 50, embeddingProfileId: null, topK: 5, lexicalThreshold: 0.15, vectorThreshold: 0.65 };
const bases = ref<Base[]>([]);
const documents = ref<DocumentItem[]>([]);
const profiles = ref<Profile[]>([]);
const versions = ref<IndexVersion[]>([]);
const settingsDirty = computed(() => (Object.keys(defaults) as (keyof Config)[])
  .some(key => config.value[key] !== (current.value?.draftConfig[key] ?? defaults[key])));
const buildingIndex = computed(() => versions.value.some(v => v.status === 'building'));
const activeVersion = computed(() => versions.value.find(v => v.id === current.value?.activeIndexVersionId));
const newestVersion = computed(() => versions.value[0]);
const canReadEmbedding = computed(() => can('embedding_profiles.read') || can('embedding_profiles.manage'));
const selectedId = ref<number | null>(null);
const current = computed(() => bases.value.find((base) => base.id === selectedId.value));
const config = ref<Config>({ ...defaults });
const view = ref<View>('documents');
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const dialog = ref<'create' | 'edit' | 'upload' | null>(null);
const uploadStep = ref<'select' | 'processing'>('select');
const uploadedIds = ref<number[]>([]);
const uploadProgress = ref({ done: 0, total: 0 });
const createStep = ref<1 | 2>(1);
const createConfig = ref<Config>({ ...defaults });
const processingConfig = ref<ProcessingConfig>({ chunkMode: 'general', separatorMode: 'auto', preserveHeading: true, chunkChars: 800, overlapChars: 60 });
const previewDialog = ref(false);
const previewTitle = ref('');
const previewChunks = ref<Chunk[]>([]);
const documentDetail = ref<DocumentItem | null>(null);
const documentDetailChunks = ref<Chunk[]>([]);
const reprocessIds = ref<number[]>([]);
const customChunks = ref(false);
const reprocessConfig = ref<ProcessingConfig>({ chunkMode: 'general', separatorMode: 'auto', preserveHeading: true, chunkChars: 800, overlapChars: 60 });
const openActionId = ref<number | null>(null);
const pendingAction = ref<{ title: string; description: string; run: () => Promise<void> } | null>(null);
const name = ref('');
const description = ref('');
const files = ref<File[]>([]);
const query = ref('');
const topK = ref(5);
const recallMode = ref<'fulltext' | 'vector' | 'hybrid'>('hybrid');
const recallTarget = ref<'active' | 'draft'>('active');
const recallResult = ref<RecallResult | null>(null);
const listQuery = ref('');
const listStatus = ref<KnowledgeBaseStatusFilter>('all');
const showArchivedBases = ref(false);
const documentQuery = ref('');
const documentStatusFilter = ref<DocumentStatusFilter>('all');
const showArchivedDocuments = ref(false);
const selectedDocuments = ref<number[]>([]);

const api = <T,>(path = '', method = 'GET', body?: unknown) => request<T>(`/knowledge-bases${path}`,
  { method, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) }, props.token);
const fileDocuments = computed(() => documents.value.filter((doc) => doc.sourceType !== 'faq'));
const activeDocuments = computed(() => fileDocuments.value.filter((doc) => !doc.archivedAt));
const readyCount = computed(() => activeDocuments.value.filter((doc) => doc.status === 'ready' && doc.enabledForRetrieval !== false).length);
const processingCount = computed(() => activeDocuments.value.filter((doc) => ['pending', 'queued', 'processing'].includes(doc.status)).length);
const failedCount = computed(() => activeDocuments.value.filter((doc) => doc.status === 'failed').length);
const visibleDocuments = computed(() => filterKnowledgeDocuments(documents.value, documentQuery.value, documentStatusFilter.value, showArchivedDocuments.value));
const allVisibleSelected = computed(() => visibleDocuments.value.filter((doc) => !doc.archivedAt).length > 0
  && visibleDocuments.value.filter((doc) => !doc.archivedAt).every((doc) => selectedDocuments.value.includes(doc.id)));
const filteredBases = computed(() => filterKnowledgeBases(bases.value, listQuery.value, listStatus.value, showArchivedBases.value));
watch(visibleDocuments, (visible) => {
  const selectableIds = new Set(visible.filter(doc => !doc.archivedAt).map(doc => doc.id));
  selectedDocuments.value = selectedDocuments.value.filter(id => selectableIds.has(id));
  if (openActionId.value !== null && !visible.some(doc => doc.id === openActionId.value)) openActionId.value = null;
});
const currentProfile = computed(() => profiles.value.find((profile) => profile.id === config.value.embeddingProfileId));
const currentRouteTab = (raw: unknown): View => raw === 'settings' || raw === 'index' || raw === 'config'
  ? 'settings' : raw === 'recall-test' || raw === 'publish' || raw === 'versions' || raw === 'search'
    ? 'recall-test' : 'documents';
const statusLabel = (doc: DocumentItem) => doc.archivedAt ? '已归档'
  : ({ pending: '待解析', queued: '排队中', processing: '处理中', ready: '可检索', failed: '处理失败', extracted: '待处理' }[doc.status] ?? doc.status);
const statusClass = (doc: DocumentItem) => doc.archivedAt ? 'archived'
  : ['queued', 'processing'].includes(doc.status) ? 'processing' : doc.status === 'ready' ? 'ready' : doc.status === 'failed' ? 'failed' : 'pending';
const fileType = (doc: DocumentItem) => doc.originalFilename.split('.').pop()?.toUpperCase() || 'FILE';
const fileTypeClass = (doc: DocumentItem) => {
  const type = fileType(doc).toLowerCase();
  if (type === 'pdf') return 'pdf';
  if (type === 'md' || type === 'markdown') return 'markdown';
  if (type === 'doc' || type === 'docx') return 'word';
  return 'generic';
};
const fmtDate = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';
const charCount = (doc: DocumentItem) => doc.characterCount?.toLocaleString('zh-CN') ?? '—';
const chunkCount = (doc: DocumentItem) => doc.chunkCount?.toLocaleString('zh-CN') ?? '—';
const retrievalName = (mode: string) => ({ fulltext: '全文检索', vector: '向量检索', hybrid: '混合检索' }[mode] ?? mode);

async function run(work: () => Promise<void>, success = '') {
  if (busy.value) return;
  busy.value = true; error.value = ''; notice.value = '';
  try { await work(); if (success) notice.value = success; }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败，请稍后重试。'; }
  finally { busy.value = false; }
}
async function loadDetails() {
  if (!selectedId.value) return;
  const base = await api<Base>(`/${selectedId.value}`);
  bases.value = bases.value.map((item) => item.id === base.id ? { ...item, ...base } : item);
  documents.value = await api<DocumentItem[]>(`/${selectedId.value}/documents?limit=100`);
  versions.value = await api<IndexVersion[]>(`/${selectedId.value}/versions`);
  config.value = { ...defaults, ...base.draftConfig };
  topK.value = config.value.topK;
  recallMode.value = config.value.retrievalMode;
  if (canManage.value) profiles.value = await api<Profile[]>('/embedding-profiles');
  selectedDocuments.value = [];
  const documentId = typeof route.params.documentId === 'string' ? Number(route.params.documentId) : null;
  if (documentId) {
    documentDetail.value = documents.value.find((doc) => doc.id === documentId) ?? await api<DocumentItem>(`/${selectedId.value}/documents/${documentId}`);
    documentDetailChunks.value = await api<Chunk[]>(`/${selectedId.value}/documents/${documentId}/chunks`);
  } else {
    documentDetail.value = null;
    documentDetailChunks.value = [];
  }
}
async function reload() {
  loading.value = true; error.value = '';
  try {
    bases.value = await api<Base[]>();
    if (canManage.value) profiles.value = await api<Profile[]>('/embedding-profiles');
    const routeId = typeof route.params.baseId === 'string' ? Number(route.params.baseId) : null;
    view.value = currentRouteTab(route.params.subview);
    selectedId.value = routeId !== null && bases.value.some((base) => base.id === routeId) ? routeId : null;
    if (selectedId.value) await loadDetails();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '无法读取知识库。'; }
  finally { loading.value = false; }
}
async function refresh() { await run(async () => { await reload(); }, '内容已刷新。'); }
function openView(next: View) {
  if (!selectedId.value) return;
  view.value = next;
  void router.push(`/admin/knowledge/${selectedId.value}/${next}`);
}
function openDocument(id: number) {
  if (selectedId.value) void router.push(`/admin/knowledge/${selectedId.value}/documents/${id}`);
}
async function toggleDocumentEnabled(doc: DocumentItem) {
  await run(async () => {
    await api(`/${selectedId.value}/documents/${doc.id}/retrieval-status`, 'PATCH', { enabled: doc.enabledForRetrieval === false });
    await loadDetails();
  }, doc.enabledForRetrieval === false ? '文档已启用检索。' : '文档已停用检索。');
}
async function toggleDocumentArchive(doc: DocumentItem) {
  await run(async () => {
    await api(`/${selectedId.value}/documents/${doc.id}/${doc.archivedAt ? 'unarchive' : 'archive'}`, 'PATCH');
    await loadDetails();
  }, doc.archivedAt ? '文档已取消归档。' : '文档已归档。');
}
function openBase(id: number) { selectedId.value = id; void router.push(`/admin/knowledge/${id}/documents`); }
function openCreate() { name.value = ''; description.value = ''; createStep.value = 1; createConfig.value = { ...defaults }; dialog.value = 'create'; }
function openUpload() { files.value = []; uploadedIds.value = []; uploadProgress.value = { done: 0, total: 0 }; uploadStep.value = 'select'; processingConfig.value = { chunkMode: 'general', separatorMode: 'auto', preserveHeading: true, chunkChars: 800, overlapChars: 60 }; dialog.value = 'upload'; }
function openEdit() { if (!current.value) return; name.value = current.value.name; description.value = current.value.description; dialog.value = 'edit'; }
async function saveBase() {
  const editing = dialog.value === 'edit';
  if (!editing && createStep.value === 1) { createStep.value = 2; return; }
  if (!editing && createConfig.value.indexMode === 'high_quality' && !createConfig.value.embeddingProfileId) {
    error.value = '高级模式需要先选择 Embedding 模型。';
    return;
  }
  await run(async () => {
    const body = { name: name.value, description: description.value, ...(editing ? {} : { enabledForChat: true, draftConfig: { ...createConfig.value, ...(createConfig.value.indexMode === 'economy' ? { retrievalMode: 'fulltext', embeddingProfileId: null } : {}) } }) };
    const base = editing ? await api<Base>(`/${selectedId.value}`, 'PATCH', body) : await api<Base>('', 'POST', body);
    dialog.value = null;
    await reload();
    if (!editing) { selectedId.value = base.id; view.value = 'documents'; await router.push(`/admin/knowledge/${base.id}/documents`); }
  }, editing ? '知识库信息已保存。' : '知识库已创建。');
}
async function saveSettings() {
  const value = { ...config.value };
  if (value.retrievalMode !== 'fulltext' && value.indexMode === 'economy') {
    const profile = profiles.value.find((item) => item.enabled);
    if (!profile) { error.value = '向量检索和混合检索需要先配置可用的 Embedding 模型。'; return; }
    value.indexMode = 'high_quality';
    value.embeddingProfileId = value.embeddingProfileId ?? profile.id;
  }
  if (value.indexMode === 'economy') value.embeddingProfileId = null;
  await run(async () => { await api(`/${selectedId.value}/config`, 'PATCH', value); await loadDetails(); }, '设置已保存。更换模型后请构建并应用新索引，原索引继续提供服务。');
}
async function buildIndex() {
  await run(async () => { await api(`/${selectedId.value}/versions`, 'POST'); versions.value = await api<IndexVersion[]>(`/${selectedId.value}/versions`); }, '新索引已开始构建，完成后可应用。');
}
async function applyIndex(version: IndexVersion) {
  if (version.status !== 'ready') return;
  await run(async () => { await api(`/${selectedId.value}/versions/${version.id}/activate`, 'POST'); await loadDetails(); }, '新索引已应用，原索引仍然保留。');
}
async function uploadDocuments() {
  const selectedFiles = [...files.value];
  if (!selectedFiles.length) return;
  await run(async () => {
    uploadProgress.value = { done: 0, total: selectedFiles.length };
    const failed: File[] = [];
    for (const file of selectedFiles) {
      const form = new FormData(); form.append('file', file);
      form.append('deferProcessing', 'true');
      try {
        const uploaded = await api<{ id: number }>(`/${selectedId.value}/documents`, 'POST', form);
        uploadedIds.value.push(uploaded.id);
      } catch {
        failed.push(file);
      }
      uploadProgress.value.done++;
    }
    files.value = failed;
    await loadDetails();
    if (failed.length) throw new Error(`已上传 ${uploadedIds.value.length} 份，${failed.length} 份失败。失败文件仍在列表中，请重试上传。`);
    uploadStep.value = 'processing';
  }, '文档上传成功，请设置解析方式。');
}
async function processUploadedDocuments() {
  const ids = [...uploadedIds.value];
  if (!ids.length) return;
  await run(async () => {
    const outcomes = await Promise.allSettled(ids.map((id) => api(`/${selectedId.value}/documents/${id}/reprocess`, 'POST', { chunkOverride: processingConfig.value })));
    uploadedIds.value = ids.filter((_, index) => outcomes[index].status === 'rejected');
    await loadDetails();
    const failures = uploadedIds.value.length;
    if (failures) throw new Error(`${ids.length - failures} 份已开始处理，${failures} 份无法开始处理，可重试。`);
    dialog.value = null;
    uploadedIds.value = [];
  }, `${ids.length} 份文档已加入处理队列。`);
}
async function archiveDocument(id: number) {
  const doc = documents.value.find((item) => item.id === id);
  if (!doc) return;
  pendingAction.value = { title: '归档资料', description: `“${doc.title}”归档后会从该知识库的文档列表与检索结果中移除。`, run: async () => {
    await run(async () => { await api(`/${selectedId.value}/documents/${id}/archive`, 'PATCH'); await loadDetails(); }, '资料已归档。');
    pendingAction.value = null;
  } };
}
async function reprocess(ids: number[]) {
  reprocessIds.value = [...ids];
  customChunks.value = false;
  const first = documents.value.find((doc) => doc.id === ids[0]);
  reprocessConfig.value = { chunkMode: 'general', separatorMode: 'auto', preserveHeading: true, chunkChars: 800, overlapChars: 60, ...(first?.chunkOverride ?? {}) };
}
async function confirmReprocess() {
  const ids = [...reprocessIds.value];
  if (!ids.length) return;
  await run(async () => {
    const outcomes = await Promise.allSettled(ids.map((id) => api(`/${selectedId.value}/documents/${id}/reprocess`, 'POST', { chunkOverride: ids.length === 1 || customChunks.value ? reprocessConfig.value : documents.value.find(doc => doc.id === id)?.chunkOverride ?? null })));
    reprocessIds.value = ids.filter((_, index) => outcomes[index].status === 'rejected');
    await loadDetails();
    const failures = outcomes.filter((item) => item.status === 'rejected').length;
    if (failures) throw new Error(`${ids.length - failures} 份已加入处理队列，${failures} 份无法重新处理。`);
    reprocessIds.value = [];
  }, `${ids.length} 份资料已加入处理队列。`);
}
async function archiveSelected() {
  const ids = [...selectedDocuments.value];
  if (!ids.length) return;
  pendingAction.value = { title: `归档 ${ids.length} 份资料`, description: '所选资料归档后不再出现在活动文档与检索结果中。', run: async () => {
    await run(async () => {
      const outcomes = await Promise.allSettled(ids.map((id) => api(`/${selectedId.value}/documents/${id}/archive`, 'PATCH')));
      await loadDetails();
      const failures = outcomes.filter((item) => item.status === 'rejected').length;
      if (failures) throw new Error(`${ids.length - failures} 份已归档，${failures} 份未能归档。`);
    }, `${ids.length} 份资料已归档。`);
    pendingAction.value = null;
  } };
}
function toggleAll() {
  const ids = visibleDocuments.value.filter((doc) => !doc.archivedAt).map((doc) => doc.id);
  selectedDocuments.value = allVisibleSelected.value ? selectedDocuments.value.filter((id) => !ids.includes(id))
    : [...new Set([...selectedDocuments.value, ...ids])];
}
function toggleActionMenu(id: number) { openActionId.value = openActionId.value === id ? null : id; }
function closeActionMenu(event: Event) {
  const target = event.target;
  if (!(target instanceof Element) || !target.closest('.kb-action-menu')) openActionId.value = null;
}
async function preview(doc: DocumentItem) {
  await run(async () => {
    previewChunks.value = await api<Chunk[]>(`/${selectedId.value}/documents/${doc.id}/chunks`);
    previewTitle.value = doc.title;
    previewDialog.value = true;
  });
}
async function downloadDocument(doc: DocumentItem) {
  await run(async () => {
    const response = await fetch(`/api/admin/knowledge-bases/${selectedId.value}/documents/${doc.id}/file`, { headers: { Authorization: `Bearer ${props.token}` } });
    if (!response.ok) throw new Error(`下载失败（${response.status}）`);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = url; link.download = doc.originalFilename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
async function recall() {
  await run(async () => {
    recallResult.value = current.value?.activeIndexVersionId && recallTarget.value === 'active'
      ? await api<RecallResult>(`/${selectedId.value}/search?q=${encodeURIComponent(query.value)}&limit=${topK.value}`)
      : await api<RecallResult>(`/${selectedId.value}/recall-test`, 'POST', { query: query.value, topK: topK.value, retrievalMode: recallMode.value });
  });
}
async function setKnowledgeBaseEnabled(enabled: boolean) {
  if (!current.value) return;
  await run(async () => { await api(`/${current.value!.id}`, 'PATCH', { enabledForChat: enabled }); await reload(); }, enabled ? '知识库已启用。' : '知识库已停用。');
}
async function requestArchiveBase() {
  const base = current.value;
  if (!base || base.archivedAt || !canManage.value || busy.value) return;
  pendingAction.value = { title: '归档知识库', description: `归档“${base.name}”后，该库不会再参与访客检索，文档和索引仍会保留。${base.isDefault ? '后续请在其他知识库中上传文档。' : ''}`, run: async () => {
    await run(async () => { await api(`/${base.id}/archive`, 'POST'); await router.push('/admin/knowledge'); await reload(); }, '知识库已归档。');
    pendingAction.value = null;
  } };
}

watch(() => [route.params.baseId, route.params.subview, route.params.documentId], async ([baseId, rawSubview, rawDocumentId]) => {
  if (typeof baseId !== 'string') return;
  const id = Number(baseId);
  view.value = currentRouteTab(rawSubview);
  selectedId.value = id;
  await loadDetails();
  const canonical = rawDocumentId ? `/admin/knowledge/${id}/documents/${rawDocumentId}` : `/admin/knowledge/${id}/${view.value}`;
  if (route.path !== canonical) void router.replace(canonical);
});
watch(() => config.value.indexMode, (mode) => {
  if (mode === 'economy') { config.value.retrievalMode = 'fulltext'; config.value.embeddingProfileId = null; }
});
watch(() => route.path, (path) => { if (path === '/admin/knowledge') selectedId.value = null; });
let refreshTimer: ReturnType<typeof setInterval> | undefined;
async function refreshProcessing() {
  if (!selectedId.value || busy.value || (!processingCount.value && !buildingIndex.value)) return;
  const id = selectedId.value;
  try {
    if (processingCount.value) { const items = await api<DocumentItem[]>(`/${id}/documents?limit=100`); if (id === selectedId.value) documents.value = items; }
    if (buildingIndex.value) { const items = await api<IndexVersion[]>(`/${id}/versions`); if (id === selectedId.value) versions.value = items; }
  }
  catch { /* Keep the current view usable; manual refresh surfaces request errors. */ }
}
onMounted(() => { void reload(); refreshTimer = setInterval(() => void refreshProcessing(), 4000); document.addEventListener('click', closeActionMenu, true); });
onUnmounted(() => { if (refreshTimer) clearInterval(refreshTimer); document.removeEventListener('click', closeActionMenu, true); });
</script>

<template>
  <section class="kb-page">
    <AdminPageHeader v-if="!current || route.path === '/admin/knowledge'" :title="route.params.baseId ? '知识库详情' : '知识库'" :back-to="route.params.baseId ? '/admin/knowledge' : undefined" back-label="返回知识库">
      <template #actions><button v-if="canManage" class="kb-primary" type="button" @click="openCreate"><Plus :size="16" /> 新建知识库</button></template>
    </AdminPageHeader>
    <ToastNotice :message="error || notice" :type="error ? 'error' : 'success'" @dismiss="error ? (error = '') : (notice = '')" />

    <template v-if="route.path === '/admin/knowledge' || !current">
      <div class="kb-toolbar">
        <label class="kb-search"><Search :size="16" /><input v-model="listQuery" placeholder="搜索知识库名称或描述" /></label>
        <select v-model="listStatus" aria-label="筛选知识库"><option value="all">全部状态</option><option value="enabled">已启用</option><option value="disabled">已停用</option></select>
        <label class="kb-archive-toggle"><input v-model="showArchivedBases" type="checkbox" role="switch" aria-label="显示已归档的知识库" /><span class="kb-archive-track" aria-hidden="true"></span><span>显示已归档</span></label>
        <span class="kb-result-count">{{ filteredBases.length }} 个知识库</span>
        <button type="button" class="kb-quiet" :disabled="loading" @click="refresh">刷新</button>
      </div>
      <div v-if="loading && !bases.length" class="kb-empty">正在读取知识库…</div>
      <div v-else-if="!filteredBases.length" class="kb-empty"><strong>{{ bases.length ? '没有匹配的知识库' : '还没有知识库' }}</strong><p>{{ bases.length ? '调整搜索词、状态，或打开“显示已归档”。' : '创建知识库后，再上传第一份资料。' }}</p><button v-if="!bases.length && canManage" class="kb-primary" @click="openCreate"><Plus :size="16" /> 新建知识库</button></div>
      <div v-else class="kb-table-wrap">
        <table class="kb-table"><thead><tr><th>知识库</th><th>文档</th><th>索引状态</th><th>检索策略</th><th>最近更新</th><th></th></tr></thead>
          <tbody><tr v-for="base in filteredBases" :key="base.id" class="kb-base-row" @click="openBase(base.id)">
            <td><div class="kb-base-name"><span class="kb-base-icon"><Database :size="18" /></span><span><strong>{{ base.name }}</strong><small>{{ base.description || '尚未添加描述' }}</small></span></div></td>
            <td>{{ base.documentCount }}</td>
            <td><span class="kb-badge" :class="base.archivedAt ? 'muted' : base.enabledForChat ? 'green' : 'gray'">{{ base.archivedAt ? '已归档' : base.enabledForChat ? '已启用' : '已停用' }}</span><small class="kb-cell-note">{{ base.readyDocumentCount ?? '—' }} 份可检索</small></td>
            <td>{{ base.draftConfig?.retrievalMode ? retrievalName(base.draftConfig.retrievalMode) : '混合检索' }}</td><td>{{ fmtDate(base.updatedAt) }}</td>
            <td><button class="kb-link-button" @click.stop="openBase(base.id)">管理 <span>›</span></button></td>
          </tr></tbody>
        </table>
      </div>
    </template>

    <template v-else>
      <template v-if="documentDetail">
        <AdminPageHeader :title="documentDetail.title" :back-to="`/admin/knowledge/${selectedId}/documents`" back-label="返回文档列表">
          <template #breadcrumb><div class="admin-page-header-breadcrumb kb-detail-path"><RouterLink to="/admin/knowledge">知识库</RouterLink><span aria-hidden="true">/</span><span>{{ current.name }}</span></div></template>
          <template #actions><button v-if="!documentDetail.archivedAt && can('documents.reprocess') && ['pending','ready','failed','extracted'].includes(documentDetail.status)" class="kb-quiet" @click="reprocess([documentDetail.id])">重新解析</button></template>
        </AdminPageHeader>
        <section class="kb-document-detail">
          <div class="kb-document-detail-meta"><span class="kb-file-type" :class="fileTypeClass(documentDetail)" role="img" :aria-label="`${fileType(documentDetail)} 文件`"><FileText :size="22" /></span><div><strong>{{ documentDetail.originalFilename }}</strong><p>{{ fileType(documentDetail) }} · {{ charCount(documentDetail) }} 字符 · {{ documentDetailChunks.length }} 个分段</p></div></div>
          <div v-if="!documentDetailChunks.length" class="kb-empty"><FileText :size="28" /><strong>暂无分段</strong><p>文档处理完成后，分段会显示在这里。</p></div>
          <article v-for="chunk in documentDetailChunks" :key="chunk.id" class="kb-document-chunk"><header><strong>分段 {{ String(chunk.ordinal).padStart(2, '0') }}</strong><span>{{ chunk.headingPath || '正文' }}</span><small>原文 {{ chunk.sourceStartLine }}–{{ chunk.sourceEndLine }}</small></header><p>{{ chunk.content }}</p></article>
        </section>
      </template>
      <template v-else>
      <AdminPageHeader class="kb-detail-header" :title="current.name" back-to="/admin/knowledge" back-label="返回知识库">
        <template #badge><span class="kb-badge admin-page-header-badge" :class="current.archivedAt ? 'muted' : current.enabledForChat ? 'green' : 'gray'">{{ current.archivedAt ? '已归档' : current.enabledForChat ? '已启用' : '已停用' }}</span></template>
        <template #actions><button v-if="canManage" class="kb-quiet" @click="openEdit">编辑信息</button><button v-if="canManage && !current.archivedAt" class="kb-quiet" @click="setKnowledgeBaseEnabled(!current.enabledForChat)">{{ current.enabledForChat ? '停用知识库' : '启用知识库' }}</button><button v-if="canManage && !current.archivedAt" class="kb-danger-quiet" @click="requestArchiveBase">归档</button></template>
      </AdminPageHeader>
      <nav class="kb-tabs" aria-label="知识库管理页面"><button :aria-current="view === 'documents' ? 'page' : undefined" @click="openView('documents')">文档 <span>{{ activeDocuments.length }}</span></button><button :aria-current="view === 'settings' ? 'page' : undefined" @click="openView('settings')">设置</button><button :aria-current="view === 'recall-test' ? 'page' : undefined" @click="openView('recall-test')">召回测试</button></nav>

      <section v-if="view === 'documents'" class="kb-content">
        <div class="kb-stat-row"><div><span>文档总数</span><strong>{{ activeDocuments.length }}</strong></div><div><span>可检索</span><strong>{{ readyCount }}</strong></div><div><span>处理中</span><strong>{{ processingCount }}</strong></div><div><span>处理失败</span><strong>{{ failedCount }}</strong></div></div>
        <div class="kb-doc-toolbar"><label class="kb-search"><Search :size="16" /><input v-model="documentQuery" placeholder="搜索文档名称" /></label><select v-model="documentStatusFilter" aria-label="文档状态"><option value="all">全部状态</option><option value="processing">处理中</option><option value="ready">可检索</option><option value="failed">处理失败</option></select>
          <label class="kb-archive-toggle"><input v-model="showArchivedDocuments" type="checkbox" role="switch" aria-label="显示已归档的文档" /><span class="kb-archive-track" aria-hidden="true"></span><span>显示已归档</span></label>
          <div class="kb-toolbar-spacer"></div><button v-if="selectedDocuments.length && can('documents.archive')" class="kb-quiet" @click="archiveSelected">归档所选（{{ selectedDocuments.length }}）</button><button v-if="selectedDocuments.length && can('documents.reprocess')" class="kb-quiet" @click="reprocess(selectedDocuments)">重新解析（{{ selectedDocuments.length }}）</button><button v-if="can('documents.upload') && !current.archivedAt" class="kb-primary" @click="openUpload"><Upload :size="16" /> 上传文档</button>
        </div>
        <div v-if="processingCount" class="kb-processing-banner"><span class="kb-status-dot amber"></span><div><strong>{{ processingCount }} 份文档等待处理或正在处理中</strong><p>{{ current.activeIndexVersionId ? '解析完成后，请在设置中构建并应用新索引；现有在线索引继续服务。' : '解析完成后会自动进入可检索状态，无需单独发布。' }}</p></div></div>
        <div v-if="failedCount" class="kb-processing-banner failed"><span class="kb-status-dot red"></span><div><strong>{{ failedCount }} 份文档处理失败</strong><p>检查错误信息后，可对失败文档重新解析。</p></div></div>
        <div v-if="!visibleDocuments.length" class="kb-empty kb-empty-doc"><FileText :size="30" /><strong>{{ fileDocuments.length ? '没有符合条件的文档' : '还没有文档' }}</strong><p>{{ fileDocuments.length ? '调整搜索词、状态，或打开“显示已归档”。' : '上传 Markdown、DOCX 或可复制文字的 PDF，解析成功后会自动参与检索。' }}</p><button v-if="!fileDocuments.length && can('documents.upload') && !current.archivedAt" class="kb-primary" @click="openUpload"><Upload :size="16" /> 上传文档</button></div>
        <div v-else class="kb-table-wrap"><table class="kb-table kb-doc-table"><thead><tr><th class="check-cell"><input type="checkbox" :checked="allVisibleSelected" aria-label="选择所有文档" @change="toggleAll" /></th><th>文档名称</th><th>类型</th><th>字符数</th><th>分段数</th><th>状态</th><th>检索</th><th>更新时间</th><th>操作</th></tr></thead>
          <tbody><tr v-for="doc in visibleDocuments" :key="doc.id" class="kb-document-row" @click="openDocument(doc.id)"><td class="check-cell" @click.stop><input v-if="!doc.archivedAt" v-model="selectedDocuments" type="checkbox" :value="doc.id" :aria-label="`选择 ${doc.title}`" /></td><td><div class="kb-doc-name"><span class="kb-file-type" :class="fileTypeClass(doc)" role="img" :aria-label="`${fileType(doc)} 文件`"><FileText :size="18" :stroke-width="1.8" /></span><span><strong>{{ doc.title }}</strong><small>{{ doc.originalFilename }}</small><small v-if="doc.errorMessage" class="kb-doc-error">{{ doc.errorMessage }}</small></span></div></td>
            <td>{{ fileType(doc) }}</td><td>{{ charCount(doc) }}</td><td>{{ chunkCount(doc) }}</td><td><span class="kb-badge" :class="doc.archivedAt ? 'muted' : doc.enabledForRetrieval === false ? 'disabled' : statusClass(doc)"><i class="kb-status-dot"></i>{{ doc.archivedAt ? '已归档' : doc.enabledForRetrieval === false ? '已停用' : statusLabel(doc) }}</span></td><td @click.stop><label v-if="!doc.archivedAt && can('documents.archive')" class="kb-switch" :class="{ on: doc.enabledForRetrieval !== false }" :aria-label="doc.enabledForRetrieval !== false ? '停用检索' : '启用检索'"><input type="checkbox" :checked="doc.enabledForRetrieval !== false" @change="toggleDocumentEnabled(doc)" /><span></span></label><span v-else class="kb-muted-dash">—</span></td><td>{{ fmtDate(doc.updatedAt) }}</td><td @click.stop><div class="kb-action-menu" @keydown.esc="openActionId = null"><button class="kb-menu-trigger" aria-label="文档操作" :aria-expanded="openActionId === doc.id" @click="toggleActionMenu(doc.id)">•••</button><div v-if="openActionId === doc.id" class="kb-action-menu-panel" @click="openActionId = null"><button @click="openDocument(doc.id)">查看详情</button><button v-if="!doc.archivedAt && can('documents.reprocess') && ['pending','ready','failed','extracted'].includes(doc.status)" @click="reprocess([doc.id])">重新解析</button><button v-if="can('documents.archive')" @click="toggleDocumentArchive(doc)">{{ doc.archivedAt ? '取消归档' : '归档' }}</button><button v-if="!doc.archivedAt" @click="downloadDocument(doc)">下载原文件</button></div></div></td>
          </tr></tbody></table></div>
      </section>

      <section v-else-if="view === 'settings'" class="kb-content kb-settings">
        <div class="kb-section-heading"><div><h2>索引与检索设置</h2><p>统一管理本知识库的索引质量、Embedding 模型和检索参数。</p></div><Settings2 :size="19" /></div>
        <form @submit.prevent="saveSettings">
          <fieldset :disabled="busy || !canManage || !!current.archivedAt">
          <div class="kb-setting-note">文档分段配置已移至上传和重新解析流程，知识库设置只负责索引质量、Embedding 模型与检索方式。</div>
          <section class="kb-setting-group"><div><h3>Embedding 设置</h3><p>向量模型负责把文档片段和用户问题映射到同一语义空间。</p></div><div class="kb-setting-fields"><label>索引质量<select v-model="config.indexMode"><option value="economy">经济模式</option><option value="high_quality">高级模式</option></select><small>经济模式只使用全文检索；高级模式支持向量和混合检索。</small></label><label v-if="config.indexMode === 'high_quality'">Embedding 模型<select v-model.number="config.embeddingProfileId"><option :value="null">选择已配置模型</option><option v-for="profile in profiles.filter(item => item.enabled)" :key="profile.id" :value="profile.id">{{ profile.name }} · {{ profile.config.model }} · {{ profile.config.dimensions }} 维</option></select><small v-if="currentProfile">待应用配置：{{ currentProfile.name }}</small><small v-else-if="!profiles.some(item => item.enabled)">尚无可用模型配置，请先添加。</small></label><RouterLink v-if="canReadEmbedding" class="kb-text-action" to="/admin/embedding-services">管理 向量服务</RouterLink></div></section>
          <section class="kb-setting-group"><div><h3>检索设置</h3><p>控制召回算法、候选数量与相关度过滤。</p></div><div class="kb-setting-fields"><label>检索方式<select v-model="config.retrievalMode"><option value="fulltext">全文检索</option><template v-if="config.indexMode === 'high_quality'"><option value="vector">向量检索</option><option value="hybrid">混合检索</option></template></select><small>经济模式只提供全文检索；高级模式可选择向量或混合检索。</small></label><label>Top K<input v-model.number="config.topK" type="number" min="1" max="8" /><small>访客问答最多使用 8 个候选片段。</small></label><label>{{ config.retrievalMode === 'fulltext' ? '全文相关度阈值' : '相似度阈值' }}<input v-if="config.retrievalMode === 'fulltext'" v-model.number="config.lexicalThreshold" type="number" min="0" max="1" step="0.01" /><input v-else v-model.number="config.vectorThreshold" type="number" min="-1" max="1" step="0.05" /></label><label class="kb-disabled-option">重排模型<select disabled><option>暂未启用</option></select><small>后续版本开放。</small></label></div></section>
          </fieldset>
          <div class="kb-settings-footer"><p>更换模型会保留旧索引。保存后，先构建新索引，再应用。</p><button class="kb-primary" type="submit" :disabled="busy || !canManage || !!current.archivedAt">保存设置</button></div>
        </form>
        <section class="kb-index-versions" aria-label="索引版本">
          <header><div><h3>索引版本</h3><p>{{ current.activeIndexVersionId ? '在线版本 #' + current.activeIndexVersionId + ' · ' + retrievalName(activeVersion?.config.retrievalMode ?? 'fulltext') : '当前使用文档即时索引' }}</p></div><button v-if="canManage && !current.archivedAt" class="ui-button" type="button" :disabled="busy || buildingIndex || settingsDirty || processingCount > 0 || !documents.some(d => !d.archivedAt && d.status === 'ready')" @click="buildIndex">{{ buildingIndex ? '正在构建…' : newestVersion?.status === 'failed' ? '重新构建索引' : '构建新索引' }}</button></header>
          <p v-if="settingsDirty" class="kb-index-hint">请先保存设置，再构建索引。</p>
          <p v-if="!versions.length" class="kb-index-hint">尚未创建版本，更换模型时会自动保留当前索引。</p>
          <article v-for="version in versions.slice(0, 5)" :key="version.id"><div><strong>#{{ version.id }}</strong><span>{{ version.config.embeddingProfileId ? 'Embedding 配置 #' + version.config.embeddingProfileId : '全文索引' }}</span><small>{{ version.chunkCount }} 段 · {{ fmtDate(version.createdAt) }}</small><p v-if="version.status === 'failed'" role="alert">构建失败，请检查连接、维度和输入上限后重试。原索引未替换。</p></div><span class="kb-badge" :class="version.status === 'failed' ? 'failed' : version.status === 'building' ? 'processing' : 'ready'">{{ version.id === current.activeIndexVersionId ? '在线使用' : version.status === 'ready' ? '可应用' : version.status === 'building' ? '构建中' : '失败' }}</span><button v-if="canManage && !current.archivedAt && version.status === 'ready' && version.id !== current.activeIndexVersionId" class="ui-button" type="button" :disabled="busy" @click="applyIndex(version)">{{ version.id === newestVersion?.id ? '应用索引' : '切换到此版本' }}</button></article>
        </section>
      </section>

      <section v-else class="kb-content kb-recall">
        <div class="kb-section-heading"><div><h2>召回测试</h2><p>仅验证知识库检索结果，不会生成 AI 回答。</p></div></div>
        <form class="kb-recall-form" @submit.prevent="recall"><label>测试问题<textarea v-model.trim="query" required minlength="2" maxlength="200" rows="3" placeholder="例如：退货需要满足什么条件？" /></label><div class="kb-recall-controls"><label v-if="current.activeIndexVersionId">测试范围<select v-model="recallTarget"><option value="active">在线索引</option><option value="draft">当前文档（待应用配置）</option></select></label><label v-if="!current.activeIndexVersionId || recallTarget === 'draft'">检索方式<select v-model="recallMode"><option value="fulltext">全文检索</option><option value="vector">向量检索</option><option value="hybrid">混合检索</option></select></label><label>Top K<input v-model.number="topK" type="number" min="1" max="20" /></label><span class="kb-toolbar-spacer"></span><button class="kb-primary" :disabled="busy || query.trim().length < 2">{{ busy ? '检索中…' : '执行检索' }}</button></div></form>
        <div v-if="recallResult" class="kb-recall-results"><div class="kb-recall-summary"><strong>{{ recallResult.hits.length }} 条召回结果</strong><span>{{ retrievalName(recallMode) }}</span><span>{{ recallResult.durationMs ?? '—' }} ms</span><span>向量索引 {{ recallResult.vectorIndexedChunks ?? 0 }} 段</span></div>
          <div v-if="!recallResult.hits.length" class="kb-empty kb-empty-doc"><strong>没有召回结果</strong><p>确认文档已处理完成，并尝试调整检索方式、分段或相似度阈值。</p></div>
          <article v-for="(hit, index) in recallResult.hits" :key="hit.chunkId" class="kb-hit"><div class="kb-hit-head"><span class="kb-hit-number">{{ String(index + 1).padStart(2, '0') }}</span><div><strong>{{ hit.documentTitle }}</strong><small>{{ hit.originalFilename }}<template v-if="hit.headingPath"> · {{ hit.headingPath }}</template></small></div><span class="kb-hit-score">{{ Number(hit.score).toFixed(3) }}</span></div><p>{{ hit.content }}</p><footer><span>分段 #{{ hit.chunkId }}</span><span>{{ hit.matchType || retrievalName(recallMode) }}</span></footer></article>
        </div>
        <div v-else class="kb-recall-placeholder"><Search :size="22" /><p>输入问题后运行检索，查看召回的文档片段、匹配分数和耗时。</p></div>
      </section>
      </template>
    </template>

    <UiDialog :open="dialog !== null" :title="dialog === 'create' ? '新建知识库' : dialog === 'edit' ? '编辑知识库' : '上传文档'" :description="dialog === 'upload' ? '支持 Markdown、DOCX 和可复制文字的 PDF，单个文件最大 2 MB。' : dialog === 'create' ? '创建后会进入知识库详情页，可继续导入文档。' : '更新知识库的名称和说明。'" @update:open="dialog = $event ? dialog : null">
      <form v-if="dialog === 'create' || dialog === 'edit'" class="kb-dialog-form" @submit.prevent="saveBase">
        <template v-if="dialog === 'edit' || createStep === 1"><label>知识库名称<input v-model.trim="name" class="ui-input" required maxlength="120" placeholder="例如：售后服务知识库" /></label><label>描述<textarea v-model.trim="description" class="ui-input" rows="3" maxlength="2000" placeholder="简要说明知识库包含的内容" /></label></template>
        <template v-else><div class="kb-wizard-step"><span class="active">2</span><strong>索引设置</strong><small>决定知识库如何检索资料</small></div><label>索引质量<select v-model="createConfig.indexMode" class="ui-input"><option value="economy">经济模式</option><option value="high_quality">高级模式</option></select><small>经济模式使用全文检索；高级模式可使用向量或混合检索。</small></label><label>检索方式<select v-model="createConfig.retrievalMode" class="ui-input"><option value="fulltext">全文检索</option><template v-if="createConfig.indexMode === 'high_quality'"><option value="vector">向量检索</option><option value="hybrid">混合检索</option></template></select></label><label v-if="createConfig.indexMode === 'high_quality'">Embedding 模型<select v-model.number="createConfig.embeddingProfileId" class="ui-input"><option :value="null">选择模型</option><option v-for="profile in profiles.filter(item => item.enabled)" :key="profile.id" :value="profile.id">{{ profile.name }} · {{ profile.config.model }}</option></select><small v-if="!profiles.some(item => item.enabled)">请先在「平台配置 → 向量服务」添加模型。</small></label><label>Top K<input v-model.number="createConfig.topK" class="ui-input" type="number" min="1" max="8" /></label></template>
        <footer><button type="button" class="ui-button" @click="dialog = null">取消</button><button v-if="dialog === 'create' && createStep === 2" type="button" class="ui-button" @click="createStep = 1">上一步</button><button class="ui-button ui-button-primary" :disabled="busy">{{ dialog === 'edit' ? '保存修改' : createStep === 1 ? '下一步' : '创建知识库' }}</button></footer>
      </form>
<form v-else class="kb-dialog-form" @submit.prevent="uploadStep === 'select' ? uploadDocuments() : processUploadedDocuments()">
<div class="kb-wizard-step"><strong>{{ uploadStep === 'select' ? '1. 上传文件' : '2. 设置解析方式' }}</strong></div>
<template v-if="uploadStep === 'select'">
<label class="kb-upload-zone"><input type="file" multiple required accept=".md,.markdown,.docx,.pdf" :disabled="busy" @change="files = Array.from(($event.target as HTMLInputElement).files || [])" /><span class="kb-upload-icon"><Upload :size="21" /></span><strong>{{ files.length ? `待上传 ${files.length} 个文件` : '选择文件' }}</strong><small>Markdown、DOCX、可复制文字的 PDF · 最多 2 MB / 文件</small></label>
<p v-if="uploadedIds.length || (busy && uploadProgress.total)" class="kb-upload-confirmed">已上传 {{ uploadedIds.length }} 份<span v-if="busy && uploadProgress.total"> · 正在提交 {{ uploadProgress.done }}/{{ uploadProgress.total }}</span></p>
<ul v-if="files.length" class="kb-file-list"><li v-for="file in files" :key="`${file.name}-${file.size}`"><FileText :size="16" /><span>{{ file.name }}</span><small>{{ (file.size / 1024).toFixed(0) }} KB</small></li></ul>
</template>
<template v-else><p class="kb-upload-confirmed">{{ uploadedIds.length }} 份文档已上传。确认设置后开始解析；稍后处理的文档可在列表中继续。</p><div class="kb-processing-fields">
<strong>解析设置</strong>
<label>分段方式<select v-model="processingConfig.chunkMode" class="ui-input"><option value="general">通用分段</option></select></label>
<label>分隔方式<select v-model="processingConfig.separatorMode" class="ui-input"><option value="auto">自动识别</option><option value="heading_paragraph">按标题和段落</option><option value="fixed">固定长度</option></select></label>
<label>分段长度<input v-model.number="processingConfig.chunkChars" class="ui-input" type="number" min="200" max="4000" required /></label>
<label>重叠长度<input v-model.number="processingConfig.overlapChars" class="ui-input" type="number" min="0" :max="Math.min(400, processingConfig.chunkChars - 1)" required /></label>
<label class="kb-heading-option"><span><input v-model="processingConfig.preserveHeading" type="checkbox" /> 保留标题层级</span></label>
</div></template>
<footer><button type="button" class="ui-button" :disabled="busy" @click="dialog = null">{{ uploadStep === 'select' ? '取消' : '稍后处理' }}</button><button class="ui-button ui-button-primary" :disabled="busy || (uploadStep === 'select' ? !files.length : !uploadedIds.length)">{{ busy ? '提交中…' : uploadStep === 'select' ? uploadedIds.length ? '重试剩余文件' : '上传并继续' : '确认并开始解析' }}</button></footer>
</form>
    </UiDialog>
    <UiDialog :open="previewDialog" :title="previewTitle" description="文档切分后的检索片段。" size="lg" @update:open="previewDialog = $event"><div class="kb-preview-list"><article v-for="chunk in previewChunks" :key="chunk.id"><header><strong>分段 {{ chunk.ordinal }}</strong><span>{{ chunk.headingPath || '正文' }}</span></header><p>{{ chunk.content }}</p><small>原文位置：{{ chunk.sourceStartLine }}–{{ chunk.sourceEndLine }}</small></article><p v-if="!previewChunks.length" class="kb-empty">该文档还没有可查看的分段。</p></div></UiDialog>
    <UiDialog :open="pendingAction !== null" :title="pendingAction?.title || '确认操作'" :description="pendingAction?.description" size="sm" @update:open="pendingAction = $event ? pendingAction : null"><div class="kb-confirm-actions"><button class="ui-button" @click="pendingAction = null">取消</button><button class="kb-danger-button" :disabled="busy" @click="pendingAction?.run()">确认</button></div></UiDialog>
    <UiDialog :open="reprocessIds.length > 0" title="重新解析文档" description="已载入文档保存的解析设置，修改后用于本次及后续解析。" @update:open="!$event && (reprocessIds = [])">
      <form class="kb-dialog-form" @submit.prevent="confirmReprocess">
        <label v-if="reprocessIds.length > 1">批量设置<select v-model="customChunks" class="ui-input"><option :value="false">保留各文档原有设置</option><option :value="true">统一修改解析设置</option></select></label>
        <template v-if="reprocessIds.length === 1 || customChunks"><div class="kb-processing-fields">
<strong>解析设置</strong>
<label>分段方式<select v-model="reprocessConfig.chunkMode" class="ui-input"><option value="general">通用分段</option></select></label>
<label>分隔方式<select v-model="reprocessConfig.separatorMode" class="ui-input"><option value="auto">自动识别</option><option value="heading_paragraph">按标题和段落</option><option value="fixed">固定长度</option></select></label>
<label>分段长度<input v-model.number="reprocessConfig.chunkChars" class="ui-input" type="number" min="200" max="4000" required /></label>
<label>重叠长度<input v-model.number="reprocessConfig.overlapChars" class="ui-input" type="number" min="0" :max="Math.min(400, reprocessConfig.chunkChars - 1)" required /></label>
<label class="kb-heading-option"><span><input v-model="reprocessConfig.preserveHeading" type="checkbox" /> 保留标题层级</span></label>
</div></template>
        <footer><button type="button" class="ui-button" @click="reprocessIds = []">取消</button><button class="kb-primary" :disabled="busy">重新构建 {{ reprocessIds.length }} 份文档</button></footer>
      </form>
    </UiDialog>
  </section>
</template>

<style scoped>
.kb-index-versions { margin-top:24px; padding-top:24px; border-top:1px solid #e5e9ef; }
.kb-index-versions header, .kb-index-versions article { display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; }
.kb-index-versions h3 { margin:0; font-size:14px; color:#344054; }
.kb-index-versions header p, .kb-index-hint { font-size:12px; color:#8490a0; line-height:1.7; margin:8px 0; }
.kb-index-versions article { padding:14px 0; border-bottom:1px solid #edf0f5; font-size:12px; }
.kb-index-versions article > div { flex:1; min-width:160px; }
.kb-index-versions article strong { margin-right:12px; color:#344054; }
.kb-index-versions article small { display:block; margin-top:6px; color:#8490a0; }
.kb-index-versions article p { color:#b91c1c; margin:8px 0 0; line-height:1.7; }
.kb-upload-confirmed{grid-column:1/-1;margin:0;color:#667085;font-size:13px;line-height:1.7}
.kb-page{min-width:0;margin:0;padding:0;color:#172033}
.kb-detail-path{min-width:0;flex-wrap:wrap}.kb-detail-path a{display:inline-flex;align-items:center;min-height:36px;border-radius:5px;color:#667085;text-decoration:none}.kb-detail-path a:hover{color:#2457e6}.kb-detail-path a:focus-visible{outline:2px solid #2457e6;outline-offset:4px}.kb-detail-path>span:last-child{overflow-wrap:anywhere}
.kb-primary{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:0 15px;border:1px solid #2457e6;border-radius:8px;background:#2457e6;color:#fff;font-size:13px;font-weight:600;white-space:nowrap;cursor:pointer}
.kb-primary:hover{background:#1748ce}.kb-primary:disabled{opacity:.55;cursor:not-allowed}
.kb-quiet,.kb-danger-quiet{min-height:38px;padding:0 13px;border:1px solid #dfe5ed;border-radius:8px;background:#fff;color:#475467;font-size:13px;white-space:nowrap;cursor:pointer}
.kb-danger-quiet{border-color:#f2d1d0;color:#b42318}
.kb-toolbar,.kb-doc-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin:0 0 18px;padding:0}
.kb-toolbar select,.kb-doc-toolbar select,.kb-recall-controls select,.kb-setting-fields select,.kb-setting-fields input,.kb-recall-form textarea{min-height:40px;padding:0 11px;border:1px solid #dfe4ec;border-radius:8px;background-color:#fff;color:#344054;font:inherit;font-size:13px}
.kb-page select:not([multiple]){padding-right:38px;cursor:pointer}
.kb-toolbar select,.kb-doc-toolbar select{min-width:140px;flex:none}
.kb-archive-toggle{position:relative;display:inline-flex;align-items:center;gap:8px;min-height:40px;padding:0 4px;color:#475467;font-size:13px;font-weight:400;white-space:nowrap;cursor:pointer;flex:none}
.kb-archive-toggle input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
.kb-archive-track{position:relative;display:block;width:34px;height:20px;flex:none;border-radius:12px;background:#b6c0ce;transition:background-color .16s ease}
.kb-archive-track::after{position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #18223020;content:'';transition:transform .16s ease}
.kb-archive-toggle input:checked + .kb-archive-track{background:#2457e6}
.kb-archive-toggle input:checked + .kb-archive-track::after{transform:translateX(14px)}
.kb-archive-toggle input:focus-visible + .kb-archive-track{outline:2px solid #2457e6;outline-offset:3px}
.kb-search{display:flex;align-items:center;gap:9px;width:min(390px,100%);height:40px;padding:0 12px;border:1px solid #dfe4ec;border-radius:8px;background:#fff;color:#8290a2}
.kb-search input{width:100%;min-width:0;border:0;outline:0;color:#344054;font:inherit;font-size:13px}
.kb-result-count{margin-left:auto;color:#8490a0;font-size:12px;white-space:nowrap}
.kb-table-wrap{overflow:visible;border:1px solid #e5e9ef;border-radius:11px;background:#fff}
.kb-table{width:100%;min-width:760px;border-collapse:collapse;text-align:left;font-size:13px}
.kb-table th{height:46px;padding:0 16px;border-bottom:1px solid #e8ebf0;background:#fafbfc;color:#7b8798;font-size:11px;font-weight:600;white-space:nowrap}
.kb-table td{height:69px;padding:10px 16px;border-bottom:1px solid #eef0f3;color:#475467;white-space:nowrap}
.kb-table tr:last-child td{border-bottom:0}.kb-base-row,.kb-document-row{cursor:pointer}.kb-base-row:hover,.kb-document-row:hover{background:#f8faff}
.kb-base-name,.kb-doc-name{display:flex;align-items:center;gap:12px;min-width:230px}
.kb-base-icon{display:grid;place-items:center;width:38px;height:38px;flex:none;border:1px solid #e5eaf5;border-radius:10px;background:#f4f7ff;color:#2457e6}
.kb-base-name strong,.kb-doc-name strong{display:block;color:#243049;font-size:13px;font-weight:600}
.kb-base-name small,.kb-doc-name small,.kb-cell-note{display:block;margin-top:5px;color:#8a96a8;font-size:11px;font-weight:400;white-space:normal}
.kb-link-button{border:0;background:none;color:#2457e6;font-size:12px;white-space:nowrap;cursor:pointer}.kb-link-button span{padding-left:5px;font-size:18px}
.kb-badge{display:inline-flex;align-items:center;gap:6px;min-height:24px;padding:0 9px;border-radius:999px;background:#f1f3f6;color:#667085;font-size:11px;white-space:nowrap}
.kb-badge.green{background:#edf8f1;color:#21834e}.kb-badge.gray,.kb-badge.muted{background:#f1f3f6;color:#667085}.kb-badge.processing{background:#fff7e8;color:#996400}.kb-badge.failed{background:#fff0ef;color:#b42318}.kb-badge.pending{background:#f3f6ff;color:#4963a7}
.kb-status-dot{width:7px;height:7px;border-radius:50%;background:#98a2b3}.kb-badge .kb-status-dot{background:currentColor}
.kb-empty{display:grid;justify-items:center;gap:8px;padding:64px 24px;color:#8490a0;text-align:center}.kb-empty strong{color:#344054;font-size:15px}.kb-empty p{max-width:500px;margin:0;color:#8792a2;font-size:13px;line-height:1.65}.kb-empty .kb-primary{margin-top:10px}
.kb-feedback{margin:0 0 15px;padding:11px 14px;border-radius:8px;font-size:13px}.kb-feedback.error{background:#fff0ef;color:#b42318}.kb-feedback.success{background:#eff9f2;color:#237747}
.kb-tabs{display:flex;gap:30px;margin:0;border-bottom:1px solid #e4e8ee;overflow-x:auto}.kb-tabs button{display:flex;align-items:center;gap:8px;min-height:47px;padding:0 2px;border:0;border-bottom:2px solid transparent;background:none;color:#667085;font-size:13px;white-space:nowrap;cursor:pointer}.kb-tabs button[aria-current=page]{border-bottom-color:#2457e6;color:#2457e6;font-weight:600}.kb-tabs button span{display:grid;place-items:center;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:#f1f3f6;color:#7b8798;font-size:10px}
.kb-content{padding-top:25px}.kb-stat-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:0 0 24px}.kb-stat-row>div{display:flex;align-items:center;justify-content:space-between;min-height:66px;padding:0 17px;border:1px solid #e7eaf0;border-radius:10px;background:#fff}.kb-stat-row span{color:#7b8798;font-size:12px}.kb-stat-row strong{color:#25324a;font-size:21px;font-weight:600}
.kb-doc-toolbar{flex-wrap:wrap;margin:0 0 8px}.kb-toolbar-spacer{flex:1}.kb-processing-banner{display:flex;align-items:center;gap:12px;margin:9px 0 14px;padding:13px 15px;border:1px solid #f1dfb5;border-radius:9px;background:#fffaf0}.kb-processing-banner.failed{border-color:#f2d1d0;background:#fff7f6}.kb-processing-banner strong{color:#4b5565;font-size:12px}.kb-processing-banner p{margin:4px 0 0;color:#8290a2;font-size:11px}.kb-status-dot.amber{background:#d99a18}.kb-status-dot.red{background:#d0443e}
.kb-empty-doc{padding:50px 22px}.kb-empty-doc>svg{color:#98a2b3}.kb-doc-table{min-width:980px}.kb-doc-table .check-cell{width:38px;padding-right:0}.kb-doc-table input[type=checkbox]{width:15px;height:15px;accent-color:#2457e6}.kb-file-type{display:grid;place-items:center;width:38px;height:40px;flex:none;border:1px solid #e8ecf2;border-radius:9px;background:#f7f8fa;color:#687385}.kb-file-type.pdf{border-color:#fee2e2;background:#fff1f1;color:#dc2626}.kb-file-type.word{border-color:#dbeafe;background:#eff6ff;color:#2563eb}.kb-file-type.markdown{border-color:#ede9fe;background:#f5f3ff;color:#7c3aed}.kb-file-type.generic{border-color:#e5e7eb;background:#f8fafc;color:#64748b}.kb-doc-error{max-width:420px;color:#b42318!important}.kb-row-actions{display:flex;align-items:center;gap:11px}.kb-row-actions button{padding:0;border:0;background:none;color:#526078;font-size:11px;white-space:nowrap;cursor:pointer}.kb-row-actions button:hover,.kb-text-action:hover{color:#2457e6}.kb-row-actions .kb-danger-quiet{min-height:unset;padding:0;border:0;color:#b42318}
.kb-settings{max-width:1040px}.kb-section-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;color:#8792a2}.kb-section-heading h2{margin:0;color:#202c42;font-size:18px;font-weight:620}.kb-section-heading p{margin:6px 0 0;color:#7b8798;font-size:12px}.kb-setting-group{display:grid;grid-template-columns:230px minmax(0,1fr);gap:30px;padding:24px 0;border-top:1px solid #e9ecf1}.kb-setting-group h3{margin:0;color:#344054;font-size:13px}.kb-setting-group>div:first-child p{margin:7px 0 0;color:#8a96a8;font-size:11px;line-height:1.6}.kb-setting-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.kb-setting-fields label,.kb-recall-form label{display:grid;align-content:start;gap:7px;color:#475467;font-size:12px;font-weight:600}.kb-setting-fields select,.kb-setting-fields input{width:100%;box-sizing:border-box}.kb-setting-fields select:disabled,.kb-setting-fields input:disabled{background:#f7f8fa;color:#98a2b3}.kb-setting-fields small{color:#8a96a8;font-size:10px;font-weight:400;line-height:1.5}.kb-text-action{justify-self:start;padding:0;border:0;background:none;color:#2457e6;font-size:12px;cursor:pointer}.kb-disabled-option{opacity:.62}.kb-heading-option>span{display:flex;align-items:center;gap:8px;color:#475467;font-size:12px;font-weight:600}.kb-heading-option input{width:15px;min-height:15px;margin:0;accent-color:#2457e6}.kb-settings-footer{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:16px 0;border-top:1px solid #e9ecf1}.kb-settings-footer p{margin:0;color:#8490a0;font-size:11px}
.kb-setting-note{margin-bottom:18px;padding:13px 15px;border:1px solid #e2e8f1;border-radius:9px;background:#f8fafc;color:#758196;font-size:12px;line-height:1.6}.kb-wizard-step{display:flex;align-items:center;gap:9px;grid-column:1/-1;padding-bottom:6px;border-bottom:1px solid #edf0f4;color:#344054}.kb-wizard-step span{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#2457e6;color:#fff;font-size:11px;font-weight:700}.kb-wizard-step small{margin-left:4px;color:#8a96a8;font-size:11px;font-weight:400}.kb-processing-fields{grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:15px;border:1px solid #e4e9f0;border-radius:9px;background:#fafbfc}.kb-processing-fields>strong{grid-column:1/-1;color:#344054;font-size:13px}.kb-processing-fields label{display:grid;gap:6px;color:#475467;font-size:11px;font-weight:600}.kb-processing-fields .ui-input{min-height:36px}.kb-processing-fields .kb-heading-option{display:flex;align-items:center}
.kb-recall{max-width:1000px}.kb-recall-form{padding:20px;border:1px solid #e6e9ef;border-radius:11px;background:#fff}.kb-recall-form textarea{width:100%;box-sizing:border-box;padding:11px;resize:vertical}.kb-recall-controls{display:flex;align-items:end;gap:12px;margin-top:15px}.kb-recall-controls label{display:grid;gap:6px;color:#667085;font-size:11px}.kb-recall-controls select,.kb-recall-controls input{min-width:150px}.kb-recall-controls input{box-sizing:border-box;width:110px;height:40px;padding:0 10px;border:1px solid #dfe4ec;border-radius:8px}.kb-recall-results{margin-top:22px}.kb-recall-summary{display:flex;align-items:center;gap:16px;margin-bottom:11px;color:#8390a1;font-size:11px}.kb-recall-summary strong{color:#344054;font-size:13px}.kb-hit{margin:10px 0;padding:17px 18px;border:1px solid #e7eaf0;border-radius:10px;background:#fff}.kb-hit-head{display:flex;align-items:center;gap:12px}.kb-hit-number{color:#2457e6;font-size:11px;font-weight:700}.kb-hit-head strong{display:block;color:#344054;font-size:13px}.kb-hit-head small{display:block;margin-top:4px;color:#8a96a8;font-size:10px}.kb-hit-score{margin-left:auto;padding:5px 8px;border-radius:6px;background:#f1f5ff;color:#3158c8;font-size:11px;font-weight:600}.kb-hit>p{margin:15px 0;color:#475467;font-size:12px;line-height:1.8;white-space:pre-wrap}.kb-hit footer{display:flex;gap:14px;padding-top:10px;border-top:1px solid #f0f2f5;color:#8a96a8;font-size:10px}.kb-recall-placeholder{display:grid;justify-items:center;gap:10px;margin-top:18px;padding:56px;border:1px dashed #dfe4ec;border-radius:10px;color:#98a2b3;text-align:center}.kb-recall-placeholder p{margin:0;font-size:12px}
.kb-dialog-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px}.kb-dialog-form>label{display:grid;gap:7px;color:#475467;font-size:12px;font-weight:600}.kb-dialog-form>label:has(textarea),.kb-dialog-form>footer,.kb-upload-zone{grid-column:1/-1}.kb-dialog-form textarea{resize:vertical}.kb-dialog-form footer,.kb-confirm-actions{display:flex;justify-content:flex-end;gap:9px;grid-column:1/-1;padding-top:14px;border-top:1px solid #edf0f4}.kb-upload-zone{position:relative;display:grid;justify-items:center;gap:8px;padding:32px 16px;border:1px dashed #bac5d5;border-radius:10px;background:#fafbfc;text-align:center;cursor:pointer}.kb-upload-zone input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}.kb-upload-zone strong{color:#344054;font-size:13px}.kb-upload-zone small{color:#8a96a8;font-size:10px}.kb-upload-icon{display:grid;place-items:center;width:42px;height:42px;border-radius:11px;background:#eff3ff;color:#2457e6}.kb-file-list{grid-column:1/-1;max-height:190px;overflow:auto;margin:0;padding:0;list-style:none;border:1px solid #e8ebf0;border-radius:8px}.kb-file-list li{display:flex;align-items:center;gap:9px;padding:10px 12px;border-bottom:1px solid #eef0f3;color:#667085;font-size:11px}.kb-file-list li:last-child{border:0}.kb-file-list li span{overflow:hidden;flex:1;color:#344054;text-overflow:ellipsis;white-space:nowrap}.kb-file-list li small{color:#98a2b3}.kb-preview-list{max-height:65vh;overflow:auto}.kb-preview-list article{padding:15px 0;border-bottom:1px solid #e9ecf1}.kb-preview-list header{display:flex;gap:12px;color:#344054;font-size:12px}.kb-preview-list header span{color:#8090a3}.kb-preview-list p{margin:10px 0;color:#475467;font-size:12px;line-height:1.8;white-space:pre-wrap}.kb-preview-list small{color:#8a96a8;font-size:10px}.kb-confirm-actions .kb-danger-button{min-height:38px;padding:0 15px;border:1px solid #b42318;border-radius:8px;background:#b42318;color:#fff}.ui-input{box-sizing:border-box;width:100%;min-height:39px;padding:8px 10px;border:1px solid #dfe4ec;border-radius:7px;color:#344054;font:inherit;font-size:13px}.kb-page button:focus-visible,.kb-page input:focus-visible,.kb-page select:focus-visible,.kb-page textarea:focus-visible{outline:3px solid #d8e2ff;outline-offset:1px}

.kb-heading-option>span{display:flex;align-items:center;gap:8px;color:#475467;font-size:12px;font-weight:600}.kb-heading-option input{width:15px;min-height:15px;margin:0;accent-color:#2457e6}
@media(max-width:900px){.kb-setting-group{grid-template-columns:1fr;gap:16px}.kb-stat-row{grid-template-columns:repeat(2,minmax(0,1fr))}.kb-detail-actions{flex-wrap:wrap}.kb-doc-table{min-width:980px}}
@media(max-width:620px){.kb-toolbar,.kb-doc-toolbar{align-items:stretch}.kb-toolbar .kb-search,.kb-doc-toolbar .kb-search{flex:1 1 100%;width:100%;box-sizing:border-box}.kb-toolbar select,.kb-doc-toolbar select{flex:0 0 145px}.kb-archive-toggle{min-height:44px}.kb-toolbar-spacer{display:none}.kb-result-count{margin-left:auto}.kb-tabs{gap:20px}.kb-stat-row{gap:8px}.kb-stat-row>div{min-height:57px;padding:0 11px}.kb-stat-row strong{font-size:17px}.kb-setting-fields,.kb-dialog-form{grid-template-columns:1fr}.kb-dialog-form>label,.kb-dialog-form>footer,.kb-upload-zone{grid-column:1}.kb-settings-footer{align-items:flex-start;flex-direction:column}.kb-recall-controls{align-items:stretch;flex-wrap:wrap}.kb-recall-controls .kb-toolbar-spacer{display:none}.kb-recall-controls .kb-primary{width:100%}.kb-recall-summary{align-items:flex-start;flex-wrap:wrap;gap:8px 12px}.kb-hit{padding:13px}.kb-recall-placeholder{padding:35px 18px}}
@media(prefers-reduced-motion:reduce){.kb-archive-track,.kb-archive-track::after{transition:none}}

.kb-page :deep(.kb-detail-header) { align-items: center; margin-bottom: 0; padding-bottom: 16px; }
.kb-page :deep(.kb-detail-header .admin-page-header-actions) { align-items: center; padding-top: 0; }
.kb-page :deep(.admin-page-header-badge) { align-self: center; }
.kb-tabs { margin-top: 0; }
@media(max-width:900px){.kb-table-wrap{overflow:auto}.kb-table{min-width:760px}}
.kb-badge.ready{background:#edf8f1;color:#21834e}
.kb-switch{position:relative}
.kb-switch input:focus-visible + span{outline:2px solid #2457e6;outline-offset:3px}
.kb-action-menu{position:relative}.kb-action-menu .kb-menu-trigger{display:grid;place-items:center;width:32px;height:32px;border:1px solid #e1e6ee;border-radius:8px;background:#fff;color:#667085;cursor:pointer;list-style:none}.kb-action-menu .kb-menu-trigger::-webkit-details-marker{display:none}.kb-action-menu-panel{position:absolute;z-index:10;right:0;top:37px;display:grid;min-width:138px;padding:5px;border:1px solid #e5e9f0;border-radius:9px;background:#fff;box-shadow:0 10px 26px rgba(23,32,51,.14)}.kb-action-menu-panel button{padding:9px 11px;border:0;border-radius:5px;background:transparent;color:#475467;text-align:left;cursor:pointer}.kb-action-menu-panel button:hover{background:#eff4ff;color:#2457e6}
.kb-switch{display:inline-flex;align-items:center;gap:7px;cursor:pointer}.kb-switch input{position:absolute;width:1px;height:1px;opacity:0}.kb-switch span{position:relative;display:inline-block;width:34px;height:20px;border-radius:10px;background:#cbd3df;transition:.18s}.kb-switch span::after{position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #18223035;content:'';transition:.18s}.kb-switch.on span{background:#29a46a}.kb-switch.on span::after{transform:translateX(14px)}.kb-switch em{color:#687588;font-size:11px;font-style:normal}.kb-muted-dash{color:#a3adba}
.kb-document-detail{padding-top:20px}.kb-document-detail-meta{display:flex;align-items:center;gap:16px;padding:17px 0;border-bottom:1px solid #e7eaf0}.kb-document-detail-meta>div:not(.kb-document-detail-status){flex:1;min-width:0}.kb-document-detail-meta p{margin:5px 0 0;color:#8490a0;font-size:12px}.kb-document-detail-status{display:flex;align-items:center;gap:14px}.kb-document-detail-toolbar{display:flex;align-items:center;justify-content:space-between;margin:25px 0 14px}.kb-document-detail-toolbar h2{margin:0;color:#25324a;font-size:16px}.kb-document-detail-toolbar p{margin:5px 0 0;color:#8a96a8;font-size:11px}.kb-document-chunk{position:relative;margin:12px 0;padding:18px 20px;border:1px solid #e5e9ef;border-radius:10px;background:#fff}.kb-document-chunk header{display:flex;align-items:center;gap:12px;padding-bottom:11px;border-bottom:1px solid #f0f2f5;font-size:12px;color:#7b8798}.kb-document-chunk header strong{color:#526078}.kb-document-chunk header span{color:#687588}.kb-document-chunk header small{margin-left:auto;color:#a0a9b6;font-size:10px}.kb-document-chunk p{margin:14px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;color:#344054;font-size:13px;line-height:1.85}
</style>
