<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { Check, CheckCircle2, ChevronRight, Database, ExternalLink, LoaderCircle, LockKeyhole, PlugZap, Plus, RefreshCw, ShieldCheck, Trash2, XCircle } from '@lucide/vue';
import { adminApi, type EmbeddingConnectionResult, type EmbeddingPlatform, type EmbeddingPlatformPreset, type EmbeddingProfileInput, type EmbeddingProfileItem, type EmbeddingUsage } from './admin-api';
import AdminPageHeader from './ui/AdminPageHeader.vue';
import ModelPlatformLogo from './ui/ModelPlatformLogo.vue';
import UiDialog from './ui/UiDialog.vue';

const props = defineProps<{ token: string; canManage: boolean; canReadKnowledge: boolean }>();
const emit = defineEmits<{ notice: [message: string]; error: [message: string] }>();
const profiles = ref<EmbeddingProfileItem[]>([]);
const platforms = ref<EmbeddingPlatformPreset[]>([]);
const loading = ref(false);
const loadError = ref('');
const saving = ref(false);
const testing = ref(false);
const actionBusy = ref(false);
const dialogOpen = ref(false);
const editingId = ref<number | null>(null);
const selected = computed(() => profiles.value.find(p => p.id === editingId.value));
const geometryLocked = computed(() => selected.value?.geometryLocked ?? false);
const working = computed(() => saving.value || testing.value || actionBusy.value);
const formElement = ref<HTMLFormElement | null>(null);
const form = ref<EmbeddingProfileInput>({ name:'',platformKey:'volcengine',provider:'volcengine-multimodal',baseUrl:'',model:'',dimensions:2048,timeoutMs:30000,maxInputChars:8000,batchSize:16,apiKey:'' });
const resultOpen = ref(false);
const result = ref<EmbeddingConnectionResult | null>(null);
const testedModel = ref('');
const deleteOpen = ref(false);
const deleteError = ref('');
const usageOpen = ref(false);
const usageLoading = ref(false);
const usageError = ref('');
const usage = ref<EmbeddingUsage[]>([]);
const usageName = ref('');
let mounted = true;
let loadSequence = 0;
let usageSequence = 0;
const label = (key: EmbeddingPlatform) => platforms.value.find(p => p.key === key)?.label ?? key;
const status = (p: EmbeddingProfileItem) => !p.enabled ? '已停用' : p.usageCount ? `被 ${p.usageCount} 个知识库使用` : '未使用';
const groups = computed(() => [
  { key:'used',title:'使用中的配置',items:profiles.value.filter(p => p.enabled && p.usageCount > 0) },
  { key:'other',title:'其他配置',items:profiles.value.filter(p => !p.enabled || !p.usageCount) },
].filter(g => g.items.length));

