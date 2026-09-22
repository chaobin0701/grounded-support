<script setup lang="ts">
import { ArrowLeft, FileText, MessageSquareText, Plus, Search, Settings2, Upload } from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import { request, type DocumentItem } from './admin-api';
import UiDialog from './ui/UiDialog.vue';

type Config = { indexMode: 'economy' | 'high_quality'; retrievalMode: 'fulltext' | 'vector' | 'hybrid';
  chunkMode: 'general' | 'parent_child'; chunkChars: number; overlapChars: number; parentChars: number;
  childChars: number; childOverlapChars: number; embeddingProfileId: number | null; lexicalThreshold: number; vectorThreshold: number };
type Base = { id: number; name: string; description: string; isDefault: boolean; enabledForChat: boolean;
  archivedAt: string | null; createdAt: string; updatedAt: string; documentCount: number;
  draftConfig: Partial<Config>; activeIndexVersionId: number | null };
type Version = { id: number; status: string; chunkCount: number; errorMessage: string | null; createdAt: string };
type Faq = { id: number; documentId: number; question: string; answer: string; category: string; source: string };
type Preview = { ordinal: number; kind: string; parentOrdinal: number | null; headingPath: string; content: string; sourceLocator: { type: string; start: number; end: number } };
type SearchResult = { hits: { chunkId: number; documentTitle: string; headingPath: string; content: string; score: number }[];
  versionIds: number[]; embeddingCalls: number; durationMs: number };
type Profile = { id: number; name: string; enabled: boolean; config: { model: string; dimensions: number; provider: string } };
const props = defineProps<{ token: string; permissions: string[] }>();
const can = (permission: string) => props.permissions.includes(permission);
const canManage = computed(() => can('knowledge_bases.manage'));
const defaults: Config = { indexMode: 'economy', retrievalMode: 'fulltext', chunkMode: 'general', chunkChars: 800,
  overlapChars: 60, parentChars: 2400, childChars: 500, childOverlapChars: 50, embeddingProfileId: null, lexicalThreshold: 0.15, vectorThreshold: 0.3 };
