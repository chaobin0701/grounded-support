<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { Check, CheckCircle2, ChevronRight, Code2, LoaderCircle, LockKeyhole, Play, PlugZap, Plus, RefreshCw, Trash2, XCircle } from '@lucide/vue';
import { adminApi, type LlmConnectionTestResult, type LlmProfileItem } from './admin-api';
import { modelPlatforms, modelPlatformOptions, type ModelPlatformKey } from './model-platforms';
import { groupModelProfiles, modelProfileStatus } from './model-profile-presentation';
import AdminPageHeader from './ui/AdminPageHeader.vue';
import ModelPlatformLogo from './ui/ModelPlatformLogo.vue';
import UiDialog from './ui/UiDialog.vue';

const props = defineProps<{ token: string; canManage: boolean }>();
const emit = defineEmits<{ notice: [message: string]; error: [message: string] }>();
const profiles = ref<LlmProfileItem[]>([]);
const profileGroups = computed(() => groupModelProfiles(profiles.value));
const loading = ref(false);
const saving = ref(false);
const dialogOpen = ref(false);
const editingId = ref<number | null>(null);
const replacingProfile = ref<Pick<LlmProfileItem, 'id' | 'name' | 'isDefault'> | null>(null);
const formElement = ref<HTMLFormElement | null>(null);
const testing = ref(false);
const resultDialogOpen = ref(false);
const testResult = ref<LlmConnectionTestResult | { ok: false; message: string } | null>(null);
const testedModel = ref('');
const actionBusy = ref(false);
const deleting = ref(false);
const deleteDialogOpen = ref(false);
const deleteError = ref('');
const replacementId = ref<number | null>(null);
const selectedProfile = computed(() => profiles.value.find((profile) => profile.id === editingId.value) ?? null);
const replacementProfiles = computed(() => profiles.value.filter((profile) => profile.enabled && profile.id !== editingId.value));
const working = computed(() => saving.value || testing.value || actionBusy.value || deleting.value);
const form = ref({
  name: '火山引擎主模型',
  platformKey: 'volcengine' as ModelPlatformKey,
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  model: 'deepseek-v4-1-flash-260910',
  apiKey: '',
  timeoutMs: 20000,
  contextWindowTokens: 32000,
  maxOutputTokens: 1200,
  supportsToolCalls: true,
  supportsStreaming: true,
});

