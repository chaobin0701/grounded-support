<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { CheckCircle2, Pencil, Play, Plus, RefreshCw, ShieldCheck, TestTube2, X } from '@lucide/vue';
import { adminApi, type LlmProfileItem } from './admin-api';
import UiDialog from './ui/UiDialog.vue';

const props = defineProps<{ token: string; canManage: boolean }>();
const emit = defineEmits<{ notice: [message: string]; error: [message: string] }>();
const profiles = ref<LlmProfileItem[]>([]);
const loading = ref(false);
const saving = ref(false);
const dialogOpen = ref(false);
const editingId = ref<number | null>(null);
const testingId = ref<number | null>(null);
type TestResult = { ok: true; model: string; durationMs: number; responsePreview: string } | { ok: false; message: string };
const testResults = ref<Record<number, TestResult>>({});
const form = ref({
  name: '火山引擎主模型',
  platformKey: 'volcengine' as 'volcengine' | 'openai' | 'deepseek' | 'custom',
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
  try { await adminApi.activateLlmProfile(props.token, profile.id); emit('notice', `已切换到「${profile.name}」`); await load(); }
  catch (cause) { emit('error', cause instanceof Error ? cause.message : '切换失败'); }
}
async function toggle(profile: LlmProfileItem) {
  try { await adminApi.setLlmProfileStatus(props.token, profile.id, !profile.enabled); await load(); }
  catch (cause) { emit('error', cause instanceof Error ? cause.message : '状态更新失败'); }
}
async function test(profile: LlmProfileItem) {
  testingId.value = profile.id;
  const { [profile.id]: _previousResult, ...remainingResults } = testResults.value;
  testResults.value = remainingResults;
  try {
    const result = await adminApi.testLlmProfile(props.token, profile.id);
    testResults.value = { ...testResults.value, [profile.id]: result };
    emit('notice', `连接成功 · ${result.model} · ${result.durationMs} ms`);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '连接测试失败';
    testResults.value = { ...testResults.value, [profile.id]: { ok: false, message } };
    emit('error', message);
  }
  finally { testingId.value = null; }
}
function openCreate() { resetForm(); dialogOpen.value = true; }
function selectPlatform() {
  const presets: Record<typeof form.value.platformKey, { baseUrl: string; model: string; name: string }> = {
    volcengine: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'deepseek-v4-1-flash-260910', name: '火山引擎主模型' },
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', name: 'OpenAI 主模型' },
    deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', name: 'DeepSeek 主模型' },
    custom: { baseUrl: '', model: '', name: '自定义兼容模型' },
  };
  const preset = presets[form.value.platformKey];
  form.value.baseUrl = preset.baseUrl;
  form.value.model = preset.model;
  if (!form.value.name || ['火山引擎主模型', 'OpenAI 主模型', 'DeepSeek 主模型', '自定义兼容模型'].includes(form.value.name)) form.value.name = preset.name;
}
onMounted(load);
</script>

