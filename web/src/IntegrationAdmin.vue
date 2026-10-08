<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { BookOpen, Copy, Globe, KeyRound, Plus, RefreshCw, Server } from '@lucide/vue';
import { adminApi, AdminApiError, type IntegrationApp, type IntegrationAppInput, type IntegrationDetail, type IntegrationKey, type IntegrationScope } from './admin-api';
import AdminPageHeader from './ui/AdminPageHeader.vue';
import UiDialog from './ui/UiDialog.vue';

const props = defineProps<{ token: string; canManage: boolean }>();
const emit = defineEmits<{ notice: [value: string]; error: [value: string] }>();
const apps = ref<IntegrationApp[]>([]);
const detail = ref<IntegrationDetail | null>(null);
const busy = ref(false);
const loading = ref(false);
const error = ref('');
const open = ref(false);
const tab = ref<'settings' | 'keys' | 'usage'>('settings');
const editingId = ref('');
const origins = ref('');
const form = ref<IntegrationAppInput>(defaults());
const keyOpen = ref(false);
const keyForm = ref({ name: '', expiresAt: '', scopes: [] as IntegrationScope[] });
const rotateId = ref('');
const secret = ref('');
const confirmRevoke = ref<IntegrationKey | null>(null);
let loadSequence = 0;
const scopes: { id: IntegrationScope; label: string }[] = [
  { id: 'chat:write', label: '发送问题' },
  { id: 'conversations:read', label: '读取自己的会话' },
  { id: 'conversations:delete', label: '删除自己的会话' },
  { id: 'usage:read', label: '平台汇总用量（仅服务端）' },
];
const tabs = [{ id: 'settings', label: '应用设置' }, { id: 'keys', label: '平台密钥' }, { id: 'usage', label: '调用统计' }] as const;
const tokenLimitEnabled = computed({ get: () => form.value.dailyTokenLimit !== null, set: value => { form.value.dailyTokenLimit = value ? 1000000 : null; } });
const quotaPercent = computed(() => detail.value?.usage.tokenLimit ? Math.min(100, (detail.value.usage.totalTokens + detail.value.usage.reservedTokens) / detail.value.usage.tokenLimit * 100) : 0);

function defaults(): IntegrationAppInput {
  return { name: '', enabled: true, websiteEnabled: true, apiEnabled: false, allowedOrigins: [], scopes: ['chat:write', 'conversations:read', 'conversations:delete'], requestsPerMinute: 60, concurrency: 5, dailyRequests: 5000, dailyTokenLimit: null };
}
function number(value: number | string | null | undefined) { return value === null || value === undefined ? '不限制' : Number(value).toLocaleString('zh-CN'); }
function failure(cause: unknown) { error.value = cause instanceof AdminApiError ? cause.message : '操作失败，请稍后重试'; }
function date(value: string | null) { return value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'; }
function keyStatus(key: IntegrationKey) { return key.revokedAt ? '已撤销' : key.expiresAt && Date.parse(key.expiresAt) <= Date.now() ? '已过期' : '可用'; }
async function copy(value: string, label: string) {
  try { await navigator.clipboard.writeText(value); emit('notice', `${label}已复制`); }
  catch { error.value = '复制失败，请手动选择文本复制'; }
}
async function load() {
  loading.value = true;
  try { apps.value = await adminApi.integrations(props.token); }
  catch (cause) { emit('error', cause instanceof AdminApiError ? cause.message : '应用列表加载失败'); }
  finally { loading.value = false; }
}
async function edit(app?: IntegrationApp) {
  const sequence = ++loadSequence;
  error.value = ''; detail.value = null; tab.value = 'settings'; editingId.value = app?.id ?? '';
  form.value = app ? { name: app.name, enabled: app.enabled, websiteEnabled: app.websiteEnabled, apiEnabled: app.apiEnabled, allowedOrigins: [...app.allowedOrigins], scopes: [...app.scopes], requestsPerMinute: app.requestsPerMinute, concurrency: app.concurrency, dailyRequests: app.dailyRequests, dailyTokenLimit: app.dailyTokenLimit ?? null } : defaults();
  origins.value = form.value.allowedOrigins.join('\n');
  open.value = true;
  if (app) {
    try { const value = await adminApi.integration(props.token, app.id); if (sequence === loadSequence) detail.value = value; }
    catch (cause) { if (sequence === loadSequence) failure(cause); }
  }
}
async function refreshDetail() {
  if (editingId.value) detail.value = await adminApi.integration(props.token, editingId.value);
}
async function save() {
  if (busy.value || !props.canManage) return;
  busy.value = true; error.value = '';
  try {
    const input = { ...form.value, allowedOrigins: origins.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean) };
    const app = editingId.value ? await adminApi.updateIntegration(props.token, editingId.value, input) : await adminApi.createIntegration(props.token, input);
    editingId.value = app.id; origins.value = app.allowedOrigins.join('\n');
    await Promise.all([load(), refreshDetail()]); emit('notice', '接入配置已保存');
  } catch (cause) { failure(cause); }
  finally { busy.value = false; }
}
function newKey(key?: IntegrationKey) {
  rotateId.value = key?.id ?? '';
  keyForm.value = { name: key?.name ?? '', scopes: key ? key.scopes.filter(s => form.value.scopes.includes(s)) : [...form.value.scopes], expiresAt: '' };
  keyOpen.value = true; error.value = '';
}
async function createKey() {
  if (busy.value || !props.canManage) return;
  busy.value = true; error.value = '';
  try {
    const key = await adminApi.createIntegrationKey(props.token, editingId.value, { name: keyForm.value.name.trim(), scopes: keyForm.value.scopes, ...(keyForm.value.expiresAt ? { expiresAt: new Date(keyForm.value.expiresAt).toISOString() } : {}) }, rotateId.value || undefined);
    keyOpen.value = false; secret.value = key.apiKey; await refreshDetail();
  } catch (cause) { failure(cause); }
  finally { busy.value = false; }
}
async function revoke() {
  if (!confirmRevoke.value || busy.value || !props.canManage) return;
  busy.value = true;
  try { await adminApi.revokeIntegrationKey(props.token, editingId.value, confirmRevoke.value.id); confirmRevoke.value = null; await refreshDetail(); emit('notice', '密钥已撤销'); }
  catch (cause) { failure(cause); }
  finally { busy.value = false; }
}
onMounted(load);
</script>