async function load() {
  const sequence = ++loadSequence;
  loading.value = true; loadError.value = '';
  try {
    const [items,meta] = await Promise.all([adminApi.embeddingProfiles(props.token),adminApi.embeddingMetadata(props.token)]);
    if (mounted && sequence === loadSequence) { profiles.value = items; platforms.value = meta.platforms; }
  } catch (cause) { if (mounted && sequence === loadSequence) loadError.value = cause instanceof Error ? cause.message : '配置加载失败'; }
  finally { if (mounted && sequence === loadSequence) loading.value = false; }
}
function selectPlatform(key: EmbeddingPlatform) {
  if (editingId.value !== null || working.value) return;
  const preset = platforms.value.find(p => p.key === key);
  if (!preset) return;
  form.value = { ...form.value,platformKey:key,provider:preset.provider,baseUrl:preset.baseUrl,model:preset.model,dimensions:preset.dimensions,apiKey:'' };
}
function create() {
  if (working.value || !props.canManage) return;
  editingId.value = null;
  form.value = { name:'',platformKey:'volcengine',provider:'volcengine-multimodal',baseUrl:'',model:'',dimensions:2048,timeoutMs:30000,maxInputChars:8000,batchSize:16,apiKey:'' };
  selectPlatform('volcengine'); dialogOpen.value = true;
}
function edit(p: EmbeddingProfileItem) {
  if (working.value) return;
  editingId.value = p.id;
  const c = p.config;
  form.value = { name:p.name,platformKey:p.platformKey,provider:c.provider,baseUrl:c.baseUrl,model:c.model,dimensions:c.dimensions,timeoutMs:c.timeoutMs,maxInputChars:c.maxInputChars,batchSize:c.batchSize,apiKey:'' };
  dialogOpen.value = true;
}
function input(): EmbeddingProfileInput { return { ...form.value,apiKey:form.value.apiKey?.trim() || undefined }; }
async function save() {
  if (working.value || !props.canManage || !formElement.value?.reportValidity()) return;
  saving.value = true;
  try {
    if (editingId.value === null) await adminApi.createEmbeddingProfile(props.token,input());
    else await adminApi.updateEmbeddingProfile(props.token,editingId.value,input());
    if (!mounted) return;
    dialogOpen.value = false; emit('notice','Embedding 配置已保存'); await load();
  } catch (cause) { if (mounted) emit('error',cause instanceof Error ? cause.message : '保存失败'); }
  finally { if (mounted) saving.value = false; }
}
async function testConnection() {
  if (working.value || !props.canManage || !formElement.value?.reportValidity()) return;
  testing.value = true; result.value = null; testedModel.value = form.value.model; resultOpen.value = true;
  try {
    const response = await adminApi.testEmbeddingConnection(props.token,{...input(),profileId:editingId.value ?? undefined});
    if (mounted) result.value = response;
  } catch (cause) { if (mounted) result.value = {ok:false,message:cause instanceof Error ? cause.message : '连接测试失败'}; }
  finally { if (mounted) testing.value = false; }
}
async function toggle() {
  if (working.value || !selected.value || !props.canManage) return;
  actionBusy.value = true;
  try { await adminApi.setEmbeddingStatus(props.token,selected.value.id,!selected.value.enabled); if (mounted) { emit('notice','配置状态已更新'); await load(); } }
  catch (cause) { if (mounted) emit('error',cause instanceof Error ? cause.message : '更新失败'); }
  finally { if (mounted) actionBusy.value = false; }
}
async function remove() {
  if (working.value || !selected.value || !props.canManage) return;
  actionBusy.value = true; deleteError.value = '';
  try { await adminApi.deleteEmbeddingProfile(props.token,selected.value.id); if (mounted) { deleteOpen.value = false; dialogOpen.value = false; emit('notice','Embedding 配置已删除'); await load(); } }
  catch (cause) { if (mounted) deleteError.value = cause instanceof Error ? cause.message : '删除失败'; }
  finally { if (mounted) actionBusy.value = false; }
}
async function showUsage(p: EmbeddingProfileItem) {
  const sequence = ++usageSequence;
  usage.value = []; usageName.value = p.name; usageError.value = ''; usageLoading.value = true; usageOpen.value = true;
  try { const response = await adminApi.embeddingUsage(props.token,p.id); if (mounted && sequence === usageSequence) usage.value = response; }
  catch (cause) { if (mounted && sequence === usageSequence) usageError.value = cause instanceof Error ? cause.message : '使用关系加载失败'; }
  finally { if (mounted && sequence === usageSequence) usageLoading.value = false; }
}
watch(dialogOpen, open => { if (!open) form.value.apiKey = ''; });
onMounted(load);
onUnmounted(() => { mounted = false; loadSequence++; usageSequence++; form.value.apiKey = ''; });
</script>