<template>
  <section class="model-services-page">
    <header class="admin-page-header">
      <div><p class="section-label">平台配置</p><h1>模型服务</h1><p>仅支持 OpenAI Compatible 协议。可配置火山引擎、OpenAI、DeepSeek 或其他兼容端点。</p></div>
      <div class="admin-page-actions"><button type="button" class="admin-text-button" :disabled="loading" @click="load"><RefreshCw :size="15" />刷新</button><button v-if="props.canManage" type="button" class="admin-primary" @click="openCreate"><Plus :size="16" />添加配置</button></div>
    </header>
    <div class="model-service-note"><ShieldCheck :size="18" /><div><strong>密钥安全</strong><p>API Key 只在服务端加密保存，列表不会返回明文。启用的默认配置会立即用于后续 Agent 请求。向量模型请在“知识库 → 设置 → Embedding 模型”中单独配置。</p></div></div>
    <div v-if="loading && !profiles.length" class="admin-muted">正在加载模型配置…</div>
    <div v-else-if="!profiles.length" class="admin-empty"><h2>还没有模型配置</h2><p>添加一个 OpenAI Compatible 接口后，Agent 才能使用后台配置的模型。</p><button v-if="props.canManage" class="admin-primary" type="button" @click="openCreate">添加第一个配置</button></div>
    <div v-else class="model-service-list">
      <article v-for="profile in profiles" :key="profile.id" class="model-service-card" :class="{ active: profile.isDefault }">
        <div class="model-service-card-head"><div><div class="model-service-title"><h2>{{ profile.name }}</h2><span class="model-platform-label">{{ ({ volcengine: '火山引擎方舟', openai: 'OpenAI', deepseek: 'DeepSeek', custom: '其他兼容平台' } as Record<string, string>)[profile.platformKey] }}</span><span v-if="profile.isDefault" class="admin-status ready"><CheckCircle2 :size="13" />当前使用</span><span v-else class="admin-status" :class="profile.enabled ? 'ready' : 'archived'">{{ profile.enabled ? '已启用' : '已停用' }}</span></div><p class="admin-mono">{{ profile.model }}</p></div><span class="model-service-protocol">OpenAI Compatible</span></div>
        <dl class="model-service-meta"><div><dt>服务地址</dt><dd>{{ profile.baseUrl }}</dd></div><div><dt>密钥</dt><dd>{{ profile.hasApiKey ? '已配置' : '未配置' }}</dd></div><div><dt>超时</dt><dd>{{ profile.timeoutMs.toLocaleString() }} ms</dd></div><div><dt>上下文 / 输出</dt><dd>{{ profile.contextWindowTokens.toLocaleString() }} / {{ profile.maxOutputTokens.toLocaleString() }}</dd></div></dl>
        <div class="model-service-footer"><div v-if="props.canManage" class="model-service-actions"><button type="button" class="model-action-primary" @click="test(profile)" :disabled="testingId === profile.id"><TestTube2 :size="15" />{{ testingId === profile.id ? '正在请求模型…' : '测试连接' }}</button><button type="button" @click="edit(profile)"><Pencil :size="15" />编辑</button><button v-if="!profile.isDefault && profile.enabled" type="button" class="primary-link" @click="activate(profile)"><Play :size="15" />设为当前</button><button v-if="!profile.isDefault" type="button" class="muted-link" @click="toggle(profile)">{{ profile.enabled ? '停用' : '启用' }}</button></div><div v-if="testResults[profile.id]" class="model-test-result" :class="{ success: testResults[profile.id]?.ok, failure: testResults[profile.id] && !testResults[profile.id]?.ok }"><template v-if="testResults[profile.id]?.ok"><strong>连接成功</strong><span>已收到模型响应：{{ (testResults[profile.id] as Extract<TestResult, { ok: true }>).responsePreview }}</span><small>{{ (testResults[profile.id] as Extract<TestResult, { ok: true }>).model }} · {{ (testResults[profile.id] as Extract<TestResult, { ok: true }>).durationMs }} ms</small></template><template v-else>{{ (testResults[profile.id] as Extract<TestResult, { ok: false }>).message }}</template></div></div>
      </article>
    </div>
    <UiDialog v-if="dialogOpen" :open="dialogOpen" :title="editingId === null ? '添加模型服务' : '编辑模型服务'" description="填写符合 OpenAI Compatible 协议的 HTTPS 接口。" size="lg" @update:open="dialogOpen = $event">
      <form class="admin-dialog-form model-profile-form" @submit.prevent="save"><div class="platform-picker"><p>选择平台</p><div class="platform-options"><button v-for="item in [{ key: 'volcengine', label: '火山引擎方舟', description: '推荐当前配置' }, { key: 'openai', label: 'OpenAI', description: '官方兼容接口' }, { key: 'deepseek', label: 'DeepSeek', description: '官方兼容接口' }, { key: 'custom', label: '其他兼容平台', description: '自定义 OpenAI Compatible' }]" :key="item.key" type="button" :class="{ selected: form.platformKey === item.key }" @click="form.platformKey = item.key as typeof form.platformKey; selectPlatform()"><strong>{{ item.label }}</strong><small>{{ item.description }}</small></button></div></div><div class="admin-form-grid"><label>配置名称<input v-model.trim="form.name" required maxlength="120" placeholder="火山引擎主模型" /></label><label>模型 ID<input v-model.trim="form.model" required maxlength="200" placeholder="deepseek-v4-1-flash-260910" /></label><label class="wide-field">Base URL<input v-model.trim="form.baseUrl" type="url" required placeholder="https://api.example.com/v1" :readonly="form.platformKey !== 'custom'" /><small>{{ form.platformKey === 'custom' ? '必须是已加入 LLM_ALLOWED_BASE_URLS 的 HTTPS 地址。' : '平台预设地址；如需其他地址请选择“其他兼容平台”。' }}</small></label><label class="wide-field">API Key<input v-model="form.apiKey" type="password" autocomplete="new-password" :placeholder="editingId === null ? '输入服务密钥' : '留空则保留原密钥'" /></label><label>请求超时<input v-model.number="form.timeoutMs" type="number" min="1000" max="120000" required /><small>Provider 等待单次请求的最长时间。</small></label><label>上下文窗口<input v-model.number="form.contextWindowTokens" type="number" min="1024" max="1000000" required /><small>用于控制上下文预算和历史压缩。</small></label><label>最大输出 tokens<input v-model.number="form.maxOutputTokens" type="number" min="128" max="32000" required /><small>限制模型单次输出长度。</small></label><div class="fixed-setting"><span>结构化输出</span><strong>自动兼容</strong><small>由 Provider 固定发送 JSON 模式，并兼容不支持该参数的端点。</small></div></div><footer><button type="button" @click="dialogOpen = false"><X :size="15" />取消</button><button class="admin-primary" type="submit" :disabled="saving">{{ saving ? '保存中…' : '保存配置' }}</button></footer></form>
    </UiDialog>
  </section>
