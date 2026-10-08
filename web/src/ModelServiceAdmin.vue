<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Check, CheckCircle2, ChevronRight, Code2, LoaderCircle, Play, PlugZap, Plus, RefreshCw, ShieldCheck, Trash2, XCircle } from '@lucide/vue';
import { adminApi, type LlmConnectionTestResult, type LlmProfileItem } from './admin-api';
import { modelPlatforms, modelPlatformOptions, type ModelPlatformKey } from './model-platforms';
import AdminPageHeader from './ui/AdminPageHeader.vue';
import ModelPlatformLogo from './ui/ModelPlatformLogo.vue';
import UiDialog from './ui/UiDialog.vue';

const props = defineProps<{ token: string; canManage: boolean }>();
const emit = defineEmits<{ notice: [message: string]; error: [message: string] }>();
const profiles = ref<LlmProfileItem[]>([]);
const loading = ref(false);
const saving = ref(false);
const dialogOpen = ref(false);
const editingId = ref<number | null>(null);
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
}
function edit(profile: LlmProfileItem) {
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
  saving.value = true;
  try {
    const input = { ...form.value, ...(form.value.apiKey.trim() ? {} : { apiKey: undefined }) };
    if (editingId.value === null) await adminApi.createLlmProfile(props.token, input);
    else await adminApi.updateLlmProfile(props.token, editingId.value, input);
    dialogOpen.value = false;
    emit('notice', editingId.value === null ? '模型配置已创建' : '模型配置已更新');
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
  try { await adminApi.setLlmProfileStatus(props.token, profile.id, !profile.enabled); await load(); }
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
function openCreate() { resetForm(); dialogOpen.value = true; }
function selectPlatform(key: ModelPlatformKey) {
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
    <AdminPageHeader eyebrow="平台配置" title="模型服务" description="管理 OpenAI Compatible 模型连接，为 Agent 选择当前使用的模型。">
      <template #actions>
        <button type="button" class="ui-button" :disabled="loading" @click="load"><RefreshCw :size="15" :class="{ spinning: loading }" />刷新</button>
        <button v-if="props.canManage" type="button" class="ui-button ui-button-primary" @click="openCreate"><Plus :size="16" />添加配置</button>
      </template>
    </AdminPageHeader>

    <div class="model-service-note">
      <ShieldCheck :size="17" />
      <p>密钥在服务端加密保存。当前配置用于后续请求；向量模型在知识库设置中配置。</p>
    </div>
    <div v-if="loading && !profiles.length" class="model-service-empty" role="status"><LoaderCircle :size="22" class="spinning" /><p>正在加载模型配置…</p></div>
    <div v-else-if="!profiles.length" class="model-service-empty">
      <h2>还没有模型配置</h2><p>添加模型连接后，可将其设为 Agent 当前使用的模型。</p>
      <button v-if="props.canManage" class="ui-button ui-button-primary" type="button" @click="openCreate"><Plus :size="16" />添加第一个配置</button>
    </div>
    <div v-else class="model-service-list">
      <component :is="props.canManage ? 'button' : 'article'" v-for="profile in profiles" :key="profile.id" :type="props.canManage ? 'button' : undefined" class="model-service-card" :class="{ active: profile.isDefault, interactive: props.canManage }" :aria-label="props.canManage ? `配置：${profile.name}` : undefined" @click="props.canManage && edit(profile)">
        <div class="model-service-card-head">
          <div class="model-service-identity">
            <div class="model-service-logo"><ModelPlatformLogo :platform="profile.platformKey" :size="23" /></div>
            <div class="model-service-copy">
              <div class="model-service-title"><h2>{{ profile.name }}</h2><span v-if="profile.isDefault" class="model-status current"><CheckCircle2 :size="13" />当前使用</span><span v-else class="model-status" :class="profile.enabled ? 'enabled' : 'disabled'">{{ profile.enabled ? '已启用' : '已停用' }}</span></div>
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

    <UiDialog v-if="dialogOpen" :open="dialogOpen" :title="editingId === null ? '添加模型服务' : '编辑模型服务'" description="选择服务平台，填写模型连接与运行参数。" size="lg" @update:open="dialogOpen = $event">
      <form ref="formElement" class="model-profile-form" @submit.prevent="save">
        <div v-if="selectedProfile" class="model-profile-state">
          <span class="model-status" :class="selectedProfile.isDefault || selectedProfile.enabled ? 'current' : 'disabled'">{{ selectedProfile.isDefault ? '当前使用' : selectedProfile.enabled ? '已启用' : '已停用' }}</span>
          <div v-if="!selectedProfile.isDefault"><button v-if="selectedProfile.enabled" type="button" class="model-text-action" :disabled="working" @click="activate(selectedProfile)"><Play :size="13" />设为当前</button><button type="button" class="model-text-action" :disabled="working" @click="toggle(selectedProfile)">{{ selectedProfile.enabled ? '停用配置' : '启用配置' }}</button></div>
        </div>
        <section class="model-form-section" aria-labelledby="model-platform-heading">
          <h2 id="model-platform-heading">选择平台</h2>
          <div class="platform-options" role="group" aria-labelledby="model-platform-heading">
            <button v-for="item in modelPlatformOptions" :key="item.key" type="button" class="platform-option" :class="{ selected: form.platformKey === item.key }" :aria-pressed="form.platformKey === item.key" @click="selectPlatform(item.key)">
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
              <small>{{ form.platformKey === 'custom' ? '使用已加入 LLM_ALLOWED_BASE_URLS 的 HTTPS 地址。' : '已自动填写平台地址；自定义地址请选择“其他兼容平台”。' }}</small>
            </label>
            <label class="model-field model-field-wide">
              <span class="ui-label">API Key</span><input v-model="form.apiKey" class="ui-input" type="password" autocomplete="new-password" :placeholder="editingId === null ? '输入服务密钥' : '留空则保留原密钥'" />
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
          <p class="model-output-note"><Code2 :size="15" /><span>结构化输出由系统自动适配，无需配置。</span></p>
        </section>

        <footer class="model-form-footer">
          <button v-if="selectedProfile" type="button" class="model-delete-action" :disabled="working" @click="requestDelete"><Trash2 :size="15" />删除配置</button>
          <div><button type="button" class="ui-button" :disabled="working" @click="testConnection"><LoaderCircle v-if="testing" :size="15" class="spinning" /><PlugZap v-else :size="15" />测试连接</button><button type="button" class="ui-button" :disabled="working" @click="dialogOpen = false">取消</button><button class="ui-button ui-button-primary" type="submit" :disabled="working"><LoaderCircle v-if="saving" :size="15" class="spinning" />{{ saving ? '保存中…' : '保存配置' }}</button></div>
        </footer>
      </form>
    </UiDialog>

    <UiDialog v-model:open="resultDialogOpen" title="连接测试" :description="testedModel" size="md" :layer="60">
      <div class="model-connection-result" role="status" aria-live="polite">
        <template v-if="testing"><LoaderCircle :size="30" class="spinning" /><h3>正在连接模型服务…</h3><p>使用当前填写的参数发送真实测试请求。</p></template>
        <template v-else-if="testResult?.ok"><CheckCircle2 :size="30" class="result-success" /><h3>连接成功</h3><p>{{ testResult.model }} · {{ testResult.durationMs }} ms</p><blockquote>{{ testResult.responsePreview }}</blockquote></template>
        <template v-else-if="testResult"><XCircle :size="30" class="result-failure" /><h3>连接失败</h3><p>{{ testResult.message }}</p></template>
      </div>
      <div class="model-result-footer"><button type="button" class="ui-button" @click="resultDialogOpen = false">{{ testing ? '关闭窗口' : '返回配置' }}</button></div>
    </UiDialog>

    <UiDialog v-model:open="deleteDialogOpen" title="删除模型配置" :description="`确定删除「${selectedProfile?.name || ''}」？此操作不可撤销。`" size="md" :layer="60">
      <div v-if="selectedProfile?.isDefault" class="model-delete-replacement">
        <p>这是当前使用的模型。请选择替代配置，系统会切换后删除。</p>
        <label v-if="replacementProfiles.length" class="model-field"><span class="ui-label">切换到</span><select v-model="replacementId" class="ui-input"><option :value="null">请选择已启用的模型</option><option v-for="profile in replacementProfiles" :key="profile.id" :value="profile.id">{{ profile.name }} · {{ profile.model }}</option></select></label>
        <p v-else>暂无其他已启用配置，请先添加或启用另一份配置。</p>
      </div>
      <p v-if="deleteError" class="model-delete-error" role="alert">{{ deleteError }}</p>
      <div class="model-result-footer"><button type="button" class="ui-button" :disabled="deleting" @click="deleteDialogOpen = false">取消</button><button type="button" class="ui-button model-confirm-delete" :disabled="working || (!!selectedProfile?.isDefault && !replacementId)" @click="removeProfile"><LoaderCircle v-if="deleting" :size="15" class="spinning" />{{ deleting ? '删除中…' : selectedProfile?.isDefault ? '切换并删除' : '确认删除' }}</button></div>
    </UiDialog>
  </section>
</template>

<style scoped>
.model-services-page { min-width: 0; }
.model-service-note { display: flex; align-items: flex-start; gap: 9px; margin-bottom: 20px; color: #748094; font-size: 12px; line-height: 1.6; }
.model-service-note svg { flex: none; margin-top: 1px; color: #64748b; }
.model-service-note p { margin: 0; }
.model-service-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 360px), 1fr)); gap: 12px; }
.model-service-card { min-width: 0; padding: 16px; border: 1px solid var(--line); border-radius: 10px; background: #fff; text-align: left; transition: border-color .15s, background-color .15s; }
.model-service-card.interactive { cursor: pointer; }
.model-service-card.interactive:hover { border-color: #99b5fa; background: #fafcff; }
.model-service-card.active { border-color: #c4d4fc; }
.model-service-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.model-service-identity { display: flex; align-items: center; gap: 12px; min-width: 0; }
.model-service-logo { display: grid; flex: none; width: 36px; height: 36px; place-items: center; border-radius: 8px; background: #f8fafc; }
.model-service-copy { min-width: 0; }
.model-service-title { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; }
.model-service-title h2 { margin: 0; color: #172033; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
.model-service-copy p { margin: 5px 0 0; color: #748094; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.model-id { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; }
.model-status { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 5px; background: #f1f5f9; color: #64748b; font-size: 11px; white-space: nowrap; }
.model-status.current, .model-status.enabled { background: #edf8f1; color: #26845a; }
.model-text-action { padding: 8px; color: #748094; font-size: 12px; cursor: pointer; }
.model-text-action:hover { color: #2457e6; }
.model-service-empty { display: grid; justify-items: center; gap: 12px; padding: 72px 20px; border: 1px dashed var(--line); border-radius: 12px; color: #748094; font-size: 13px; }
.model-service-empty h2 { margin: 0; color: #344054; font-size: 16px; font-weight: 600; }
.model-service-empty p { margin: 0; text-align: center; }
.model-profile-form { display: grid; gap: 24px; }
.model-form-section { display: grid; gap: 12px; min-width: 0; }
.model-form-section h2 { margin: 0; color: #344054; font-size: 13px; font-weight: 600; }
.platform-options { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.platform-option { position: relative; display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 76px; padding: 14px 12px; border: 1px solid #e2e8f0; border-radius: 9px; background: #fff; text-align: left; cursor: pointer; transition: border-color .15s, background-color .15s; }
.platform-option:hover { border-color: #b6c6e2; background: #fafbfe; }
.platform-option.selected { border-color: #3166f5; background: #f5f8ff; }
.platform-option-copy { display: grid; gap: 5px; min-width: 0; }
.platform-option strong { color: #344054; font-size: 12px; font-weight: 600; line-height: 1.4; }
.platform-option small { color: #8a96a8; font-size: 10px; line-height: 1.4; }
.platform-option-check { position: absolute; top: 6px; right: 6px; color: #3166f5; }
.model-connection-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.model-runtime-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.model-field { display: grid; align-content: start; gap: 8px; min-width: 0; }
.model-field-wide { grid-column: 1 / -1; }
.model-field small { color: #8a96a8; font-size: 11px; line-height: 1.5; }
.model-field input[readonly] { background: #f8fafc; color: #64748b; }
.model-runtime-section { padding-top: 20px; border-top: 1px solid #edf0f5; }
.model-output-note { display: flex; align-items: center; gap: 7px; margin: 0; color: #8a96a8; font-size: 11px; line-height: 1.5; }
.model-output-note svg { flex: none; }
.model-form-footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px; padding-top: 18px; border-top: 1px solid #edf0f5; }
.model-form-footer > span { display: inline-flex; align-items: center; gap: 6px; color: #8a96a8; font-size: 11px; }
.model-form-footer > div { display: flex; gap: 8px; margin-left: auto; }
.model-card-chevron { flex: none; margin-top: 9px; color: #94a3b8; }
.model-card-meta { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px 16px; margin-top: 14px; color: #64748b; font-size: 11px; }
.model-card-meta code { margin-left: 5px; color: #475467; font-family: ui-monospace, monospace; }
.model-profile-state { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.model-profile-state > div { display: flex; gap: 8px; }
.model-text-action { display: inline-flex; align-items: center; gap: 5px; }
.model-delete-action { display: inline-flex; align-items: center; gap: 6px; padding: 10px 0; color: #c24141; font-size: 12px; cursor: pointer; }
.model-confirm-delete { border-color: #dc2626; background: #dc2626; color: #fff; }
.model-confirm-delete:hover { border-color: #b91c1c; background: #b91c1c; }
.model-connection-result { display: grid; justify-items: center; gap: 12px; padding: 18px 0; text-align: center; }
.model-connection-result h3 { margin: 0; color: #172033; font-size: 17px; font-weight: 600; }
.model-connection-result p { margin: 0; color: #64748b; font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.model-connection-result blockquote { width: 100%; margin: 0; padding: 14px; border: 1px solid #dcf0e2; border-radius: 8px; background: #f2faf5; color: #28774d; font-size: 14px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.result-success { color: #26845a; }.result-failure { color: #dc2626; }
.model-result-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.model-delete-replacement { display: grid; gap: 14px; }.model-delete-replacement p { margin: 0; color: #64748b; font-size: 13px; line-height: 1.7; }
.model-delete-error { margin-top: 12px; color: #b91c1c; font-size: 12px; }
@media (max-width: 720px) {
  .model-service-card { padding: 16px; }
  .model-service-card-head { gap: 8px; }
  .platform-options { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .model-connection-grid, .model-runtime-grid { grid-template-columns: minmax(0, 1fr); }
  .model-profile-form { gap: 20px; }
}
@media (prefers-reduced-motion: reduce) { .platform-option { transition: none; } .spinning { animation: none; } }
</style>