<template>
  <section class="integration-admin">
    <AdminPageHeader title="接入管理">
      <template #actions><RouterLink to="/docs/integration" target="_blank" rel="noopener noreferrer" class="ui-button secondary"><BookOpen :size="16" />接入文档<span class="sr-only">（新窗口打开）</span></RouterLink><button class="ui-button secondary" :disabled="loading" @click="load"><RefreshCw :size="16" :class="{ spinning: loading }" />刷新</button><button v-if="canManage" class="ui-button ui-button-primary" @click="edit()"><Plus :size="16" />添加应用</button></template>
    </AdminPageHeader>
    <div class="integration-grid" :aria-busy="loading">
      <button v-for="app in apps" :key="app.id" class="integration-card" @click="edit(app)">
        <div class="integration-card-head"><span class="integration-symbol"><Globe v-if="app.websiteEnabled" :size="19" /><Server v-else :size="19" /></span><strong>{{ app.name }}</strong><span class="integration-status" :class="{ off: !app.enabled }">{{ app.enabled ? '接入中' : '已停用' }}</span></div>
        <p class="integration-channels">{{ [app.websiteEnabled ? '网站接入' : '', app.apiEnabled ? '平台 API' : ''].filter(Boolean).join(' · ') || '未开启通道' }}<span v-if="app.isInternal"> · 内置官网</span></p>
        <code>{{ app.id }}</code>
        <div class="integration-card-meta"><span>{{ app.allowedOrigins.length }} 个授权域名</span><span>{{ app.requestsPerMinute }} 次/分钟 · {{ app.concurrency }} 并发</span></div>
        <p class="integration-card-quota">每日 {{ number(app.dailyRequests) }} 次 · Token {{ number(app.dailyTokenLimit) }}</p>
      </button>
    </div>
    <p v-if="!apps.length && !loading" class="admin-muted">暂无接入应用。</p>

    <UiDialog :open="open" :title="editingId ? form.name || '接入应用' : '添加接入应用'" description="网站、平台共用现有 Agent；权限与调用限额由服务端校验。" size="lg" @update:open="open = $event; if (!$event) { error = ''; loadSequence++; }">
      <div class="integration-editor">
        <div v-if="editingId" class="integration-app-id"><span>应用 ID</span><code>{{ editingId }}</code><button class="ui-button secondary small" aria-label="复制应用 ID" @click="copy(editingId, '应用 ID')"><Copy :size="14" />复制</button></div>
        <nav v-if="editingId" class="integration-tabs" aria-label="接入应用面板"><button v-for="item in tabs" :key="item.id" :class="{ active: tab === item.id }" :aria-current="tab === item.id ? 'page' : undefined" @click="tab = item.id; error = ''">{{ item.label }}</button></nav>
        <p v-if="error" class="integration-error" role="alert">{{ error }}</p>
        <form v-if="tab === 'settings'" @submit.prevent="save">
          <p v-if="detail?.app.isInternal" class="integration-hint">此应用管理现有官网聊天入口；停用或移除当前域名会使该站点无法咨询。</p>
          <fieldset :disabled="!canManage || busy">
            <div class="integration-fields"><label>应用名称<input v-model="form.name" class="ui-input" required maxlength="100" placeholder="例如：企业官网、客服平台" /></label><label class="integration-check enabled"><input v-model="form.enabled" type="checkbox" />允许接入</label></div>
            <div class="integration-channels-select"><label class="integration-check"><input v-model="form.websiteEnabled" type="checkbox" /><Globe :size="16" />网站接入</label><label class="integration-check"><input v-model="form.apiEnabled" type="checkbox" /><Server :size="16" />平台 API</label></div>
            <label v-if="form.websiteEnabled" class="integration-origin">授权域名<textarea v-model="origins" class="ui-input" rows="3" aria-label="授权域名" aria-describedby="integration-origins-help" placeholder="https://www.example.com&#10;https://support.example.com" :required="form.websiteEnabled" /><small id="integration-origins-help">每行一个完整 Origin，精确匹配协议、主机和端口。不接受通配符或路径；本地开发可用 http://localhost:端口。</small></label>
            <div class="integration-scopes"><span>访问权限</span><label v-for="scope in scopes" :key="scope.id" class="integration-check"><input v-model="form.scopes" type="checkbox" :value="scope.id" />{{ scope.label }}</label></div>
            <div class="integration-fields limits"><label>每分钟请求上限<input v-model.number="form.requestsPerMinute" class="ui-input" type="number" min="1" max="10000" required /></label><label>同时执行上限<input v-model.number="form.concurrency" class="ui-input" type="number" min="1" max="100" required /></label><label>每日请求上限<input v-model.number="form.dailyRequests" class="ui-input" type="number" min="1" max="1000000" required /></label></div>
            <div class="integration-token-limit"><label class="integration-check"><input v-model="tokenLimitEnabled" type="checkbox" />限制每日 Token 用量</label><label v-if="tokenLimitEnabled">每日 Token 上限<input v-model.number="form.dailyTokenLimit" class="ui-input" type="number" min="1" max="1000000000000" step="1" required /></label><small>累计所有规划、回答、重试及摘要模型的输入与输出；关闭时不限制。Embedding 不计入此配额。</small></div>
          </fieldset>
          <p class="integration-hint">每日配额按北京时间统计，接纳的失败请求也计入配额。官网还受全局访客频率限制；更新配置后访客需要重新获取短期令牌。</p>
          <div class="integration-actions"><button type="button" class="ui-button secondary" @click="open = false">关闭</button><button v-if="canManage" class="ui-button ui-button-primary" :disabled="busy">{{ busy ? '保存中…' : '保存配置' }}</button></div>
        </form>

        <div v-else-if="tab === 'keys'">
          <div class="integration-section-head"><p>完整密钥仅显示一次，保存 SHA-256 摘要；支持到期、撤销和轮换。</p><button v-if="canManage" class="ui-button ui-button-primary" :disabled="busy || !detail" @click="newKey()"><Plus :size="15" />创建密钥</button></div>
          <p v-if="!form.apiEnabled" class="integration-hint">此应用尚未开启平台 API；密钥在平台通道开启后才可调用。</p>
          <div v-for="key in detail?.keys" :key="key.id" class="integration-key-row"><KeyRound :size="17" /><div><strong>{{ key.name }}</strong><code>{{ key.maskedKey }}</code><small>到期 {{ date(key.expiresAt) }} · 最后使用 {{ date(key.lastUsedAt) }}</small></div><span class="integration-status" :class="{ off: keyStatus(key) !== '可用' }">{{ keyStatus(key) }}</span><div v-if="canManage && !key.revokedAt" class="integration-key-actions"><button class="ui-button secondary small" :disabled="busy" @click="newKey(key)">轮换</button><button class="ui-button secondary small danger" :disabled="busy" @click="confirmRevoke = key">撤销</button></div></div>
          <p v-if="detail && !detail.keys.length" class="admin-muted">暂无密钥。创建独立密钥，可按接入方单独撤销。</p>
        </div>

        <div v-else-if="tab === 'usage'">
          <div class="integration-section-head"><p>今日调用 · 北京时间</p><button class="ui-button secondary" :disabled="busy" @click="refreshDetail().catch(failure)"><RefreshCw :size="15" />刷新统计</button></div>
          <dl v-if="detail" class="integration-metrics"><div><dt>请求</dt><dd>{{ detail.usage.requests }}</dd></div><div><dt>完成 / 失败</dt><dd>{{ detail.usage.completed }} / {{ detail.usage.failed }}</dd></div><div><dt>进行中</dt><dd>{{ detail.usage.running }}</dd></div><div><dt>Token</dt><dd>{{ detail.usage.totalTokens }}</dd></div></dl>
          <div v-if="detail" class="integration-token-usage">
            <div class="integration-section-head"><strong>每日 Token 额度</strong><small>重置于 {{ date(detail.usage.resetAt) }}（北京时间）</small></div>
            <dl><div><dt>已计量</dt><dd>{{ number(detail.usage.totalTokens) }}</dd></div><div><dt>执行中预留</dt><dd>{{ number(detail.usage.reservedTokens) }}</dd></div><div><dt>剩余额度</dt><dd>{{ number(detail.usage.remainingTokens) }}</dd></div><div><dt>每日上限</dt><dd>{{ number(detail.usage.tokenLimit) }}</dd></div></dl>
            <div v-if="detail.usage.tokenLimit !== null" class="integration-quota-track" role="progressbar" aria-label="今日 Token 额度占用" :aria-valuenow="Math.round(quotaPercent)" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: quotaPercent + '%' }" /></div>
            <p class="integration-hint">已知输入 {{ number(detail.usage.inputTokens) }} · 已知输出 {{ number(detail.usage.outputTokens) }}。预留在模型返回后结算；余额不保证足够执行下一次完整模型调用。</p>
            <p v-if="detail.usage.unknownModelCalls" class="integration-accounting-warning" role="status">{{ detail.usage.unknownModelCalls }} 次模型调用用量不完整。未知消耗按预留量保守计入，历史记录保留已知值；此统计不是供应商账单。</p>
          </div>
          <div class="integration-usage-scroll"><table><caption>最近 20 次调用</caption><thead><tr><th>时间</th><th>状态</th><th>耗时</th><th>Token</th><th>会话</th></tr></thead><tbody><tr v-for="call in detail?.recent" :key="call.id"><td>{{ date(call.createdAt) }}</td><td>{{ ({ completed: '完成', running: '进行中', failed: '失败', expired: '已过期' } as Record<string, string>)[call.status] }}</td><td>{{ call.durationMs === null ? '—' : `${call.durationMs} ms` }}</td><td>{{ call.totalTokens }}</td><td><RouterLink v-if="call.conversationId" :to="`/admin/conversations/${call.conversationId}`" @click="open = false">{{ call.conversationId.slice(0, 8) }} →</RouterLink><span v-else>—</span></td></tr></tbody></table></div>
          <p v-if="detail && !detail.recent.length" class="admin-muted">暂时没有调用记录。</p>
        </div>

      </div>
    </UiDialog>

    <UiDialog :open="keyOpen" :title="rotateId ? '轮换平台密钥' : '创建平台密钥'" description="轮换成功后旧密钥立即失效；平台的用户和会话保持不变。" :layer="70" @update:open="keyOpen = $event">
      <form class="integration-editor" @submit.prevent="createKey"><p v-if="error" class="integration-error" role="alert">{{ error }}</p><label>密钥名称<input v-model="keyForm.name" class="ui-input" required maxlength="100" placeholder="例如：售后系统生产环境" /></label><label>到期时间（可选）<input v-model="keyForm.expiresAt" class="ui-input" type="datetime-local" /></label><div class="integration-scopes"><label v-for="scope in scopes.filter(s => form.scopes.includes(s.id))" :key="scope.id" class="integration-check"><input v-model="keyForm.scopes" type="checkbox" :value="scope.id" />{{ scope.label }}</label></div><div class="integration-actions"><button type="button" class="ui-button secondary" @click="keyOpen = false">取消</button><button class="ui-button ui-button-primary" :disabled="busy || !keyForm.scopes.length">{{ busy ? '处理中…' : rotateId ? '确认轮换' : '创建密钥' }}</button></div></form>
    </UiDialog>
    <UiDialog :open="Boolean(secret)" title="请保存接入密钥" description="仅此次显示完整密钥。关闭后无法再次查看，请只保存到服务端安全配置中。" :layer="80" @update:open="$event || (secret = '')">
      <div class="integration-secret"><code>{{ secret }}</code></div><div class="integration-actions"><button class="ui-button secondary" @click="copy(secret, '接入密钥')"><Copy :size="15" />复制密钥</button><button class="ui-button ui-button-primary" @click="secret = ''">已保存，关闭</button></div>
    </UiDialog>
    <UiDialog :open="Boolean(confirmRevoke)" title="撤销平台密钥" :description="`撤销 ${confirmRevoke?.name ?? ''} 后，该密钥的新请求将立即被拒绝。会话和调用记录保留。`" :layer="70" size="sm" @update:open="$event || (confirmRevoke = null)"><p v-if="error" class="integration-error" role="alert">{{ error }}</p><div class="integration-actions"><button class="ui-button secondary" :disabled="busy" @click="confirmRevoke = null">取消</button><button class="ui-button ui-button-primary" :disabled="busy" @click="revoke">{{ busy ? '处理中…' : '确认撤销' }}</button></div></UiDialog>
  </section>