const bases = ref<Base[]>([]); const selected = ref<number | null>(null);
const current = computed(() => bases.value.find((b) => b.id === selected.value));
const config = ref<Config>({ ...defaults }); const name = ref('');
const documents = ref<DocumentItem[]>([]); const versions = ref<Version[]>([]); const faqs = ref<Faq[]>([]); const profiles = ref<Profile[]>([]);
const busy = ref(false); const error = ref(''); const notice = ref('');
const dialog = ref<'create' | 'upload' | null>(null);
const viewMode = ref<'directory' | 'workspace'>('directory');
const inspectorTab = ref<'overview' | 'documents' | 'settings'>('overview');
const listQuery = ref('');
const listStatus = ref<'all' | 'enabled' | 'disabled'>('all');
const listSort = ref<'updated' | 'name'>('updated');
const showArchived = ref(false);
const tab = ref<'documents' | 'config' | 'versions' | 'search' | 'faq'>('documents');
const preview = ref<Preview[]>([]); const files = ref<File[]>([]);
const query = ref(''); const searchResult = ref<SearchResult | null>(null);
const diagnosticVersion = ref<number | null>(null);
const faqForm = ref({ question: '', answer: '', category: '', source: '' }); const editingFaq = ref<number | null>(null);
const csv = ref('');
const profileForm = ref({ name: '', config: { provider: 'volcengine-multimodal', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  model: 'doubao-embedding-vision-251215', dimensions: 2048, maxInputChars: 8000, batchSize: 16, secretRef: 'default' } });
const activeDocuments = computed(() => documents.value.filter((document) => !document.archivedAt));
const visibleDocuments = computed(() => showArchived.value ? documents.value : activeDocuments.value);
const legacyDocuments = computed(() => activeDocuments.value.filter((document) =>
  document.sourceType !== 'faq' && document.status === 'ready' && !document.parserVersion,
));
const waitingDocuments = computed(() => activeDocuments.value.filter((document) => ['queued', 'processing', 'failed', 'extracted'].includes(document.status)));
const buildReady = computed(() => activeDocuments.value.length > 0 && legacyDocuments.value.length === 0 && waitingDocuments.value.length === 0);
const activeVersion = computed(() => versions.value.find((version) => version.id === current.value?.activeIndexVersionId));
const filteredBases = computed(() => {
  const keyword = listQuery.value.trim().toLowerCase();
  return bases.value.filter((base) => {
    const matchesQuery = !keyword || `${base.name}${base.description}`.toLowerCase().includes(keyword);
    const matchesStatus = listStatus.value === 'all'
      || (listStatus.value === 'enabled' && base.enabledForChat && !base.archivedAt)
      || (listStatus.value === 'disabled' && (!base.enabledForChat || !!base.archivedAt));
    return matchesQuery && matchesStatus;
  }).sort((left, right) => listSort.value === 'name'
    ? left.name.localeCompare(right.name, 'zh-CN')
    : new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
});
const activeProfile = computed(() => profiles.value.find((profile) => profile.id === config.value.embeddingProfileId));
const retrievalLabel = computed(() => ({ fulltext: '全文检索', vector: '向量检索', hybrid: '混合检索' }[config.value.retrievalMode]));
function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
async function selectBase(id: number) {
  selected.value = id;
  inspectorTab.value = 'overview';
  await run(loadDetails);
}
function openWorkspace(nextTab: typeof tab.value = 'documents') {
  tab.value = nextTab;
  viewMode.value = 'workspace';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function documentStatus(document: DocumentItem): string {
  if (document.archivedAt) return '已下架';
  if (document.parserVersion || document.sourceType === 'faq') return '可构建';
  return ({ ready: '需重新解析', queued: '等待处理', processing: '处理中', extracted: '等待分段', failed: '处理失败' } as Record<string, string>)[document.status] || document.status;
}
function documentError(message: string | null): string {
  if (!message) return '';
  if (message.includes('no selectable text')) return 'PDF 没有可选择的文字；扫描版 PDF 暂不支持。';
  return message;
}
const api = <T,>(path = '', method = 'GET', body?: unknown) => request<T>(`/knowledge-bases${path}`,
  { method, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) }, props.token);
async function run(work: () => Promise<void>, success = '') {
  if (busy.value) return;
  busy.value = true; error.value = ''; notice.value = '';
  try { await work(); notice.value = success; } catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败'; }
  finally { busy.value = false; }
}
async function reload() {
  bases.value = await api<Base[]>();
  if (selected.value === null) selected.value = bases.value.find((b) => !b.archivedAt)?.id ?? null;
  if (canManage.value) profiles.value = await api<Profile[]>('/embedding-profiles');
  await loadDetails();
}
async function loadDetails() {
  preview.value = []; searchResult.value = null; diagnosticVersion.value=null;
  config.value = { ...defaults, ...current.value?.draftConfig };
  if (!selected.value || !can('documents.read')) return;
  [documents.value, versions.value, faqs.value] = await Promise.all([
    api<DocumentItem[]>(`/${selected.value}/documents`), api<Version[]>(`/${selected.value}/versions`), api<Faq[]>(`/${selected.value}/faqs`),
  ]);
}
async function createBase() {
  await run(async () => { const base = await api<Base>('', 'POST', { name: name.value }); selected.value = base.id; name.value = ''; await reload(); }, '知识库已创建，默认不参与访客问答。');
  if (!error.value) dialog.value = 'upload';
}
async function saveConfig() {
  await run(async () => {
    const value = { ...config.value };
    if (value.indexMode === 'economy') { value.retrievalMode = 'fulltext'; value.embeddingProfileId = null; }
    await api(`/${selected.value}/config`, 'PATCH', value); await reload();
  }, '草稿已保存；构建并启用新版本后生效。');
}
async function upload() {
  const selectedFiles = [...files.value];
  await run(async () => {
    if (!selectedFiles.length) return;
    const results = await Promise.allSettled(selectedFiles.map((selectedFile) => {
      const data = new FormData(); data.append('file', selectedFile);
      return api(`/${selected.value}/documents`, 'POST', data);
    }));
    files.value = [];
    await loadDetails();
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed) throw new Error(`${selectedFiles.length - failed} 份资料已上传，${failed} 份上传失败，请单独重试。`);
  }, `${selectedFiles.length} 份资料已进入解析队列。`);
  if (!error.value) dialog.value = null;
}
async function documentAction(id: number, action: 'archive' | 'reprocess') { await run(async () => {
  await api(`/${selected.value}/documents/${id}/${action}`, action === 'archive' ? 'PATCH' : 'POST'); await loadDetails();
}, action === 'archive' ? '资料已下架，所有版本立即停止检索该资料。' : '已加入解析队列。'); }
async function reprocessAll() {
  let queued = 0;
  await run(async () => {
    const result = await api<{ queued: number }>(`/${selected.value}/documents/reprocess`, 'POST');
    queued = result.queued;
    await loadDetails();
  });
  if (!error.value) notice.value = queued ? `已将 ${queued} 份资料加入解析队列。` : '没有需要重新解析的资料。';
}
async function publish(id: number) { await run(async () => { await api(`/${selected.value}/versions/${id}/activate`, 'POST'); await reload(); }, `已启用版本 #${id}。`); }
async function saveFaq() { await run(async () => {
  await api(`/${selected.value}/faqs${editingFaq.value ? `/${editingFaq.value}` : ''}`, editingFaq.value ? 'PATCH' : 'POST', faqForm.value);
  editingFaq.value = null; faqForm.value = { question: '', answer: '', category: '', source: '' }; await loadDetails();
}, 'FAQ 已保存；重新构建并启用索引后参与问答。'); }
function editFaq(faq: Faq) { editingFaq.value = faq.id; faqForm.value = { question: faq.question, answer: faq.answer, category: faq.category, source: faq.source }; }
async function downloadDocument(doc: DocumentItem) {
  await run(async()=>{
    const response=await fetch(`/api/admin/knowledge-bases/${selected.value}/documents/${doc.id}/file`,{headers:{Authorization:`Bearer ${props.token}`}});
    if(!response.ok)throw new Error(`下载失败（${response.status}）`);
    const url=URL.createObjectURL(await response.blob());
    const link=document.createElement('a');link.href=url;link.download=doc.originalFilename;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
}
onMounted(() => run(reload));
</script>

<template>
  <section class="kb-workspace">
    <div v-if="viewMode === 'directory'" class="admin-heading kb-directory-heading"><div><h1>知识库</h1><p>管理企业知识库、维护文档并配置检索策略。</p></div><button v-if="canManage" class="admin-primary" @click="dialog = 'create'"><Plus :size="16" /> 新建知识库</button></div>
    <p v-if="error" class="admin-error" role="alert">{{ error }}</p><p v-if="notice" class="admin-notice" role="status">{{ notice }}</p>
    <template v-if="viewMode === 'directory'">
      <div class="kb-directory-toolbar">
        <select v-model="listStatus" aria-label="知识库状态"><option value="all">全部知识库</option><option value="enabled">问答已启用</option><option value="disabled">问答未启用</option></select>
        <label><Search :size="16" /><input v-model="listQuery" placeholder="搜索知识库名称或描述" /></label>
        <span>{{ filteredBases.length }} 个知识库</span><select v-model="listSort" aria-label="排序方式"><option value="updated">按更新时间</option><option value="name">按名称</option></select>
        <button :disabled="busy" @click="run(reload)">刷新</button>
      </div>
      <div class="kb-directory">
        <div class="kb-directory-main">
          <div class="kb-directory-table">
            <table>
              <thead><tr><th class="kb-select-cell"></th><th>名称</th><th>文档</th><th>索引方式</th><th>当前版本</th><th>问答状态</th><th>更新时间</th><th></th></tr></thead>
              <tbody>
                <tr v-for="base in filteredBases" :key="base.id" :class="{ selected: selected === base.id }" @click="selectBase(base.id)">
                  <td class="kb-select-cell"><input type="radio" name="selected-knowledge-base" :checked="selected === base.id" :aria-label="`选择 ${base.name}`" @click.stop @change="selectBase(base.id)" /></td>
                  <td><button class="kb-base-link" @click.stop="selectBase(base.id).then(() => openWorkspace('documents'))"><strong>{{ base.name }}</strong><small>{{ base.description || '尚未添加知识库说明' }}</small></button></td>
                  <td>{{ base.documentCount }}</td>
                  <td>{{ base.draftConfig?.indexMode === 'high_quality' ? ({ fulltext: '全文检索', vector: '向量检索', hybrid: '混合检索' }[base.draftConfig?.retrievalMode || 'hybrid']) : '经济检索' }}</td>
                  <td>{{ base.activeIndexVersionId ? `#${base.activeIndexVersionId}` : '未发布' }}</td>
                  <td><span class="kb-state" :class="base.enabledForChat && !base.archivedAt ? 'ready' : 'archived'">{{ base.archivedAt ? '已归档' : base.enabledForChat ? '已启用' : '未启用' }}</span></td>
                  <td>{{ formatDate(base.updatedAt) }}</td>
                  <td><button class="kb-row-action" @click.stop="selectBase(base.id).then(() => openWorkspace('documents'))">管理</button></td>
                </tr>
              </tbody>
            </table>
            <div v-if="!filteredBases.length" class="kb-directory-empty">没有匹配的知识库。</div>
          </div>
        </div>
        <aside v-if="current" class="kb-directory-inspector" aria-label="知识库详情">
          <div class="kb-inspector-title"><span><FileText :size="21" /></span><div><strong>{{ current.name }}</strong><small>{{ current.description || '尚未添加说明' }}</small></div><span class="kb-state" :class="current.enabledForChat && !current.archivedAt ? 'ready' : 'archived'">{{ current.enabledForChat && !current.archivedAt ? '已启用' : '未启用' }}</span></div>
          <nav class="kb-inspector-tabs"><button :class="{ active: inspectorTab === 'overview' }" @click="inspectorTab = 'overview'">概览</button><button :class="{ active: inspectorTab === 'documents' }" @click="inspectorTab = 'documents'">文档（{{ current.documentCount }}）</button><button :class="{ active: inspectorTab === 'settings' }" @click="inspectorTab = 'settings'">设置</button></nav>
          <div v-if="inspectorTab === 'overview'" class="kb-inspector-content">
            <section><h3>基本信息</h3><dl><dt>知识库名称</dt><dd>{{ current.name }}</dd><dt>描述</dt><dd>{{ current.description || '尚未添加说明' }}</dd><dt>创建时间</dt><dd>{{ formatDate(current.createdAt) }}</dd><dt>更新时间</dt><dd>{{ formatDate(current.updatedAt) }}</dd></dl></section>
            <section><h3>版本信息</h3><dl><dt>当前版本</dt><dd>{{ current.activeIndexVersionId ? `#${current.activeIndexVersionId}` : '尚未发布' }}</dd><dt>索引分段</dt><dd>{{ activeVersion ? `${activeVersion.chunkCount} 个` : '—' }}</dd></dl></section>
            <section><h3>检索配置</h3><dl><dt>索引方式</dt><dd>{{ config.indexMode === 'high_quality' ? '高质量' : '经济' }}</dd><dt>检索方式</dt><dd>{{ retrievalLabel }}</dd><dt>分段模式</dt><dd>{{ config.chunkMode === 'parent_child' ? '父子分段' : '通用分段' }}</dd><dt>Embedding</dt><dd>{{ activeProfile?.config.model || '未使用' }}</dd></dl></section>
          </div>
          <div v-else-if="inspectorTab === 'documents'" class="kb-inspector-content"><section><h3>最近文档</h3><button v-for="doc in activeDocuments.slice(0, 6)" :key="doc.id" class="kb-inspector-doc" @click="openWorkspace('documents')"><span>{{ doc.title }}</span><small>{{ documentStatus(doc) }}</small></button><p v-if="!activeDocuments.length" class="kb-hint">还没有有效文档。</p></section></div>
          <div v-else class="kb-inspector-content"><section><h3>当前草稿</h3><dl><dt>分段字符数</dt><dd>{{ config.chunkMode === 'general' ? config.chunkChars : config.childChars }}</dd><dt>文本阈值</dt><dd>{{ config.lexicalThreshold }}</dd><dt>向量阈值</dt><dd>{{ config.indexMode === 'high_quality' ? config.vectorThreshold : '不适用' }}</dd></dl></section></div>
          <div class="kb-inspector-actions"><h3>快捷操作</h3><button v-if="can('documents.upload') && !current.archivedAt" class="primary" @click="dialog = 'upload'"><Upload :size="16" /> 上传文档</button><button @click="openWorkspace('search')"><MessageSquareText :size="16" /> 测试问答</button><button @click="openWorkspace('config')"><Settings2 :size="16" /> 管理配置</button></div>
        </aside>
      </div>
    </template>
    <template v-else>
      <div class="kb-workspace-heading"><button @click="viewMode = 'directory'"><ArrowLeft :size="17" /> 返回知识库</button><div><p class="section-label">知识库工作区</p><h1>{{ current?.name }}</h1><p>{{ current?.description || '管理资料、索引版本与访客问答范围。' }}</p></div><button v-if="can('documents.upload') && current && !current.archivedAt" class="admin-primary" @click="dialog = 'upload'"><Upload :size="16" /> 上传资料</button></div>
      <div v-if="current" class="kb-detail">
      <div class="kb-detail-head"><div><p class="section-label">当前知识库</p><h2>{{ current.name }}</h2><p>{{ current.description || '尚未添加说明' }}</p></div><span class="kb-state" :class="current.enabledForChat ? 'ready' : 'archived'">{{ current.enabledForChat ? '问答已启用' : '问答已关闭' }}</span></div>
      <div class="kb-status"><span>当前索引：{{ activeVersion ? `版本 #${activeVersion.id} · ${activeVersion.chunkCount} 个分段` : '未发布' }}</span><span>访客问答：{{ current.enabledForChat ? '已启用' : '已关闭' }}</span>
        <button v-if="canManage && !current.archivedAt" :disabled="busy || (!current.enabledForChat && !activeVersion)" :title="!current.enabledForChat && !activeVersion ? '请先构建并启用一个索引版本' : ''" @click="run(async () => { await api(`/${selected}`, 'PATCH', { enabledForChat: !current?.enabledForChat }); await reload(); })">{{ current.enabledForChat ? '停止参与问答' : activeVersion ? '参与访客问答' : '发布索引后可启用' }}</button>
        <button v-if="canManage && !current.isDefault && !current.archivedAt" :disabled="busy" @click="run(async () => { await api(`/${selected}/archive`, 'POST'); await reload(); })">归档知识库</button>
      </div>
      <div class="kb-flow" aria-label="知识库操作步骤">
        <button :class="{ complete: activeDocuments.length > 0, active: tab === 'documents' }" @click="tab = 'documents'"><b>1</b><span>准备资料<small>{{ activeDocuments.length ? `${activeDocuments.length} 份资料` : '上传或添加 FAQ' }}</small></span></button>
        <button :class="{ complete: buildReady, active: tab === 'config' }" @click="tab = 'config'"><b>2</b><span>配置索引<small>{{ config.chunkMode === 'parent_child' ? '父子分段' : '通用分段' }}</small></span></button>
        <button :class="{ complete: !!activeVersion, active: tab === 'versions' }" @click="tab = 'versions'"><b>3</b><span>构建与发布<small>{{ activeVersion ? `当前 #${activeVersion.id}` : '尚未发布' }}</small></span></button>
        <button :class="{ active: tab === 'search' }" @click="tab = 'search'"><b>4</b><span>检索验证<small>发布前可测试</small></span></button>
      </div>
      <nav class="kb-tabs" aria-label="知识库管理"><button v-for="item in ([['documents','资料'],['config','分段与检索'],['versions','索引版本'],['search','检索验证'],['faq','FAQ']] as const)" :key="item[0]" :aria-current="tab === item[0] ? 'page' : undefined" @click="tab = item[0]">{{ item[1] }}</button></nav>
      <div v-if="tab === 'documents'">
        <div class="kb-section-head"><div><h3>资料</h3><p>{{ activeDocuments.length }} 份有效资料；上传、检查解析状态并预览分段。</p></div><div class="kb-heading-actions"><button v-if="documents.some(document => document.archivedAt)" @click="showArchived = !showArchived">{{ showArchived ? '隐藏已下架' : '查看已下架' }}</button><button v-if="can('documents.upload') && !current.archivedAt" class="admin-primary" @click="dialog = 'upload'">上传资料</button></div></div>
        <div v-if="legacyDocuments.length || waitingDocuments.length" class="kb-readiness" :class="{ warning: legacyDocuments.length || waitingDocuments.length }">
          <div><strong>{{ legacyDocuments.length ? `${legacyDocuments.length} 份旧资料尚未准备` : `${waitingDocuments.length} 份资料正在处理` }}</strong><p v-if="legacyDocuments.length">旧资料只有历史分段，需重新解析为 Block 后才能构建 V1 索引。</p><p v-else>处理完成后会自动显示为“可构建”；刷新即可更新状态。</p></div>
          <button v-if="legacyDocuments.length && can('documents.reprocess')" :disabled="busy" @click="reprocessAll">一键重新解析 {{ legacyDocuments.length }} 份资料</button>
        </div>
        <p class="kb-hint">支持 Markdown、Word 和可选中文字的 PDF。只有“可构建”的资料会进入新版本；下架的资料立即从所有版本中排除。</p>
        <div class="kb-table"><table><thead><tr><th>资料</th><th>准备状态</th><th>操作</th></tr></thead><tbody><tr v-for="doc in visibleDocuments" :key="doc.id"><td>{{ doc.title }}<small>{{ doc.originalFilename }}</small></td><td><span class="kb-state" :class="doc.archivedAt ? 'archived' : doc.parserVersion || doc.sourceType === 'faq' ? 'ready' : doc.status">{{ documentStatus(doc) }}</span><small v-if="doc.errorMessage">{{ documentError(doc.errorMessage) }}</small></td><td><button v-if="doc.parserVersion || doc.sourceType === 'faq'" :disabled="busy" @click="run(async () => { preview = await api<Preview[]>(`/${selected}/documents/${doc.id}/preview`); })">预览分段</button> <button v-if="can('documents.reprocess') && doc.sourceType !== 'faq' && !doc.archivedAt" :disabled="busy" @click="documentAction(doc.id,'reprocess')">{{ doc.parserVersion ? '重新解析' : '准备资料' }}</button> <button v-if="doc.originalFilename !== 'FAQ'" :disabled="busy" @click="downloadDocument(doc)">下载</button> <button v-if="can('documents.archive') && !doc.archivedAt" :disabled="busy" @click="documentAction(doc.id,'archive')">下架</button></td></tr></tbody></table></div>
        <p v-if="!visibleDocuments.length" class="kb-hint">{{ showArchived ? '没有已下架资料。' : '暂无有效资料，请上传文件或添加 FAQ。' }}</p>
        <div v-if="preview.length" class="kb-preview"><h2>草稿分段预览 · {{ preview.length }} 块</h2><details v-for="chunk in preview" :key="chunk.ordinal"><summary>#{{ chunk.ordinal }} · {{ chunk.kind }} · {{ chunk.headingPath }} <span v-if="chunk.parentOrdinal">（父块 #{{ chunk.parentOrdinal }}）</span></summary><small>{{ chunk.sourceLocator.type }} {{ chunk.sourceLocator.start }}–{{ chunk.sourceLocator.end }}</small><pre>{{ chunk.content }}</pre></details></div>
      </div>
      <form v-else-if="tab === 'config'" @submit.prevent="saveConfig">
        <details v-if="canManage"><summary>可用模型配置</summary><p class="kb-hint">停用配置只阻止新的构建；已发布版本仍使用其快照和对应密钥连接。</p><div v-for="profile in profiles" :key="profile.id" class="kb-inline"><span>{{ profile.name }} · {{ profile.enabled ? '启用' : '停用' }}</span><button type="button" :disabled="busy" @click="run(async()=>{ await api(`/embedding-profiles/${profile.id}`,'PATCH',{enabled:!profile.enabled}); profiles=await api<Profile[]>('/embedding-profiles'); })">{{ profile.enabled ? '停用' : '启用' }}</button></div><label>新增配置的凭据引用<input v-model="profileForm.config.secretRef" /></label><p class="kb-hint">default 使用 EMBEDDING_API_KEY；其他引用由部署端 EMBEDDING_CONNECTIONS_JSON 显式注册。</p></details>
        <fieldset :disabled="busy || !canManage || !!current.archivedAt" class="kb-fields"><legend>索引草稿</legend>
          <label>索引方式<select v-model="config.indexMode"><option value="economy">经济 · 不调用 Embedding</option><option value="high_quality">高质量 · 向量索引</option></select></label>
          <label>分段模式<select v-model="config.chunkMode"><option value="general">通用</option><option value="parent_child">父子 · 子块召回，父块作为证据</option></select></label>
          <template v-if="config.chunkMode === 'general'"><label>分段字符数<input v-model.number="config.chunkChars" type="number" min="200" max="4000" /></label><label>重叠字符数<input v-model.number="config.overlapChars" type="number" min="0" max="400" /></label></template>
          <template v-else><label>父块字符上限<input v-model.number="config.parentChars" type="number" min="500" max="6000" /></label><label>子块字符数<input v-model.number="config.childChars" type="number" min="100" max="2000" /></label><label>子块重叠<input v-model.number="config.childOverlapChars" type="number" min="0" max="200" /></label></template>
          <template v-if="config.indexMode === 'high_quality'"><label>Embedding 配置<select v-model="config.embeddingProfileId"><option :value="null">请选择</option><option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.name }} · {{ profile.config.model }} · {{ profile.config.dimensions }} 维</option></select></label><label>检索模式<select v-model="config.retrievalMode"><option value="fulltext">全文检索</option><option value="vector">向量检索</option><option value="hybrid">混合检索 · RRF</option></select></label><label>向量相似度阈值<input v-model.number="config.vectorThreshold" type="number" min="-1" max="1" step="0.05" /></label></template>
          <label>文本相关度阈值<input v-model.number="config.lexicalThreshold" type="number" min="0" max="1" step="0.01" /></label><button type="submit" class="admin-primary">保存草稿</button>
        </fieldset>
        <details v-if="canManage" class="kb-preview"><summary>添加 Embedding 配置</summary><p class="kb-hint">密钥只从部署环境读取；地址必须与 EMBEDDING_BASE_URL 一致。配置创建后不可修改，版本保留配置快照。</p><div class="kb-fields"><label>名称<input v-model="profileForm.name" /></label><label>协议<select v-model="profileForm.config.provider"><option value="openai-compatible">OpenAI-compatible</option><option value="volcengine-multimodal">火山多模态向量</option></select></label><label>Base URL<input v-model="profileForm.config.baseUrl" /></label><label>模型 ID<input v-model="profileForm.config.model" /></label><label>维度<input v-model.number="profileForm.config.dimensions" type="number" /></label><button type="button" :disabled="busy" @click="run(async () => { await api('/embedding-profiles','POST',profileForm); profiles = await api<Profile[]>('/embedding-profiles'); }, '模型配置已添加。')">添加配置</button></div></details>
      </form>
      <div v-else-if="tab === 'versions'"><p class="kb-hint">构建会冻结当前资料和草稿。新版本 ready 后，先在“检索验证”测试，再手动启用；启用旧版本即可回退。</p><div v-if="!buildReady" class="kb-readiness warning"><div><strong>暂不能构建</strong><p v-if="!activeDocuments.length">请先上传资料或添加 FAQ。</p><p v-else>先完成资料准备：{{ legacyDocuments.length }} 份需重新解析，{{ waitingDocuments.length }} 份正在处理。</p></div><button @click="tab = 'documents'">回到资料准备</button></div><button v-else-if="canManage && !current.archivedAt" class="admin-primary" :disabled="busy || versions.some(v => v.status === 'building')" @click="run(async () => { await api(`/${selected}/versions`,'POST'); await loadDetails(); }, '构建已入队，请刷新查看结果。')">构建新版本</button><div class="kb-table"><table><thead><tr><th>版本</th><th>状态</th><th>分段数</th><th>操作</th></tr></thead><tbody><tr v-for="version in versions" :key="version.id"><td>#{{ version.id }} {{ current.activeIndexVersionId === version.id ? '· 当前' : '' }}</td><td><span class="kb-state" :class="version.status">{{ version.status }}</span><small>{{ version.errorMessage }}</small></td><td>{{ version.chunkCount }}</td><td><button v-if="canManage && version.status === 'ready' && version.id !== current.activeIndexVersionId" :disabled="busy || !!current.archivedAt" @click="publish(version.id)">启用此版本</button></td></tr></tbody></table></div></div>
      <div v-else-if="tab === 'search'">
        <form class="kb-inline" @submit.prevent="run(async () => { searchResult = await api<SearchResult>(`/${selected}/search?q=${encodeURIComponent(query)}${diagnosticVersion ? `&versionId=${diagnosticVersion}` : ''}`); })">
          <label>检索版本<select v-model="diagnosticVersion"><option :value="null">当前活动版本</option><option v-for="version in versions.filter(v=>v.status==='ready')" :key="version.id" :value="version.id">#{{ version.id }} · 可在发布前测试</option></select></label>
          <label>测试问题<input v-model="query" required minlength="2" maxlength="200" /></label><button :disabled="busy">检索</button>
        </form>
        <template v-if="searchResult">
          <p class="kb-hint">版本 {{ searchResult.versionIds.join(', ') || '未发布' }} · {{ searchResult.durationMs }} ms · Embedding 请求 {{ searchResult.embeddingCalls }} 次</p>
          <p v-if="!searchResult.hits.length">没有满足阈值的资料。</p>
          <article v-for="hit in searchResult.hits" :key="hit.chunkId" class="kb-evidence"><h3>{{ hit.documentTitle }} · {{ hit.headingPath }}</h3><small>引用 #{{ hit.chunkId }} · 原始相关度 {{ hit.score.toFixed(3) }}</small><pre>{{ hit.content }}</pre></article>
          <details><summary>查看候选、分数与融合排名</summary><pre>{{ JSON.stringify(searchResult,null,2) }}</pre></details>
        </template>
      </div>
      <div v-else-if="tab === 'faq'"><form v-if="canManage && !current.archivedAt" @submit.prevent="saveFaq" class="kb-fields"><label>问题<input v-model="faqForm.question" required maxlength="200" /></label><label>分类<input v-model="faqForm.category" maxlength="120" /></label><label class="kb-wide">答案<textarea v-model="faqForm.answer" required maxlength="6000" rows="4" /></label><label>来源说明<input v-model="faqForm.source" maxlength="500" /></label><button :disabled="busy">{{ editingFaq ? '保存修改' : '添加 FAQ' }}</button></form><details v-if="canManage"><summary>批量导入 CSV（最多 100 行）</summary><p>表头：question,answer,category,source；包含逗号或换行的字段使用双引号。</p><textarea v-model="csv" rows="5" aria-label="CSV 内容" /><button :disabled="busy || !!current.archivedAt" @click="run(async () => { await api(`/${selected}/faqs/import`,'POST',{ csv }); csv = ''; await loadDetails(); }, 'FAQ 已导入，发布新版本后生效。')">导入</button></details><article v-for="faq in faqs" :key="faq.id" class="kb-evidence"><h3>{{ faq.question }}</h3><pre>{{ faq.answer }}</pre><small>{{ faq.category }} · {{ faq.source }}</small><button v-if="canManage" :disabled="busy" @click="editFaq(faq)">编辑</button></article></div>
      </div>
      <div v-else class="kb-empty"><strong>选择一个知识库</strong><p>从知识库列表选择后再进入工作区。</p></div>
    </template>

    <UiDialog :open="dialog !== null" :title="dialog === 'create' ? '新建知识库' : '导入资料'" :description="dialog === 'create' ? '先创建一个空知识库，随后继续导入文件。' : `向「${current?.name || ''}」添加资料，文件将分别处理。`" :size="dialog === 'upload' ? 'lg' : 'sm'" @update:open="dialog = $event ? dialog : null">
      <form v-if="dialog === 'create'" class="grid gap-5" @submit.prevent="createBase">
        <label class="grid gap-2 text-sm font-medium text-slate-700">知识库名称<input v-model.trim="name" class="ui-input" required maxlength="120" autofocus placeholder="例如：售后服务" /></label>
        <div class="flex justify-end gap-2"><button type="button" class="ui-button" @click="dialog = null">取消</button><button class="ui-button ui-button-primary" :disabled="busy">{{ busy ? '创建中…' : '创建并继续' }}</button></div>
      </form>
      <form v-else class="grid gap-5" @submit.prevent="upload">
        <div class="flex items-center justify-center gap-4 text-xs font-medium text-slate-400"><span class="text-brand-600">① 选择数据源</span><i class="h-px w-10 bg-slate-200"></i><span>② 分段与索引</span><i class="h-px w-10 bg-slate-200"></i><span>③ 处理完成</span></div>
        <label class="kb-file-drop"><input type="file" multiple required accept=".md,.docx,.pdf" @change="files = Array.from(($event.target as HTMLInputElement).files || [])" /><span>{{ files.length ? `已选择 ${files.length} 份资料` : '拖入文件，或点击选择多个文件' }}</span><small>支持 Markdown、DOCX、可选中文字的 PDF · 单个文件不超过 2 MB</small></label>
        <div v-if="files.length" class="max-h-56 divide-y divide-slate-100 overflow-auto rounded-xl border border-slate-200"><div v-for="selectedFile in files" :key="`${selectedFile.name}-${selectedFile.size}`" class="flex items-center justify-between gap-4 px-4 py-3 text-sm"><span class="truncate text-slate-700">{{ selectedFile.name }}</span><small class="m-0 flex-none text-slate-400">{{ (selectedFile.size / 1024).toFixed(0) }} KB</small></div></div>
        <div class="flex justify-end gap-2"><button type="button" class="ui-button" @click="dialog = null">取消</button><button class="ui-button ui-button-primary" :disabled="busy || !files.length">{{ busy ? '上传中…' : `上传 ${files.length || ''} 份资料` }}</button></div>
      </form>
    </UiDialog>
  </section>