function resetForm() {
  form.value = { name: '火山引擎主模型', platformKey: 'volcengine', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'deepseek-v4-1-flash-260910', apiKey: '', timeoutMs: 20000, contextWindowTokens: 32000, maxOutputTokens: 1200, supportsToolCalls: true, supportsStreaming: true };
  editingId.value = null;
  replacingProfile.value = null;
}
function edit(profile: LlmProfileItem) {
  replacingProfile.value = null;
  editingId.value = profile.id;
  form.value = { name: profile.name, platformKey: profile.platformKey, baseUrl: profile.baseUrl, model: profile.model, apiKey: '', timeoutMs: profile.timeoutMs, contextWindowTokens: profile.contextWindowTokens, maxOutputTokens: profile.maxOutputTokens, supportsToolCalls: profile.supportsToolCalls, supportsStreaming: profile.supportsStreaming };
  dialogOpen.value = true;
}
async function load() {
  loading.value = true;
  try { profiles.value = await adminApi.llmProfiles(props.token); }
  catch (cause) { emit('error', cause instanceof Error ? cause.message : '模型配置加载失败'); }
  finally { loading.value = false; }
}
async function save() {
  if (working.value) return;
  const creating = editingId.value === null;
  const replacement = replacingProfile.value;
  saving.value = true;
  try {
    const input = { ...form.value, ...(form.value.apiKey.trim() ? {} : { apiKey: undefined }) };
    if (creating) {
      const created = await adminApi.createLlmProfile(props.token, input);
      if (replacement?.isDefault) {
        // Creation and activation are separate requests. On activation failure,
        // open the saved record so retrying cannot create duplicate configurations.
        try { await adminApi.activateLlmProfile(props.token, created.id); }
        catch (cause) {
          await load();
          edit(created);
          emit('error', `新配置已保存，但切换未完成：${cause instanceof Error ? cause.message : '请重试'}。可点击“设为当前”重试，原配置未删除。`);
          return;
        }
      }
    } else {
      const { platformKey: _platformKey, ...changes } = input;
      await adminApi.updateLlmProfile(props.token, editingId.value!, changes);
    }
    dialogOpen.value = false;
    emit('notice', replacement?.isDefault ? '新配置已创建并设为当前，原配置已保留' : creating ? '模型配置已创建' : '模型配置已更新');
    await load();
  } catch (cause) { emit('error', cause instanceof Error ? cause.message : '保存失败'); }
  finally { saving.value = false; }
}
async function activate(profile: LlmProfileItem) {
  actionBusy.value = true;
  try { await adminApi.activateLlmProfile(props.token, profile.id); emit('notice', `已切换到「${profile.name}」`); await load(); }
  catch (cause) { emit('error', cause instanceof Error ? cause.message : '切换失败'); }
  finally { actionBusy.value = false; }
}
async function toggle(profile: LlmProfileItem) {
  actionBusy.value = true;
  try { await adminApi.setLlmProfileStatus(props.token, profile.id, !profile.enabled); emit('notice', profile.enabled ? '配置已停用' : '配置已恢复为备用，当前模型未变'); await load(); }
  catch (cause) { emit('error', cause instanceof Error ? cause.message : '状态更新失败'); }
  finally { actionBusy.value = false; }
}
async function testConnection() {
  if (working.value || !formElement.value?.reportValidity()) return;
  testing.value = true;
  testResult.value = null;
  testedModel.value = form.value.model;
  resultDialogOpen.value = true;
  try {
    testResult.value = await adminApi.testLlmConnection(props.token, {
      ...form.value, apiKey: form.value.apiKey.trim() || undefined, profileId: editingId.value ?? undefined,
    });
  } catch (cause) {
    testResult.value = { ok: false, message: cause instanceof Error ? cause.message : '连接测试失败' };
  }
  finally { testing.value = false; }
}
function requestDelete() {
  deleteError.value = '';
  replacementId.value = null;
  deleteDialogOpen.value = true;
}
async function removeProfile() {
  const profile = selectedProfile.value;
  if (!profile || working.value) return;
  deleting.value = true;
  deleteError.value = '';
  try {
    await adminApi.deleteLlmProfile(props.token, profile.id, profile.isDefault ? replacementId.value ?? undefined : undefined);
    deleteDialogOpen.value = false;
    dialogOpen.value = false;
    emit('notice', '模型配置已删除');
    await load();
  } catch (cause) { deleteError.value = cause instanceof Error ? cause.message : '删除失败'; }
  finally { deleting.value = false; }
}
function openCreate() { if (working.value) return; resetForm(); dialogOpen.value = true; }
function openReplacement() {
  const profile = selectedProfile.value;
  if (!profile || working.value) return;
  openCreate();
  replacingProfile.value = { id: profile.id, name: profile.name, isDefault: profile.isDefault };
  void nextTick(() => formElement.value?.querySelector<HTMLButtonElement>('.platform-option')?.focus());
}
function selectPlatform(key: ModelPlatformKey) {
  if (editingId.value !== null || working.value) return;
  if (form.value.platformKey === key) return;
  form.value.platformKey = key;
  const preset = modelPlatforms[key];
  form.value.baseUrl = preset.baseUrl;
  form.value.model = preset.model;
  if (!form.value.name || modelPlatformOptions.some((item) => item.defaultName === form.value.name)) {
    form.value.name = preset.defaultName;
  }
}
onMounted(load);
</script>

