<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Bot, ChevronDown, ChevronUp, LockKeyhole, Plus, RefreshCw, Save, Trash2 } from '@lucide/vue';
import { adminApi, AdminApiError, type AgentConfigurationView, type AgentEditableConfiguration } from './admin-api';
import { advancedMemoryFields, memoryFields, runtimeFields, toggleCapability, validateAgentSettings } from './agent-settings-form';
import AdminPageHeader from './ui/AdminPageHeader.vue';
import UiDialog from './ui/UiDialog.vue';
import ToastNotice from './ui/ToastNotice.vue';

const props = withDefaults(defineProps<{ token: string; permissions?: string[] }>(), { permissions: () => [] });
const configuration = ref<AgentConfigurationView | null>(null);
const draft = ref<AgentEditableConfiguration | null>(null);
const loading = ref(false), saving = ref(false), error = ref(''), notice = ref(''), conflict = ref(false);
const attempted = ref(false), touched = reactive<Record<string, boolean>>({});
const tab = ref('basic');
const tabs = [{ id: 'basic', name: '基本与回答' }, { id: 'memory', name: '会话与记忆' }, { id: 'capabilities', name: 'Skills 与工具' }, { id: 'advanced', name: '高级设置' }];
const canEdit = computed(() => props.permissions.includes('agent_config.manage') && configuration.value?.readOnly === false);
const dirty = computed(() => !!draft.value && JSON.stringify(draft.value) !== JSON.stringify(configuration.value?.settings));
const errors = computed(() => draft.value ? validateAgentSettings(draft.value) : {});
const visibleError = (path: string) => attempted.value || touched[path] ? errors.value[path] : '';
const confirmAction = ref<'reload' | 'discard' | 'leave' | null>(null);
let resolveLeave: ((leave: boolean) => void) | undefined;
let requestId = 0;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

function accept(value: AgentConfigurationView) {
  configuration.value = value;
  draft.value = clone(value.settings);
  attempted.value = false; conflict.value = false;
  for (const key of Object.keys(touched)) delete touched[key];
}
async function load() {
  const id = ++requestId; loading.value = true; error.value = '';
  try { const value = await adminApi.agentConfig(props.token); if (id === requestId) accept(value); }
  catch (cause) { if (id === requestId) error.value = cause instanceof AdminApiError ? cause.message : '配置加载失败，请重试。'; }
  finally { if (id === requestId) loading.value = false; }
}
async function save() {
  if (!canEdit.value || !dirty.value || !draft.value || !configuration.value || saving.value) return;
  attempted.value = true;
  const invalid = Object.keys(errors.value);
  if (invalid.length) {
    const first = invalid[0]; tab.value = first.startsWith('memory.') || first.startsWith('welcome.') ? 'memory' : first.startsWith('runtime.') ? 'advanced' : 'basic';
    error.value = '请检查标出的字段；高级记忆字段可在折叠区域中查看。'; return;
  }
  const id = ++requestId; saving.value = true; error.value = ''; conflict.value = false;
  try {
    const value = await adminApi.saveAgentConfig(props.token, configuration.value.revision, configuration.value.configurationVersion, clone(draft.value));
    if (id === requestId) { accept(value); notice.value = '配置已保存，将用于后续请求；正在执行的回答不受影响。'; }
  } catch (cause) {
    if (id === requestId) { conflict.value = cause instanceof AdminApiError && cause.status === 409; error.value = cause instanceof AdminApiError ? cause.message : '保存失败，修改已保留，请重试。'; }
  } finally { if (id === requestId) saving.value = false; }
}
function reload() { if (dirty.value) confirmAction.value = 'reload'; else void load(); }
function finishConfirmation(confirmed: boolean) {
  const action = confirmAction.value; confirmAction.value = null;
  if (action === 'leave') { resolveLeave?.(confirmed); resolveLeave = undefined; return; }
  if (!confirmed) return;
  if (action === 'reload') void load();
  else if (configuration.value) { accept(configuration.value); error.value = ''; }
}
function toggleSkill(id: string, enabled: boolean) {
  if (!draft.value || !canEdit.value) return;
  draft.value.enabledSkills = enabled ? [...draft.value.enabledSkills.filter(value => value !== id), id] : draft.value.enabledSkills.filter(value => value !== id);
}
function enabledCapability(group: AgentConfigurationView['capabilities'][number]) {
  return group.system ? !!draft.value?.enabledSkills.length : group.tools.every(tool => draft.value?.runtime.allowedTools.includes(tool.name));
}
function changeCapability(group: AgentConfigurationView['capabilities'][number], event: Event) {
  if (draft.value && canEdit.value) toggleCapability(draft.value, group, (event.target as HTMLInputElement).checked);
}
function moveQuestion(index: number, direction: number) {
  if (!draft.value) return;
  const questions = draft.value.welcome.suggestedQuestions;
  [questions[index], questions[index + direction]] = [questions[index + direction], questions[index]];
}
function keyboardTab(event: KeyboardEvent, index: number) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tab.value = tabs[next].id; document.getElementById(`agent-tab-${tab.value}`)?.focus();
}
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value) { event.preventDefault(); event.returnValue = ''; } }
// Admin sections render outside RouterView; use a scoped global guard instead of
// component leave guards, which would silently have no active route record.
const removeNavigationGuard = useRouter().beforeEach((to, from) => to.path === from.path || !dirty.value ? true : new Promise<boolean>(resolve => { resolveLeave = resolve; confirmAction.value = 'leave'; }));
watch(() => props.token, () => { requestId++; configuration.value = null; draft.value = null; void load(); });
onMounted(() => { void load(); window.addEventListener('beforeunload', beforeUnload); });
onUnmounted(() => { requestId++; removeNavigationGuard(); window.removeEventListener('beforeunload', beforeUnload); resolveLeave?.(false); });
</script>