</template>

<style scoped>
.model-services-page { display: grid; gap: 24px; }
.admin-page-header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; }
.admin-page-header h1 { margin: 4px 0 8px; }
.admin-page-header p { margin: 0; color: var(--admin-muted); }
.admin-page-actions, .model-service-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.admin-page-actions button, .model-service-actions button { display: inline-flex; align-items: center; gap: 6px; }
.model-service-note { display: flex; gap: 12px; padding: 14px 16px; border: 1px solid #dbe5f8; background: #f5f8ff; color: #315cae; border-radius: 12px; }
.model-service-note p { margin: 3px 0 0; color: #7184a5; }
.model-service-list { display: grid; gap: 14px; width: 100%; }
.model-service-card { border: 1px solid var(--admin-border); border-radius: 14px; padding: 20px; background: white; box-shadow: 0 8px 20px rgba(31, 54, 88, .04); }
.model-service-card.active { border-color: #86aafc; box-shadow: 0 10px 26px rgba(44, 99, 234, .1); }
.model-service-card-head { display: flex; justify-content: space-between; gap: 16px; }
.model-service-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.model-service-title h2 { margin: 0; font-size: 18px; }
.model-service-protocol { color: #6480ac; font-size: 12px; }
.model-platform-label { color: #315cae; background: #eef4ff; border-radius: 999px; padding: 3px 8px; font-size: 12px; }
.model-service-meta { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 16px; margin: 18px 0; padding: 14px 0; border-block: 1px solid #edf0f5; }
.model-service-meta dt { color: var(--admin-muted); font-size: 12px; margin-bottom: 4px; }.model-service-meta dd { margin: 0; word-break: break-all; font-size: 13px; }
.model-service-footer { display: grid; gap: 10px; }.model-action-primary { color: #2457e6 !important; border-color: #cbd9ff !important; background: #f5f8ff !important; }.model-test-result { display: grid; gap: 3px; width: fit-content; max-width: min(100%, 720px); padding: 8px 11px; border-radius: 7px; font-size: 12px; line-height: 1.4; }.model-test-result span, .model-test-result small { color: inherit; opacity: .82; overflow-wrap: anywhere; }.model-test-result.success { color: #28774d; background: #e7f5eb; }.model-test-result.failure { color: #a5483e; background: #fff0ec; }.primary-link { color: #2860e8; }.muted-link { color: var(--admin-muted); }.wide-field { grid-column: span 2; }
.platform-picker { display: grid; gap: 10px; }.platform-picker p { margin: 0; font-weight: 700; }.platform-options { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }.platform-options button { display: grid; gap: 4px; text-align: left; padding: 12px; border: 1px solid var(--admin-border); border-radius: 10px; background: #fff; color: inherit; cursor: pointer; }.platform-options button.selected { border-color: #2860e8; background: #f3f7ff; box-shadow: inset 0 0 0 1px #2860e8; }.platform-options small, .fixed-setting small { color: var(--admin-muted); line-height: 1.4; }.fixed-setting { display: grid; align-content: start; gap: 5px; padding: 2px 0; }.fixed-setting span { font-weight: 700; }.fixed-setting strong { color: #2860e8; }
@media (max-width: 760px) { .admin-page-header, .model-service-card-head { flex-direction: column; }.model-service-meta { grid-template-columns: 1fr 1fr; }.wide-field { grid-column: auto; }.platform-options { grid-template-columns: 1fr 1fr; } }
</style>