<template>
  <section class="model-services-page">
    <AdminPageHeader title="模型服务">
      <template #actions>
        <button type="button" class="ui-button" :disabled="loading" @click="load"><RefreshCw :size="15" :class="{ spinning: loading }" />刷新</button>
        <button v-if="props.canManage" type="button" class="ui-button ui-button-primary" @click="openCreate"><Plus :size="16" />添加配置</button>
      </template>
    </AdminPageHeader>

    <div v-if="loading && !profiles.length" class="model-service-empty" role="status"><LoaderCircle :size="22" class="spinning" /><p>正在加载模型配置…</p></div>
    <div v-else-if="!profiles.length" class="model-service-empty">
      <h2>还没有模型配置</h2><p>添加模型连接后，可将其设为 Agent 当前使用的模型。</p>
      <button v-if="props.canManage" class="ui-button ui-button-primary" type="button" @click="openCreate"><Plus :size="16" />添加第一个配置</button>
    </div>
    <div v-else class="model-service-groups">
      <section v-for="group in profileGroups" :key="group.key" class="model-service-group" :class="{ 'model-service-group-current': group.key === 'current' }" :aria-labelledby="`model-group-${group.key}`">
        <header class="model-group-heading"><h2 :id="`model-group-${group.key}`">{{ group.title }}<span v-if="group.key === 'other'">{{ group.profiles.length }}</span></h2><p>{{ group.description }}</p></header>
        <div class="model-service-list">
          <component :is="props.canManage ? 'button' : 'article'" v-for="profile in group.profiles" :key="profile.id" :type="props.canManage ? 'button' : undefined" class="model-service-card" :class="{ active: profile.isDefault, interactive: props.canManage }" :aria-label="props.canManage ? `配置：${profile.name}` : undefined" @click="props.canManage && edit(profile)">
            <div class="model-service-card-head">
              <div class="model-service-identity">
                <div class="model-service-logo"><ModelPlatformLogo :platform="profile.platformKey" :size="23" /></div>
                <div class="model-service-copy">
                  <div class="model-service-title"><h3>{{ profile.name }}</h3><span class="model-status" :class="modelProfileStatus(profile).key"><CheckCircle2 v-if="profile.isDefault" :size="13" />{{ modelProfileStatus(profile).label }}</span></div>
                  <p>{{ modelPlatforms[profile.platformKey].label }}<span aria-hidden="true"> · </span><span class="model-id">{{ profile.model }}</span></p>
                </div>
              </div>
              <ChevronRight v-if="props.canManage" :size="16" class="model-card-chevron" />
            </div>
            <div class="model-card-meta">
              <span>密钥 <code>{{ profile.apiKeyPreview || (profile.hasApiKey ? '********' : '未配置') }}</code></span>
              <span :title="`上下文 ${profile.contextWindowTokens.toLocaleString()} / 最大输出 ${profile.maxOutputTokens.toLocaleString()} tokens`">{{ profile.timeoutMs / 1000 }}s 超时 · {{ profile.contextWindowTokens.toLocaleString() }} tokens</span>
            </div>
          </component>
        </div>
      </section>
    </div>

    <UiDialog v-if="dialogOpen" :open="dialogOpen" :title="editingId === null ? '添加模型服务' : '编辑模型服务'" :description="editingId === null ? '选择服务平台，填写模型连接与运行参数。' : '平台创建后固定，可修改模型连接与运行参数。'" size="lg" @update:open="dialogOpen = $event">
      <form ref="formElement" class="model-profile-form" @submit.prevent="save">
        <div v-if="selectedProfile" class="model-profile-state">
          <span class="model-status" :class="modelProfileStatus(selectedProfile).key">{{ modelProfileStatus(selectedProfile).label }}</span>
          <div v-if="!selectedProfile.isDefault"><button v-if="selectedProfile.enabled" type="button" class="model-text-action" :disabled="working" @click="activate(selectedProfile)"><Play :size="13" />设为当前</button><button type="button" class="model-text-action" :disabled="working" @click="toggle(selectedProfile)">{{ selectedProfile.enabled ? '停用配置' : '恢复为备用' }}</button></div>
        </div>
        <div v-if="replacingProfile" class="model-replacement-note" role="note">
          <p>正在为「{{ replacingProfile.name }}」新建替代配置。</p>
          <p>{{ replacingProfile.isDefault ? '保存后将设为当前使用，原配置保留。' : '原配置保留；新配置保存后，可在配置中点击“设为当前”。' }} 请填写新平台的密钥，原密钥不会复制。</p>
        </div>
        <section class="model-form-section" aria-labelledby="model-platform-heading">
          <h2 id="model-platform-heading">{{ editingId === null ? '选择平台' : '服务平台' }}</h2>
          <div v-if="editingId !== null" class="model-platform-locked">
            <div class="model-platform-identity"><ModelPlatformLogo :platform="form.platformKey" :size="25" /><strong>{{ modelPlatforms[form.platformKey].label }}</strong><span><LockKeyhole :size="12" />平台已固定</span></div>
            <p>创建后不可修改平台。需要更换时，请新建配置并替换当前模型。</p>
            <button type="button" class="ui-button" :disabled="working" @click="openReplacement"><Plus :size="14" />新建替代配置</button>
          </div>
          <div v-else class="platform-options" role="group" aria-labelledby="model-platform-heading">
            <button v-for="item in modelPlatformOptions" :key="item.key" type="button" class="platform-option" :disabled="working" :class="{ selected: form.platformKey === item.key }" :aria-pressed="form.platformKey === item.key" @click="selectPlatform(item.key)">
              <ModelPlatformLogo :platform="item.key" :size="25" />
              <span class="platform-option-copy"><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span>
              <Check v-if="form.platformKey === item.key" class="platform-option-check" :size="14" />
            </button>
          </div>
        </section>

        <section class="model-form-section" aria-labelledby="model-connection-heading">
          <h2 id="model-connection-heading">连接信息</h2>
          <div class="model-connection-grid">
            <label class="model-field"><span class="ui-label">配置名称</span><input v-model.trim="form.name" class="ui-input" required maxlength="120" placeholder="给这份配置命名" /></label>
            <label class="model-field"><span class="ui-label">模型 ID</span><input v-model.trim="form.model" class="ui-input" required maxlength="200" :placeholder="modelPlatforms[form.platformKey].model || '输入平台提供的模型 ID'" spellcheck="false" /></label>
            <label class="model-field model-field-wide">
              <span class="ui-label">Base URL</span><input v-model.trim="form.baseUrl" class="ui-input" type="url" required placeholder="https://api.example.com/v1" :readonly="form.platformKey !== 'custom'" spellcheck="false" />
              <small>{{ form.platformKey === 'custom' ? '使用已加入 LLM_ALLOWED_BASE_URLS 的 HTTPS 地址。' : editingId === null ? '已自动填写平台地址；自定义地址请选择“其他兼容平台”。' : '平台地址已固定；更换平台请新建替代配置。' }}</small>
            </label>
            <label class="model-field model-field-wide">
              <span class="ui-label">API Key</span><input v-model="form.apiKey" class="ui-input" type="password" autocomplete="new-password" :required="!!replacingProfile" :placeholder="editingId === null ? '输入服务密钥' : '留空则保留原密钥'" />
            </label>
          </div>
        </section>

        <section class="model-form-section model-runtime-section" aria-labelledby="model-runtime-heading">
          <h2 id="model-runtime-heading">运行参数</h2>
          <div class="model-runtime-grid">
            <label class="model-field"><span class="ui-label">请求超时（ms）</span><input v-model.number="form.timeoutMs" class="ui-input" type="number" min="1000" max="120000" required /><small>单次模型请求的最长等待时间。</small></label>
            <label class="model-field"><span class="ui-label">上下文窗口（tokens）</span><input v-model.number="form.contextWindowTokens" class="ui-input" type="number" min="1024" max="1000000" required /><small>用于历史压缩和上下文预算。</small></label>
            <label class="model-field"><span class="ui-label">最大输出（tokens）</span><input v-model.number="form.maxOutputTokens" class="ui-input" type="number" min="128" max="32000" required /><small>模型单次回复的输出上限。</small></label>
          </div>
          <p class="model-output-note"><Code2 :size="15" /><span>必须支持原生工具调用与 JSON 结构化输出；系统固定发送协议约束，不自动降级。</span></p>
        </section>

        <footer class="model-form-footer">
          <button v-if="selectedProfile" type="button" class="model-delete-action" :disabled="working" @click="requestDelete"><Trash2 :size="15" />删除配置</button>
          <div><button type="button" class="ui-button" :disabled="working" @click="testConnection"><LoaderCircle v-if="testing" :size="15" class="spinning" /><PlugZap v-else :size="15" />测试连接</button><button type="button" class="ui-button" :disabled="working" @click="dialogOpen = false">取消</button><button class="ui-button ui-button-primary" type="submit" :disabled="working"><LoaderCircle v-if="saving" :size="15" class="spinning" />{{ saving ? '保存中…' : replacingProfile?.isDefault ? '创建并设为当前' : '保存配置' }}</button></div>
        </footer>
      </form>
    </UiDialog>

    <UiDialog v-model:open="resultDialogOpen" title="连接测试" :description="testedModel" size="md" :layer="60">
      <div class="model-connection-result" role="status" aria-live="polite">
        <template v-if="testing"><LoaderCircle :size="30" class="spinning" /><h3>正在连接模型服务…</h3><p>使用当前填写的参数发送真实测试请求。</p></template>
        <template v-else-if="testResult?.ok"><CheckCircle2 :size="30" class="result-success" /><h3>连接与协议验证通过</h3><p>{{ testResult.model }} · {{ testResult.durationMs }} ms</p><blockquote>{{ testResult.responsePreview }}</blockquote><p>原生工具调用 ✓ · JSON 结构化输出 ✓</p></template>
        <template v-else-if="testResult"><XCircle :size="30" class="result-failure" /><h3>连接失败</h3><p>{{ testResult.message }}</p></template>
      </div>
      <div class="model-result-footer"><button type="button" class="ui-button" @click="resultDialogOpen = false">{{ testing ? '关闭窗口' : '返回配置' }}</button></div>
    </UiDialog>

    <UiDialog v-model:open="deleteDialogOpen" title="删除模型配置" :description="`确定删除「${selectedProfile?.name || ''}」？此操作不可撤销。`" size="md" :layer="60">
      <div v-if="selectedProfile?.isDefault" class="model-delete-replacement">
        <p>这是当前使用的模型。请选择替代配置，系统会切换后删除。</p>
        <label v-if="replacementProfiles.length" class="model-field"><span class="ui-label">切换到</span><select v-model="replacementId" class="ui-input"><option :value="null">请选择备用模型</option><option v-for="profile in replacementProfiles" :key="profile.id" :value="profile.id">{{ profile.name }} · {{ profile.model }}</option></select></label>
        <p v-else>暂无备用配置，请先添加或恢复另一份配置。</p>
      </div>
      <p v-if="deleteError" class="model-delete-error" role="alert">{{ deleteError }}</p>
      <div class="model-result-footer"><button type="button" class="ui-button" :disabled="deleting" @click="deleteDialogOpen = false">取消</button><button type="button" class="ui-button model-confirm-delete" :disabled="working || (!!selectedProfile?.isDefault && !replacementId)" @click="removeProfile"><LoaderCircle v-if="deleting" :size="15" class="spinning" />{{ deleting ? '删除中…' : selectedProfile?.isDefault ? '切换并删除' : '确认删除' }}</button></div>
    </UiDialog>
  </section>
</template>

<style scoped>
@import './model-service.css';
</style>