</template>

<style scoped>
.kb-workspace { max-width:none; }
.kb-directory-heading { margin-bottom:24px; }
.kb-directory-heading .admin-primary,.kb-workspace-heading .admin-primary { display:inline-flex; align-items:center; gap:8px; }
.kb-directory-toolbar { display:flex; align-items:center; gap:12px; margin-bottom:16px; }
.kb-directory-toolbar > select { width:155px; }
.kb-directory-toolbar > label { position:relative; display:block; width:min(330px,35vw); }
.kb-directory-toolbar > label svg { position:absolute; z-index:1; top:50%; left:12px; transform:translateY(-50%); color:#8b99aa; }
.kb-directory-toolbar > label input { width:100%; padding-left:36px; box-sizing:border-box; }
.kb-directory-toolbar > span { margin-left:auto; color:#8894a3; font-size:12px; }
.kb-directory { display:grid; grid-template-columns:minmax(0,1fr) 350px; min-height:610px; border-top:1px solid #e3e8ef; }
.kb-directory-main { min-width:0; padding-right:20px; }
.kb-directory-table { overflow:auto; }
.kb-directory-table table { min-width:820px; margin:0; }
.kb-directory-table th { height:44px; padding:0 12px; border-color:#edf0f4; color:#667085; font-size:11px; }
.kb-directory-table td { height:68px; padding:8px 12px; border-color:#edf0f4; color:#344054; font-size:12px; }
.kb-directory-table tr { cursor:pointer; transition:background .15s ease; }
.kb-directory-table tbody tr:hover,.kb-directory-table tbody tr.selected { background:#eef4ff; }
.kb-directory-table tr.selected { box-shadow:inset 3px 0 #2457e6; }
.kb-select-cell { width:28px; padding-right:2px !important; }
.kb-select-cell input { width:16px; height:16px; padding:0; accent-color:#2457e6; }
.kb-base-link { display:block; width:100%; min-width:170px; padding:0 !important; border:0 !important; background:transparent !important; text-align:left; }
.kb-base-link strong { display:block; overflow:hidden; color:#1f2a44; font-size:13px; text-overflow:ellipsis; white-space:nowrap; }
.kb-base-link small { max-width:250px; overflow:hidden; margin:4px 0 0; color:#8490a3; text-overflow:ellipsis; white-space:nowrap; }
.kb-row-action { padding:6px 9px !important; color:#2457e6; white-space:nowrap; }
.kb-directory-empty { padding:70px 20px; color:#8b96a8; text-align:center; font-size:13px; }
.kb-directory-inspector { min-width:0; margin-right:-46px; padding:22px 26px 28px; border-left:1px solid #e3e8ef; background:#fff; }
.kb-inspector-title { display:grid; grid-template-columns:36px minmax(0,1fr) auto; align-items:start; gap:10px; padding-bottom:18px; }
.kb-inspector-title > span:first-child { display:grid; width:34px; height:34px; place-items:center; border:1px solid #dce4ee; border-radius:8px; color:#344054; }
.kb-inspector-title strong { display:block; overflow:hidden; color:#172033; font-size:15px; text-overflow:ellipsis; white-space:nowrap; }
.kb-inspector-title small { display:-webkit-box; margin:5px 0 0; overflow:hidden; color:#7c8899; font-size:11px; line-height:1.55; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
.kb-inspector-tabs { display:grid; grid-template-columns:repeat(3,1fr); border-bottom:1px solid #e5eaf0; }
.kb-inspector-tabs button { border:0; border-radius:0; background:transparent; color:#667085; }
.kb-inspector-tabs button.active { margin-bottom:-1px; border-bottom:2px solid #2457e6; color:#2457e6; font-weight:650; }
.kb-inspector-content { min-height:365px; }
.kb-inspector-content section { padding:20px 0; border-bottom:1px solid #edf0f4; }
.kb-inspector-content h3,.kb-inspector-actions h3 { margin:0 0 14px; color:#253047; font-size:13px; }
.kb-inspector-content dl { display:grid; grid-template-columns:92px minmax(0,1fr); gap:11px 12px; margin:0; font-size:12px; line-height:1.55; }
.kb-inspector-content dt { color:#8490a3; }.kb-inspector-content dd { margin:0; color:#344054; overflow-wrap:anywhere; }
.kb-inspector-doc { display:flex; justify-content:space-between; gap:12px; width:100%; padding:10px 0 !important; border:0 !important; border-bottom:1px solid #f0f2f5 !important; border-radius:0 !important; text-align:left; }
.kb-inspector-doc span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.kb-inspector-doc small { flex:none; margin:0; }
.kb-inspector-actions { padding-top:20px; }
.kb-inspector-actions button { display:flex; align-items:center; justify-content:center; gap:8px; width:100%; margin-top:9px; color:#2457e6; }
.kb-inspector-actions button.primary { border-color:#2457e6; background:#2457e6; color:#fff; }
.kb-workspace-heading { display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:start; gap:18px; margin-bottom:28px; padding-bottom:24px; border-bottom:1px solid #e3e8ef; }
.kb-workspace-heading > button:first-child { display:flex; align-items:center; gap:7px; margin-top:2px; border:0; background:transparent; color:#64748b; }
.kb-workspace-heading h1 { margin:2px 0 7px; color:#172033; font-size:28px; }.kb-workspace-heading p { margin:0; color:#7c8899; font-size:13px; }
.kb-heading-actions { display:flex; gap:8px; }
.kb-layout { display:grid; grid-template-columns:220px minmax(0,1fr); align-items:start; gap:28px; }
.kb-library { position:sticky; top:22px; overflow:hidden; border:1px solid #dde4de; border-radius:10px; background:#fff; }
.kb-library-head { display:flex; justify-content:space-between; padding:14px 14px 10px; color:#52605a; font-size:12px; }.kb-library-head small { margin:0; }
.kb-library > button { display:flex; align-items:center; justify-content:space-between; gap:12px; width:100%; min-height:62px; padding:11px 14px; border:0; border-top:1px solid #edf0ed; border-radius:0; text-align:left; }.kb-library > button:hover,.kb-library > button.active { background:#f0f5f1; }.kb-library > button span { min-width:0; }.kb-library strong { display:block; overflow:hidden; color:#2c4335; font-size:13px; text-overflow:ellipsis; white-space:nowrap; }.kb-library i { flex:0 0 auto; width:7px; height:7px; border-radius:50%; background:#c9d0ca; }.kb-library i.online { background:#3da36f; box-shadow:0 0 0 3px #e3f2e8; }
.kb-detail { min-width:0; }.kb-detail-head { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; padding-bottom:18px; border-bottom:1px solid #e2e7e2; }.kb-detail-head h2 { margin:3px 0 5px; color:#263d30; font-size:22px; letter-spacing:-.02em; }.kb-detail-head p { margin:0; color:#7b897f; font-size:12px; }.kb-detail-head .section-label { margin-bottom:3px; }
.kb-section-head { display:flex; justify-content:space-between; align-items:center; gap:20px; margin:3px 0 18px; }.kb-section-head h3 { margin:0; color:#2c4335; font-size:17px; }.kb-section-head p { margin:5px 0 0; color:#7b897f; font-size:12px; }.kb-empty { min-height:360px; display:grid; align-content:center; justify-items:center; color:#7b897f; }.kb-empty strong { color:#405448; }.kb-empty p { margin:7px 0; font-size:13px; }
.kb-inline,.kb-status { display:flex; align-items:end; gap:16px; flex-wrap:wrap; margin:20px 0; }
.kb-workspace label { display:grid; gap:8px; font-size:13px; color:#52605a; } .kb-selector { max-width:400px; margin:24px 0; }
.kb-workspace input,.kb-workspace select,.kb-workspace textarea { border:1px solid #d8ded8; border-radius:6px; padding:10px 12px; font:inherit; background:white; min-width:0; }
.kb-workspace button { cursor:pointer; padding:9px 12px; border:1px solid #d8ded8; border-radius:6px; background:white; font:inherit; font-size:13px; }
.kb-workspace button:disabled { opacity:.45; cursor:default; } .kb-workspace .admin-primary { background:#2457e6; color:white; border-color:#2457e6; }
.kb-flow { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:1px; margin:12px 0 2px; overflow:hidden; border:1px solid #dce4de; border-radius:10px; background:#dce4de; }
.kb-flow button { min-width:0; min-height:74px; display:flex; align-items:flex-start; gap:10px; border:0; border-radius:0; padding:14px; text-align:left; background:#fff; color:#52605a; }
.kb-flow button:hover,.kb-flow button.active { background:#eef4ff; color:#2457e6; }
.kb-flow button.complete b { background:#2457e6; color:#fff; }
.kb-flow b { flex:0 0 auto; display:grid; place-items:center; width:22px; height:22px; border-radius:50%; background:#e5ebe6; color:#52605a; font-size:12px; }
.kb-flow span { min-width:0; font-size:13px; font-weight:650; line-height:1.35; }.kb-flow small { margin:3px 0 0; font-size:11px; font-weight:400; }
.kb-tabs { display:flex; gap:24px; border-bottom:1px solid #d8ded8; margin:28px 0; overflow:auto; }
.kb-tabs button { border:0; border-radius:0; background:none; white-space:nowrap; padding:12px 0; color:#69756e; }
.kb-tabs button[aria-current] { color:#2457e6; border-bottom:2px solid #2457e6; font-weight:600; }
.kb-status,.kb-hint { font-size:13px; color:#69756e; line-height:1.7; } .kb-fields { border:0; padding:0; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:20px; margin:24px 0; } .kb-fields legend { font-size:16px; font-weight:600; margin-bottom:16px; } .kb-wide { grid-column:1/-1; }
.kb-readiness { display:flex; align-items:center; justify-content:space-between; gap:20px; margin:20px 0; padding:16px 18px; border:1px solid #dce4de; border-radius:8px; background:#f8faf8; }.kb-readiness.warning { border-color:#ead8a4; background:#fffaf0; }.kb-readiness p { margin:5px 0 0; color:#69756e; font-size:13px; line-height:1.6; }.kb-readiness button { flex:0 0 auto; }
.kb-table { overflow:auto; margin:24px 0; } table { width:100%; border-collapse:collapse; text-align:left; font-size:14px; } th,td { padding:14px 8px; border-bottom:1px solid #e5e9e4; } th { color:#69756e; font-size:12px; font-weight:500; }
.kb-state { display:inline-flex; align-items:center; min-height:22px; padding:0 7px; border-radius:999px; background:#edf2ee; color:#315947; font-size:12px; }.kb-state.queued,.kb-state.processing,.kb-state.extracted,.kb-state.building { background:#fff3d7; color:#8a6100; }.kb-state.failed { background:#fde8e7; color:#a33632; }.kb-state.archived { background:#eef0ef; color:#69756e; }
.kb-file-drop { position:relative; min-height:130px; place-items:center; align-content:center; border:1px dashed #aebbd4; border-radius:12px; background:#f8faff; cursor:pointer; text-align:center; }.kb-file-drop input { position:absolute; width:1px; height:1px; opacity:0; }.kb-file-drop span { color:#2457e6; font-weight:600; }.kb-file-drop small { margin-top:8px; font-weight:400; }.kb-file-drop:hover { border-color:#6487ef; background:#f1f5ff; }
small { display:block; color:#69756e; margin:6px 0; } pre { white-space:pre-wrap; overflow-wrap:anywhere; font:inherit; line-height:1.8; font-size:14px; } .kb-preview,.kb-evidence { margin:24px 0; padding-top:20px; border-top:1px solid #e5e9e4; } details { padding:12px 0; } summary { cursor:pointer; } .kb-workspace textarea { width:100%; box-sizing:border-box; }
@media(max-width:1100px) { .kb-directory { grid-template-columns:minmax(0,1fr) 310px; }.kb-directory-inspector { margin-right:0; padding:20px; } }
@media(max-width:900px) { .kb-directory { display:block; }.kb-directory-main { padding-right:0; }.kb-directory-inspector { margin-top:20px; border:1px solid #e3e8ef; border-radius:10px; }.kb-inspector-content { min-height:0; }.kb-layout { grid-template-columns:1fr; }.kb-library { position:static; display:flex; overflow-x:auto; }.kb-library-head { display:none; }.kb-library > button { min-width:180px; border-top:0; border-right:1px solid #edf0ed; } }
@media(max-width:700px) { .kb-directory-toolbar { align-items:stretch; flex-wrap:wrap; }.kb-directory-toolbar > select,.kb-directory-toolbar > label { width:100%; }.kb-directory-toolbar > span { margin-left:0; }.kb-directory-main { overflow:hidden; }.kb-directory-inspector { padding:18px; }.kb-workspace-heading { grid-template-columns:1fr auto; }.kb-workspace-heading > button:first-child { grid-column:1/-1; justify-self:start; }.kb-flow { grid-template-columns:1fr 1fr; }.kb-readiness { align-items:flex-start; flex-direction:column; gap:12px; }.kb-fields { grid-template-columns:1fr; } .kb-tabs { gap:18px; }.kb-detail-head { align-items:flex-start; flex-direction:column; } }
</style>