<template>
  <section class="embedding-services-page model-services-page">
    <AdminPageHeader title="Embedding 服务">
      <template #actions>
        <button class="ui-button" type="button" :disabled="loading || working" @click="load"><RefreshCw :size="15" :class="{spinning:loading}" />刷新</button>
        <button v-if="canManage" class="ui-button ui-button-primary" type="button" :disabled="loading || !platforms.length || working" @click="create"><Plus :size="16" />添加配置</button>
      </template>
    </AdminPageHeader>
    <div class="model-service-note"><ShieldCheck :size="17" /><p>统一管理文档与查询的向量模型。每个知识库单独选择配置，更换模型后需构建并应用新索引；密钥更换无需重建。</p></div>
    <div v-if="loadError" class="embedding-error" role="alert">{{ loadError }}<button type="button" class="ui-button" @click="load">重试</button></div>
    <div v-if="loading && !profiles.length" class="model-service-empty" role="status"><LoaderCircle :size="22" class="spinning" /><p>正在加载 Embedding 配置…</p></div>
    <div v-else-if="!loadError && !profiles.length" class="model-service-empty"><Database :size="28" /><h2>还没有 Embedding 配置</h2><p>添加并测试连接后，在知识库设置中选择使用。经济模式不需要向量模型。</p></div>
    <div v-else class="model-service-groups">
      <section v-for="group in groups" :key="group.key" class="model-service-group">
        <header class="model-group-heading"><h2>{{ group.title }}<span>{{ group.items.length }}</span></h2></header>
        <div class="model-service-list">
          <article v-for="profile in group.items" :key="profile.id" class="embedding-card">
            <button class="model-service-card interactive embedding-card-main" type="button" :aria-label="`查看配置：${profile.name}`" @click="edit(profile)">
              <div class="model-service-card-head"><div class="model-service-identity"><div class="model-service-logo"><ModelPlatformLogo :platform="profile.platformKey" :size="23" /></div><div class="model-service-copy"><div class="model-service-title"><h3>{{ profile.name }}</h3><span class="model-status" :class="!profile.enabled ? 'disabled' : profile.usageCount ? 'current' : 'standby'">{{ status(profile) }}</span></div><p>{{ label(profile.platformKey) }} · <span class="model-id">{{ profile.config.model }}</span></p></div></div><ChevronRight :size="16" class="model-card-chevron" /></div>
              <div class="model-card-meta"><span>{{ profile.config.dimensions.toLocaleString() }} 维 · {{ profile.config.timeoutMs / 1000 }}s 超时</span><span>密钥 <code>{{ profile.apiKeyPreview || '未配置' }}</code></span></div>
            </button>
            <footer><button type="button" class="model-text-action" @click="showUsage(profile)"><Database :size="13" />使用关系<span v-if="profile.referenceCount"> · {{ profile.referenceCount }}</span></button><span v-if="profile.keySource === 'environment'">沿用部署环境密钥</span></footer>
          </article>
        </div>
      </section>
    </div>

    <UiDialog v-if="dialogOpen" :open="dialogOpen" :title="canManage ? editingId === null ? '添加 Embedding 服务' : '编辑 Embedding 服务' : 'Embedding 服务详情'" description="平台固定，向量空间由接口、模型和维度共同确定。" size="lg" @update:open="dialogOpen = $event">
      <form ref="formElement" class="model-profile-form" @submit.prevent="save">
        <div v-if="selected" class="model-profile-state"><span class="model-status" :class="selected.enabled ? selected.usageCount ? 'current' : 'standby' : 'disabled'">{{ status(selected) }}</span><button v-if="canManage" type="button" class="model-text-action" :disabled="working || (selected.enabled && selected.usageCount > 0)" @click="toggle">{{ selected.enabled ? '停用配置' : '恢复配置' }}</button></div>
        <section class="model-form-section">
          <h2>{{ editingId === null ? '选择平台' : '服务平台' }}</h2>
          <div v-if="editingId !== null" class="model-platform-locked"><div class="model-platform-identity"><ModelPlatformLogo :platform="form.platformKey" :size="25" /><strong>{{ label(form.platformKey) }}</strong><span><LockKeyhole :size="12" />平台已固定</span></div><p>{{ geometryLocked ? '配置已被引用，接口、模型和维度已锁定。替换模型请新建配置，再到知识库构建并应用新索引。' : '更换平台请新建配置；现有密钥不会复制。' }}</p><button v-if="canManage" type="button" class="ui-button" :disabled="working" @click="create"><Plus :size="14" />新建替代配置</button></div>
          <div v-else class="platform-options embedding-platform-options" role="group" aria-label="Embedding 平台"><button v-for="p in platforms" :key="p.key" type="button" class="platform-option" :class="{selected:form.platformKey === p.key}" :aria-pressed="form.platformKey === p.key" :disabled="working" @click="selectPlatform(p.key)"><ModelPlatformLogo :platform="p.key" :size="25" /><span class="platform-option-copy"><strong>{{ p.label }}</strong><small>{{ p.key === 'volcengine' ? '标准 / 多模态向量接口' : 'OpenAI Compatible 接口' }}</small></span><Check v-if="form.platformKey === p.key" :size="14" class="platform-option-check" /></button></div>
        </section>
        <fieldset class="embedding-fields" :disabled="!canManage || working">
          <section class="model-form-section"><h2>连接信息</h2><div class="model-connection-grid">
            <label class="model-field"><span class="ui-label">配置名称</span><input v-model.trim="form.name" class="ui-input" required maxlength="120" placeholder="例如：产品知识库向量模型" /></label>
            <label class="model-field"><span class="ui-label">模型 ID</span><input v-model.trim="form.model" class="ui-input" required maxlength="200" :readonly="geometryLocked" spellcheck="false" /></label>
            <label class="model-field model-field-wide"><span class="ui-label">Base URL</span><input v-model.trim="form.baseUrl" class="ui-input" type="url" required :readonly="geometryLocked || form.platformKey !== 'custom'" placeholder="https://api.example.com/v1" /><small>自定义 HTTPS 地址需加入服务端 EMBEDDING_ALLOWED_BASE_URLS。</small></label>
            <label class="model-field"><span class="ui-label">接口类型</span><select v-model="form.provider" class="ui-input" :disabled="geometryLocked"><option value="openai-compatible">标准 Embeddings</option><option v-if="form.platformKey === 'volcengine'" value="volcengine-multimodal">火山多模态 Embeddings</option></select></label>
            <label class="model-field"><span class="ui-label">向量维度</span><input v-model.number="form.dimensions" class="ui-input" type="number" min="1" max="4096" required :readonly="geometryLocked" /><small>填写模型实际输出维度，连接测试会校验。</small></label>
            <label class="model-field model-field-wide"><span class="ui-label">API Key</span><input v-model="form.apiKey" class="ui-input" type="password" autocomplete="new-password" :required="editingId === null" :placeholder="editingId === null ? '输入服务密钥' : '留空保留原密钥'" /><small v-if="selected">已保存：{{ selected.apiKeyPreview || '未配置' }}。只在服务端加密保存。</small></label>
          </div></section>
          <section class="model-form-section"><h2>运行参数</h2><label class="model-field embedding-timeout"><span class="ui-label">请求超时（ms）</span><input v-model.number="form.timeoutMs" class="ui-input" type="number" min="1000" max="120000" required /></label><details class="embedding-advanced"><summary>高级参数</summary><div class="model-connection-grid"><label class="model-field"><span class="ui-label">单条输入字符上限</span><input v-model.number="form.maxInputChars" class="ui-input" type="number" min="200" max="32000" required /><small>应覆盖知识库分段长度和标题。</small></label><label class="model-field"><span class="ui-label">批量大小</span><input v-model.number="form.batchSize" class="ui-input" type="number" min="1" max="64" required /><small>火山多模态接口始终逐条请求。</small></label></div></details></section>
        </fieldset>
        <footer class="model-form-footer"><button v-if="selected && canManage" type="button" class="model-delete-action" :disabled="working || selected.referenceCount > 0" :title="selected.referenceCount ? '配置被知识库或历史索引引用，不能删除' : '删除未引用的配置'" @click="deleteError = ''; deleteOpen = true"><Trash2 :size="15" />删除配置</button><div><button v-if="canManage" type="button" class="ui-button" :disabled="working" @click="testConnection"><PlugZap :size="15" />测试连接</button><button type="button" class="ui-button" :disabled="working" @click="dialogOpen = false">{{ canManage ? '取消' : '关闭' }}</button><button v-if="canManage" type="submit" class="ui-button ui-button-primary" :disabled="working"><LoaderCircle v-if="saving" :size="15" class="spinning" />{{ saving ? '保存中…' : '保存配置' }}</button></div></footer>
      </form>
    </UiDialog>
    <UiDialog v-model:open="resultOpen" title="Embedding 连接测试" :description="testedModel" size="md" :layer="70"><div class="model-connection-result" aria-live="polite" role="status"><template v-if="testing"><LoaderCircle :size="30" class="spinning" /><h3>正在发送真实测试请求…</h3><p>测试不会保存配置或更换知识库索引。</p></template><template v-else-if="result"><CheckCircle2 v-if="result.ok" :size="30" class="result-success" /><XCircle v-else :size="30" class="result-failure" /><h3>{{ result.ok ? '连接成功' : '连接未通过' }}</h3><p>{{ result.message }}</p><dl class="embedding-test-metrics"><div v-if="result.expectedDimensions !== undefined"><dt>配置维度</dt><dd>{{ result.expectedDimensions }}</dd></div><div v-if="result.actualDimensions !== undefined"><dt>实际维度</dt><dd>{{ result.actualDimensions }}</dd></div><div v-if="result.durationMs !== undefined"><dt>耗时</dt><dd>{{ result.durationMs }} ms</dd></div></dl></template></div></UiDialog>
    <UiDialog v-model:open="usageOpen" title="知识库使用关系" :description="usageName" size="md" :layer="70"><p v-if="usageLoading" role="status">正在查询使用关系…</p><p v-else-if="usageError" class="embedding-error" role="alert">{{ usageError }}</p><p v-else-if="!usage.length" class="admin-muted">没有知识库或历史索引引用，可以修改向量空间或删除配置。</p><ul v-else class="embedding-usage-list"><li v-for="item in usage" :key="item.id"><div><RouterLink v-if="canReadKnowledge" :to="`/admin/knowledge/${item.id}/settings`">{{ item.name }}<ExternalLink :size="13" /></RouterLink><strong v-else>{{ item.name }}</strong><small>{{ item.archived ? '已归档' : [item.configured ? '待应用配置' : '',item.active ? '在线索引' : '',item.historical && !item.active ? '历史索引' : ''].filter(Boolean).join(' · ') || '文档向量' }}</small></div></li></ul><p v-if="usage.length" class="embedding-usage-hint">历史索引需要保留凭据用于复盘和回滚，因此仍被引用的配置不能删除。</p></UiDialog>
    <UiDialog v-model:open="deleteOpen" title="删除 Embedding 配置" :description="`确认删除「${selected?.name ?? ''}」？删除后无法恢复。`" size="sm" :layer="70"><p v-if="deleteError" class="embedding-error" role="alert">{{ deleteError }}</p><div class="embedding-delete-buttons"><button class="ui-button" type="button" :disabled="working" @click="deleteOpen = false">取消</button><button class="ui-button embedding-danger" type="button" :disabled="working" @click="remove">{{ actionBusy ? '删除中…' : '确认删除' }}</button></div></UiDialog>
  </section>