<template>
  <section class="agent-config-page" :aria-busy="loading || saving">
    <AdminPageHeader title="Agent 配置">
      <template #badge><span v-if="configuration" class="agent-badge" :class="{ changed: dirty }"><LockKeyhole v-if="!canEdit" :size="12" aria-hidden="true" />{{ !canEdit ? '只读' : dirty ? '未保存' : '已保存' }}</span></template>
      <template #actions>
        <button class="admin-text-button" type="button" :disabled="loading || saving" @click="reload"><RefreshCw :size="14" aria-hidden="true" />刷新</button>
        <button v-if="canEdit" class="agent-primary" type="button" :disabled="loading || saving || !dirty" @click="save"><Save :size="14" aria-hidden="true" />{{ saving ? '保存中…' : '保存配置' }}</button>
      </template>
    </AdminPageHeader>
    <div v-if="error" class="agent-error" role="alert"><span>{{ error }}</span><button v-if="conflict || !configuration" type="button" class="admin-text-button" @click="reload">重新加载</button></div>
    <p v-if="!configuration && loading" class="agent-loading" role="status">正在读取配置…</p>
    <template v-if="configuration && draft">
      <div class="agent-overview">
        <div class="agent-identity"><span class="agent-symbol" aria-hidden="true"><Bot :size="20" /></span><div><strong>{{ configuration.identity.name }}</strong><small>{{ configuration.identity.role }}</small></div></div>
        <div class="agent-model"><small>当前模型</small><RouterLink to="/admin/model-services">{{ configuration.model.name }}</RouterLink></div>
        <div class="agent-version"><small>配置版本</small><strong>v{{ configuration.configurationVersion }}</strong><small>{{ configuration.updatedAt ? new Date(configuration.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '文件配置' }}</small></div>
      </div>
      <nav class="agent-tabs" role="tablist" aria-label="Agent 配置分类"><button v-for="(item, index) in tabs" :id="`agent-tab-${item.id}`" :key="item.id" role="tab" type="button" :aria-selected="tab === item.id" :aria-controls="`agent-panel-${item.id}`" :tabindex="tab === item.id ? 0 : -1" :class="{ active: tab === item.id }" @click="tab = item.id" @keydown="keyboardTab($event, index)">{{ item.name }}</button></nav>

      <div :id="`agent-panel-${tab}`" role="tabpanel" :aria-labelledby="`agent-tab-${tab}`" class="agent-tab-panel">
        <fieldset :disabled="!canEdit || saving || loading" class="agent-fields">
          <template v-if="tab === 'basic'">
            <div class="agent-section-head"><h2>基本信息</h2><p>调整助手的身份与交流方式，不修改官网品牌信息。</p></div>
            <div class="agent-form-grid">
              <label>助手名称<input v-model="draft.identity.name" maxlength="80" :aria-invalid="!!visibleError('identity.name')" @blur="touched['identity.name'] = true" /><small class="field-error">{{ visibleError('identity.name') }}</small></label>
              <label>角色描述<input v-model="draft.identity.role" maxlength="200" :aria-invalid="!!visibleError('identity.role')" @blur="touched['identity.role'] = true" /><small class="field-error">{{ visibleError('identity.role') }}</small></label>
              <label>回答语气<select v-model="draft.responseStyle.tone"><option value="professional">专业清晰</option><option value="friendly">亲切自然</option><option value="concise">简洁直接</option></select></label>
              <label>回答详细程度<select v-model="draft.responseStyle.detail"><option value="brief">简短</option><option value="balanced">适度展开</option><option value="detailed">详细解释</option></select></label>
              <label class="full">基本人设<textarea v-model="draft.identity.persona" rows="4" maxlength="8000" :aria-invalid="!!visibleError('identity.persona')" @blur="touched['identity.persona'] = true" /><small class="field-error">{{ visibleError('identity.persona') }}</small></label>
              <label class="full">基础业务指导<textarea v-model="draft.answeringInstructions" rows="9" maxlength="12000" :aria-invalid="!!visibleError('answeringInstructions')" @blur="touched['answeringInstructions'] = true" /><small>基础问答始终由默认提示词处理。专项 Skill 按需读取，不必预选。</small><small class="field-error">{{ visibleError('answeringInstructions') }}</small></label>
            </div>
          </template>

          <template v-else-if="tab === 'memory'">
            <div class="agent-section-head"><h2>首轮对话</h2><p>官网机器人与完整助手共用，右侧预览当前未保存内容。</p></div>
            <div class="agent-welcome-grid"><div class="agent-form-grid">
              <label class="full">欢迎标题<input v-model="draft.welcome.title" maxlength="200" :aria-invalid="!!visibleError('welcome.title')" @blur="touched['welcome.title'] = true" /><small class="field-error">{{ visibleError('welcome.title') }}</small></label>
              <label class="full">欢迎说明<textarea v-model="draft.welcome.description" rows="2" maxlength="500" :aria-invalid="!!visibleError('welcome.description')" @blur="touched['welcome.description'] = true" /><small class="field-error">{{ visibleError('welcome.description') }}</small></label>
              <div class="full agent-questions"><div class="agent-inline-head"><h3>推荐问题</h3><button type="button" class="agent-quiet" :disabled="draft.welcome.suggestedQuestions.length >= 6" @click="draft.welcome.suggestedQuestions.push('')"><Plus :size="14" />添加</button></div>
                <div v-for="(_, index) in draft.welcome.suggestedQuestions" :key="index" class="agent-question-row"><input v-model="draft.welcome.suggestedQuestions[index]" :aria-label="`推荐问题 ${index + 1}`" maxlength="200" @blur="touched['welcome.suggestedQuestions'] = true" /><button type="button" :disabled="index === 0" :aria-label="`上移推荐问题 ${index + 1}`" @click="moveQuestion(index, -1)"><ChevronUp :size="15" /></button><button type="button" :disabled="index === draft.welcome.suggestedQuestions.length - 1" :aria-label="`下移推荐问题 ${index + 1}`" @click="moveQuestion(index, 1)"><ChevronDown :size="15" /></button><button type="button" :disabled="draft.welcome.suggestedQuestions.length <= 1" :aria-label="`删除推荐问题 ${index + 1}`" @click="draft.welcome.suggestedQuestions.splice(index, 1)"><Trash2 :size="14" /></button></div>
                <small class="field-error">{{ visibleError('welcome.suggestedQuestions') }}</small><p class="agent-hint">1–6 条，每条 2–200 个字符。</p>
              </div>
            </div><aside class="agent-welcome-preview"><small>首轮效果预览</small><strong>{{ draft.welcome.title || '欢迎标题' }}</strong><p>{{ draft.welcome.description }}</p><ul><li v-for="(question, index) in draft.welcome.suggestedQuestions" :key="index">{{ question || '推荐问题' }}</li></ul></aside></div>
            <div class="agent-section-head separated"><h2>会话记忆</h2><p>摘要异步执行，不清空历史；已有工具事实仍可复用。</p></div>
            <div class="agent-form-grid"><label v-for="field in memoryFields" :key="field.key">{{ field.label }}<input v-model.number="draft.memory[field.key]" type="number" :min="field.min" :max="field.max" step="1" :aria-invalid="!!visibleError(`memory.${field.key}`)" @blur="touched[`memory.${field.key}`] = true" /><small>{{ field.hint }}</small><small class="field-error">{{ visibleError(`memory.${field.key}`) }}</small></label></div>
            <details class="agent-detail" :open="attempted && (!!errors['memory.summaryInstructions'] || advancedMemoryFields.some(field => errors[`memory.${field.key}`]))"><summary>高级记忆设置<ChevronDown :size="14" /></summary><div class="agent-form-grid"><label v-for="field in advancedMemoryFields" :key="field.key">{{ field.label }}<input v-model.number="draft.memory[field.key]" type="number" :min="field.min" :max="field.max" step="1" :aria-invalid="!!visibleError(`memory.${field.key}`)" @blur="touched[`memory.${field.key}`] = true" /><small>{{ field.hint }}</small><small class="field-error">{{ visibleError(`memory.${field.key}`) }}</small></label><label class="full">摘要指导<textarea v-model="draft.memory.summaryInstructions" rows="5" maxlength="8000" @blur="touched['memory.summaryInstructions'] = true" /><small class="field-error">{{ visibleError('memory.summaryInstructions') }}</small></label></div></details>
          </template>

          <template v-else-if="tab === 'capabilities'">
            <div class="agent-section-head"><h2>专项指导 <span class="agent-section-count">{{ draft.enabledSkills.length }} / {{ configuration.availableSkills.length }} 已开启</span></h2><p>模型按需读取指导；基础问答不必先加载 Skill，指导正文与 ID 保持只读。</p></div>
            <div class="agent-capability-grid" aria-label="专项 Skills">
            <article v-for="skill in configuration.availableSkills" :key="skill.id" class="agent-capability"><div class="agent-capability-head"><div><h3>{{ skill.name }}<span class="agent-tag">{{ skill.version }}</span></h3><code>{{ skill.id }}</code></div><label class="agent-toggle"><span>{{ draft.enabledSkills.includes(skill.id) ? '可供模型读取' : '已停用' }}</span><input type="checkbox" role="switch" :aria-label="`启用 ${skill.name}`" :checked="draft.enabledSkills.includes(skill.id)" @change="toggleSkill(skill.id, ($event.target as HTMLInputElement).checked)" /></label></div><p>{{ skill.description }}</p><details class="agent-detail"><summary>查看详细指导<ChevronDown :size="14" /></summary><pre>{{ skill.instructions }}</pre></details></article>
            </div>
            <p v-if="!configuration.availableSkills.length" class="agent-hint">暂无注册的专项指导，基础回答仍可使用。</p><p class="agent-note">停用仅影响新加载，不删除历史上下文。关闭全部 Skills 后，系统自动移除 load_skill。</p>
            <div class="agent-section-head agent-tools-heading"><h2>工具能力 <span class="agent-section-count">{{ configuration.capabilities.filter(group => !group.system && enabledCapability(group)).length }} 项业务能力已开启</span></h2><p>本地与同功能 MCP 工具统一启停；系统能力由可用 Skills 自动控制。</p></div>
            <div class="agent-capability-grid" aria-label="工具能力">
            <article v-for="group in configuration.capabilities" :key="group.id" class="agent-capability"><div class="agent-capability-head"><div><h3>{{ group.name }}<span v-if="group.system" class="agent-tag">系统管理</span></h3><small>数据来源 · {{ group.source }}</small></div><label v-if="!group.system" class="agent-toggle"><span>{{ enabledCapability(group) ? '可供模型调用' : '已停用' }}</span><input type="checkbox" role="switch" :aria-label="`启用 ${group.name}`" :checked="enabledCapability(group)" @change="changeCapability(group, $event)" /></label><span v-else class="agent-hint">{{ enabledCapability(group) ? '随可用 Skills 开启' : '无可用 Skill' }}</span></div><p>{{ group.description }}</p><details class="agent-detail"><summary>工具参数与执行规则 · {{ group.tools.length }} 个实现<ChevronDown :size="14" /></summary><div v-for="tool in group.tools" :key="tool.name" class="agent-tool-info"><div><code>{{ tool.name }}</code><span class="agent-tag">{{ tool.source }}</span></div><p>{{ tool.description }}</p><small>{{ tool.canBatch ? '可与独立查询同批返回，按顺序执行。' : '单独读取，下一轮再决定后续动作。' }} {{ tool.dependency }}</small><pre>{{ JSON.stringify(tool.parameters, null, 2) }}</pre></div></details></article>
            </div>
          </template>

          <template v-else>
            <div class="agent-section-head"><h2>运行预算</h2><p>限制请求成本与等待时间，不干涉模型是否直接回答。</p></div>
            <div class="agent-form-grid"><label v-for="field in runtimeFields" :key="field.key">{{ field.label }}<input v-model.number="draft.runtime[field.key]" type="number" :min="field.min" :max="field.max" step="1" :aria-invalid="!!visibleError(`runtime.${field.key}`)" @blur="touched[`runtime.${field.key}`] = true" /><small>{{ field.hint }}</small><small class="field-error">{{ visibleError(`runtime.${field.key}`) }}</small></label></div>
          </template>
        </fieldset>
        <template v-if="tab === 'advanced'">
          <div class="agent-section-head separated"><h2>系统规则 · 只读</h2><p>以下由代码维护，不能通过行为配置绕过。</p></div><dl class="agent-system-grid"><div><dt>答案校验</dt><dd>仅基础格式校验</dd></div><div><dt>多工具执行</dt><dd>按顺序执行</dd></div><div><dt>重复调用保护</dt><dd>同一请求防止重复调用</dd></div><div><dt>问题处理</dt><dd>不做关键词分流，不预选 Skill</dd></div><div><dt>模型上下文 / 输出</dt><dd>{{ configuration.model.contextWindowTokens.toLocaleString() }} / {{ configuration.model.maxOutputTokens.toLocaleString() }} tokens</dd></div></dl>
          <details class="agent-detail"><summary>输出与工具协议<ChevronDown :size="14" /></summary><pre>{{ configuration.prompts.protocol }}</pre></details><details class="agent-detail"><summary>最终回答生成规则<ChevronDown :size="14" /></summary><pre>{{ configuration.answerInstructions }}</pre></details><details class="agent-detail"><summary>完整默认提示词 · 已保存版本<ChevronDown :size="14" /></summary><p class="agent-hint">未保存编辑不会改变这里的运行预览；每轮实际模型上下文请查看会话轨迹。</p><pre>{{ configuration.prompts.assembled }}</pre></details>
          <details class="agent-detail"><summary>内部辅助机制（utils）<ChevronDown :size="14" /></summary><p class="agent-hint">响应归一化、格式解析、文本截断与上下文构建是系统内部实现，不作为业务工具或启停选项。</p></details>
        </template>
      </div>
      <footer class="agent-save-bar"><div><strong>{{ dirty ? '有未保存的修改' : canEdit ? '配置已保存' : '当前账号仅可查看' }}</strong><small>保存后用于新请求，执行中的回答保持原配置。来源：{{ configuration.source }} · {{ configuration.revision }}</small></div><button v-if="canEdit" type="button" class="admin-text-button" :disabled="!dirty || saving || loading" @click="confirmAction = 'discard'">撤销修改</button></footer>
    </template>
    <UiDialog :open="confirmAction !== null" title="放弃未保存的修改？" description="已保存的运行配置不会改变。" size="sm" @update:open="!$event && finishConfirmation(false)"><div class="agent-confirm-actions"><button type="button" class="admin-text-button" @click="finishConfirmation(false)">继续编辑</button><button type="button" class="agent-primary" @click="finishConfirmation(true)">放弃修改</button></div></UiDialog>
    <ToastNotice :message="notice" @dismiss="notice = ''" />
  </section>
</template>

<style scoped>
.agent-form-grid input,.agent-form-grid textarea,.agent-form-grid select,.agent-question-row input{font-size:13px;line-height:1.7;font-weight:400}
.agent-form-grid select{appearance:auto;padding-right:28px}
.agent-config-page{color:#172033;min-width:0;width:100%;margin:0;padding:0;--agent-line:#e5e9f0;--agent-muted:#667085;--agent-blue:#2457e6}
.admin-text-button,.agent-primary,.agent-quiet{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:38px;cursor:pointer;font-size:12px;white-space:nowrap}.agent-primary{padding:0 15px;border:1px solid var(--agent-blue);border-radius:7px;background:var(--agent-blue);color:#fff;font-weight:600}.agent-primary:hover:not(:disabled){background:#1c46c8}.agent-primary:disabled{opacity:.5;cursor:not-allowed}.agent-badge,.agent-tag{display:inline-flex;align-items:center;gap:5px;padding:3px 7px;border:1px solid var(--agent-line);border-radius:5px;font-size:11px;color:var(--agent-muted);font-weight:400}.agent-badge.changed{color:#946200;background:#fff9ec;border-color:#efdbab}
.agent-overview{display:flex;align-items:center;gap:24px;padding:14px 16px;margin-bottom:20px;border:1px solid var(--agent-line);border-radius:10px;background:#fafbfc}.agent-identity{display:flex;gap:11px;align-items:center;flex:1;min-width:0}.agent-symbol{display:grid;place-items:center;width:40px;height:40px;flex:none;background:#edf3ff;color:var(--agent-blue);border-radius:10px}.agent-identity strong{font-size:15px}.agent-overview small{display:block;color:var(--agent-muted);font-size:11px;line-height:1.7;margin-top:3px}.agent-model{min-width:0}.agent-model a{display:block;overflow-wrap:anywhere;font:12px/1.8 ui-monospace,monospace;color:var(--agent-blue);text-decoration:none}.agent-version strong{font-size:13px;font-weight:600}
.agent-tabs{display:flex;gap:24px;border-bottom:1px solid var(--agent-line);margin:0 0 26px;overflow-x:auto}.agent-tabs button{position:relative;flex:none;min-height:46px;border:0;border-bottom:2px solid transparent;background:transparent;padding:0 1px;color:var(--agent-muted);font-size:13px;cursor:pointer}.agent-tabs button.active{color:var(--agent-blue);border-bottom-color:var(--agent-blue);font-weight:600}.agent-tab-panel{min-width:0;width:100%}.agent-fields{min-width:0;margin:0;padding:0;border:0}.agent-section-head{margin:0 0 16px}.agent-section-head h2{margin:0;font-size:15px;font-weight:600}.agent-section-head p,.agent-hint,.agent-note{font-size:12px;color:var(--agent-muted);line-height:1.8;margin:8px 0 0}.separated{padding-top:26px;margin-top:26px;border-top:1px solid var(--agent-line)}
.agent-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 24px}.agent-form-grid label{display:flex;flex-direction:column;gap:7px;font-size:12px;color:#344054;font-weight:600}.full{grid-column:1/-1}.agent-form-grid input,.agent-form-grid textarea,.agent-form-grid select,.agent-question-row input{box-sizing:border-box;width:100%;border:1px solid #d9e1eb;border-radius:7px;background:#fff;color:#344054;font-size:13px;line-height:1.7;padding:9px 11px;min-height:40px;font-family:inherit}.agent-form-grid textarea{resize:vertical;min-height:85px;line-height:1.8}.agent-form-grid small{font-weight:400;font-size:11px;line-height:1.7;color:var(--agent-muted)}.agent-form-grid input:disabled,.agent-form-grid textarea:disabled,.agent-form-grid select:disabled{background:#f8f9fb;color:#475467;opacity:1}.agent-config-page [aria-invalid=true]{border-color:#d04438}.agent-form-grid .field-error,.field-error{color:#b42318;font-size:11px;line-height:1.7}.field-error:empty{display:none}
.agent-welcome-grid{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:28px;align-items:start}.agent-welcome-preview{padding:22px;border:1px solid var(--agent-line);border-radius:10px;background:#f8faff;min-width:0}.agent-welcome-preview>small{color:var(--agent-muted);font-size:11px}.agent-welcome-preview strong{display:block;margin:18px 0 10px;font-size:15px;overflow-wrap:anywhere}.agent-welcome-preview p{font-size:12px;line-height:1.8;color:var(--agent-muted);overflow-wrap:anywhere}.agent-welcome-preview ul{padding:0;margin:20px 0 0;list-style:none;display:grid;gap:8px}.agent-welcome-preview li{padding:9px 11px;background:#fff;border:1px solid var(--agent-line);border-radius:6px;font-size:12px;line-height:1.7;overflow-wrap:anywhere}.agent-inline-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:9px}.agent-inline-head h3{font-size:12px;margin:0;color:#344054;font-weight:600}.agent-quiet{border:0;color:var(--agent-blue);background:none;padding:0 6px}.agent-question-row{display:flex;gap:4px;align-items:center;margin-top:7px}.agent-question-row input{flex:1;min-width:0}.agent-question-row button{display:grid;place-items:center;flex:none;width:30px;height:40px;border:0;background:none;color:#667085;border-radius:6px;cursor:pointer}.agent-question-row button:hover:not(:disabled){background:#f0f3f8}.agent-question-row button:disabled{opacity:.35;cursor:not-allowed}
.agent-capability-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}.agent-capability{min-width:0;padding:16px;border:1px solid var(--agent-line);border-radius:10px;background:#fff}.agent-capability .agent-detail{margin-top:14px;padding-top:10px}.agent-tools-heading{margin-top:28px}.agent-section-count{margin-left:8px;color:var(--agent-muted);font-size:12px;font-weight:400}.agent-capability-grid .agent-capability-head>div{min-width:0}.agent-capability-grid .agent-capability-head h3{flex-wrap:wrap}.agent-capability-grid .agent-toggle{min-height:44px}.agent-capability-head{display:flex;justify-content:space-between;align-items:center;gap:18px}.agent-capability-head h3{display:flex;align-items:center;gap:9px;margin:0 0 6px;font-size:14px;font-weight:600}.agent-capability-head small,.agent-capability>p{color:var(--agent-muted);font-size:12px;line-height:1.8}.agent-capability>p{margin:9px 0 0}.agent-capability code{font:11px/1.8 ui-monospace,monospace;overflow-wrap:anywhere;color:#475467}.agent-toggle{display:flex;align-items:center;gap:10px;color:var(--agent-muted);font-size:11px;flex:none}.agent-toggle input{appearance:none;width:34px;height:20px;border:1px solid #bec8d6;border-radius:20px;background:#c1cad6;position:relative;margin:0;cursor:pointer;transition:background .15s}.agent-toggle input::after{content:'';position:absolute;width:14px;height:14px;top:2px;left:2px;border-radius:50%;background:#fff;transition:transform .15s}.agent-toggle input:checked{background:var(--agent-blue);border-color:var(--agent-blue)}.agent-toggle input:checked::after{transform:translateX(14px)}.agent-toggle input:disabled{cursor:not-allowed;opacity:.6}.agent-note{margin-top:22px;padding:12px 15px;border-radius:7px;background:#f8f9fb}
.agent-detail{margin-top:20px;padding-top:14px;border-top:1px solid var(--agent-line)}.agent-detail summary{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:32px;cursor:pointer;color:#475467;font-size:12px;list-style:none}.agent-detail summary::-webkit-details-marker{display:none}.agent-detail[open] summary>svg{transform:rotate(180deg)}.agent-detail .agent-form-grid{margin-top:18px}.agent-detail pre{box-sizing:border-box;max-width:100%;max-height:340px;padding:15px;border-radius:7px;background:#f8f9fc;white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto;font:12px/1.8 ui-monospace,monospace;color:#475467}.agent-tool-info{padding-top:15px}.agent-tool-info>div{display:flex;align-items:center;gap:10px}.agent-tool-info p,.agent-tool-info small{font-size:11px;color:var(--agent-muted);line-height:1.8}.agent-system-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin:0}.agent-system-grid dt{font-size:11px;color:var(--agent-muted)}.agent-system-grid dd{margin:6px 0 0;font-size:12px;line-height:1.7;overflow-wrap:anywhere}.agent-save-bar{display:flex;justify-content:space-between;align-items:center;gap:16px;border-top:1px solid var(--agent-line);padding-top:18px;margin-top:24px}.agent-save-bar strong{display:block;font-size:12px;font-weight:500}.agent-save-bar small{display:block;margin-top:6px;font-size:11px;color:var(--agent-muted);line-height:1.7;overflow-wrap:anywhere}.agent-error{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:12px 14px;margin:0 0 20px;background:#fff5f3;border:1px solid #f3d6d0;border-radius:7px;color:#b42318;font-size:12px;line-height:1.8}.agent-loading{padding:35px 0;color:var(--agent-muted);font-size:13px}.agent-confirm-actions{display:flex;justify-content:flex-end;gap:10px}.agent-config-page button:focus-visible,.agent-config-page input:focus-visible,.agent-config-page textarea:focus-visible,.agent-config-page select:focus-visible,.agent-config-page summary:focus-visible{outline:2px solid var(--agent-blue);outline-offset:3px}
@media(max-width:800px){.agent-capability-grid{grid-template-columns:1fr}.agent-section-count{display:block;margin:6px 0 0}.agent-overview{padding:12px 14px}.agent-welcome-grid{grid-template-columns:1fr}.agent-welcome-preview{max-width:none}.agent-overview{flex-wrap:wrap;gap:14px 24px}.agent-identity{flex-basis:100%}.agent-tabs{gap:20px}}
@media(max-width:520px){.agent-form-grid,.agent-system-grid{grid-template-columns:1fr}.agent-form-grid .full{grid-column:1}.agent-tabs{gap:18px;margin-bottom:22px}.agent-overview{padding-bottom:16px}.agent-capability-head{align-items:flex-start}.agent-toggle{gap:7px}.agent-toggle span{max-width:70px;line-height:1.7}.agent-form-grid input,.agent-form-grid textarea,.agent-form-grid select,.agent-question-row input{font-size:16px}.agent-question-row button{width:27px}.agent-save-bar{align-items:flex-start}.agent-version small{font-size:10px}.agent-model a{font-size:11px}}
@media(prefers-reduced-motion:reduce){.agent-toggle input,.agent-toggle input::after{transition:none}}
</style>