</template>

<style scoped>
.integration-admin { min-width: 0; }
.integration-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(min(100%,320px),1fr)); gap: 16px; }
.integration-card { display: block; min-width: 0; padding: 18px; border: 1px solid #e4e8ef; border-radius: 12px; background: white; text-align: left; cursor: pointer; transition: border-color .15s; }
.integration-card:hover { border-color: #8da8ef; }
.integration-card:focus-visible { outline: 2px solid #2457e6; outline-offset: 3px; }
.integration-card-head { display: flex; align-items: center; gap: 10px; }
.integration-card-head strong { flex: 1; color: #172033; font-size: 15px; overflow-wrap: anywhere; }
.integration-symbol { display: grid; place-items: center; width: 34px; height: 34px; background: #f0f5ff; border-radius: 8px; color: #2457e6; }
.integration-status { display: inline-flex; flex: none; padding: 4px 8px; border-radius: 5px; color: #25825c; background: #edf8f2; font-size: 11px; }
.integration-status.off { color: #667085; background: #f2f4f7; }
.integration-channels { margin: 14px 0 7px; color: #667085; font-size: 12px; }
.integration-card code { font-size: 11px; color: #8994a5; overflow-wrap: anywhere; }
.integration-card-meta { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; margin-top: 14px; padding-top: 12px; border-top: 1px solid #eef1f5; font-size: 12px; color: #667085; }
.integration-card-quota { margin: 8px 0 0; font-size: 12px; color: #8994a5; }
.integration-editor { min-width: 0; font-size: 13px; color: #344054; }
.integration-app-id { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-bottom: 16px; color: #667085; font-size: 12px; }
.integration-app-id code { min-width: 0; overflow-wrap: anywhere; }
.integration-tabs { display: flex; gap: 24px; border-bottom: 1px solid #e4e8ef; margin: -2px 0 22px; overflow-x: auto; }
.integration-tabs button { min-height: 42px; white-space: nowrap; background: none; border: 0; border-bottom: 2px solid transparent; color: #667085; font-size: 13px; cursor: pointer; }
.integration-tabs button.active { color: #2457e6; border-bottom-color: #2457e6; }
.integration-editor fieldset { padding: 0; margin: 0; border: 0; min-width: 0; }
.integration-editor label { display: grid; gap: 8px; font-weight: 500; min-width: 0; }
.integration-fields { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 16px; }
.integration-fields.limits { grid-template-columns: repeat(3,minmax(0,1fr)); margin-top: 22px; }
.integration-token-limit { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); align-items: center; gap: 10px 16px; margin-top: 20px; padding-top: 16px; border-top: 1px solid #eef1f5; }
.integration-token-limit small { grid-column: 1 / -1; color: #8994a5; font-size: 12px; line-height: 1.8; }
.integration-editor .ui-input { width: 100%; font-size: 13px; min-height: 42px; }
.integration-editor textarea.ui-input { resize: vertical; height: auto; min-height: 92px; padding: 12px; line-height: 1.7; }
.integration-editor label.integration-check { display: flex; align-items: center; gap: 8px; font-weight: 400; min-height: 36px; }
.integration-check input { accent-color: #2457e6; width: 16px; height: 16px; flex: none; }
.integration-check.enabled { align-self: end; margin-bottom: 3px; }
.integration-channels-select { display: flex; flex-wrap: wrap; gap: 24px; margin: 18px 0; }
.integration-origin small,.integration-hint { color: #8994a5; font-size: 12px; line-height: 1.8; font-weight: 400; }
.integration-scopes { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px; margin: 20px 0; }
.integration-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; padding-top: 18px; border-top: 1px solid #eef1f5; }
.integration-error { padding: 10px 12px; border: 1px solid #f3c5c5; color: #b42318; background: #fff6f6; border-radius: 6px; font-size: 13px; }
.integration-section-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
.integration-section-head p { margin: 0; color: #667085; font-size: 12px; line-height: 1.8; }
.integration-key-row { display: flex; gap: 12px; align-items: center; padding: 15px 0; border-top: 1px solid #eef1f5; }
.integration-key-row > div:first-of-type { flex: 1; min-width: 0; display: grid; gap: 5px; }
.integration-key-row strong { font-size: 13px; overflow-wrap: anywhere; }
.integration-key-row code,.integration-key-row small { color: #8994a5; font-size: 11px; }
.integration-key-actions { display: flex; gap: 6px; }
.ui-button.small { min-height: 32px; padding: 4px 9px; font-size: 12px; }
.ui-button.danger { color: #b42318; }
.integration-metrics { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); padding: 16px; margin: 0 0 22px; background: #f8fafc; border-radius: 8px; gap: 12px; }
.integration-metrics dt { color: #8994a5; font-size: 12px; }
.integration-metrics dd { margin: 8px 0 0; color: #172033; font-size: 21px; font-weight: 600; }
.integration-token-usage { margin-bottom: 22px; padding-bottom: 12px; border-bottom: 1px solid #eef1f5; }
.integration-token-usage strong { font-size: 13px; }
.integration-token-usage small { color: #8994a5; font-size: 11px; }
.integration-token-usage dl { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 12px; }
.integration-token-usage dt { color: #667085; font-size: 12px; }
.integration-token-usage dd { margin: 7px 0 0; color: #172033; font-size: 19px; font-weight: 600; overflow-wrap: anywhere; }
.integration-quota-track { height: 5px; background: #edf1f8; border-radius: 3px; overflow: hidden; margin: 16px 0 10px; }
.integration-quota-track span { display: block; height: 100%; background: #2457e6; transition: width .2s ease; }
.integration-accounting-warning { margin: 10px 0; font-size: 12px; line-height: 1.8; color: #9a6700; }
.integration-usage-scroll { max-height: 340px; overflow: auto; }
.integration-usage-scroll table { width: 100%; border-collapse: collapse; white-space: nowrap; font-size: 12px; }
.integration-usage-scroll caption { text-align: left; padding: 8px 0; color: #8994a5; }
.integration-usage-scroll th { text-align: left; font-weight: 500; color: #667085; background: #f8fafc; position: sticky; top: 0; }
.integration-usage-scroll th,.integration-usage-scroll td { padding: 10px; border-bottom: 1px solid #eef1f5; }
.integration-usage-scroll a { color: #2457e6; }
.integration-secret { padding: 16px; background: #f8fafc; border-radius: 8px; overflow-wrap: anywhere; color: #172033; }
.integration-editor button:focus-visible { outline: 2px solid #2457e6; outline-offset: 3px; }
.integration-editor input:disabled { opacity: .7; cursor: not-allowed; }
.spinning { animation: integration-spin 1s linear infinite; }
@keyframes integration-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinning { animation: none; } }
@media (max-width: 640px) { .integration-fields,.integration-fields.limits,.integration-token-limit { grid-template-columns: minmax(0,1fr); } .integration-key-row { flex-wrap: wrap; } .integration-key-actions { margin-left: 28px; } .integration-metrics,.integration-token-usage dl { grid-template-columns: repeat(2,minmax(0,1fr)); } .integration-tabs { gap: 18px; } .integration-editor .ui-button { min-height: 44px; } }
</style>