</template>

<style scoped>
@import './model-service.css';
.embedding-card { border:1px solid var(--admin-border,#e2e8f0); border-radius:12px; background:#fff; overflow:hidden; }
.embedding-card-main { width:100%; border:0; box-shadow:none; border-radius:0; }
.embedding-card footer { padding:0 18px 12px; display:flex; justify-content:space-between; gap:12px; align-items:center; font-size:12px; color:#94a3b8; }
.embedding-platform-options { grid-template-columns:repeat(3,minmax(0,1fr)); }
.embedding-fields { min-width:0; border:0; padding:0; margin:0; display:grid; gap:24px; }
.embedding-fields:disabled { opacity:.75; }
.embedding-timeout { max-width:250px; }
.embedding-advanced { margin-top:16px; }
.embedding-advanced summary { color:#64748b; font-size:13px; cursor:pointer; margin-bottom:14px; }
.embedding-error { padding:12px 16px; color:#b91c1c; background:#fff1f2; border-radius:8px; display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin-bottom:16px; }
.embedding-test-metrics { display:flex; justify-content:center; flex-wrap:wrap; gap:28px; margin:24px 0 0; }
.embedding-test-metrics dt { font-size:12px; color:#64748b; }
.embedding-test-metrics dd { margin:6px 0 0; font-size:18px; font-variant-numeric:tabular-nums; }
.embedding-usage-list { list-style:none; margin:0; padding:0; }
.embedding-usage-list li { padding:14px 0; border-bottom:1px solid #e2e8f0; }
.embedding-usage-list a { display:flex; gap:8px; align-items:center; color:#2563eb; font-weight:600; }
.embedding-usage-list small { display:block; color:#64748b; margin-top:5px; }
.embedding-usage-hint { font-size:12px; line-height:1.8; color:#64748b; margin:20px 0 0; }
.embedding-delete-buttons { display:flex; justify-content:flex-end; gap:10px; }
.embedding-danger { color:#b91c1c; border-color:#fecaca; }
@media(max-width:640px) { .embedding-platform-options { grid-template-columns:1fr; } .embedding-card footer { flex-wrap:wrap; } }
</style>
