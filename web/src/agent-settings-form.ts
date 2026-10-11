import type { AgentEditableConfiguration, AgentConfigurationView } from './admin-api';

export const memoryFields = [] as const;
export const advancedMemoryFields = [] as const;
export const runtimeFields = [
  { key: 'maxToolCalls', label: '工具调用上限', min: 1, max: 20, hint: '每次请求的总次数，包含读取 Skill。' },
  { key: 'maxPlannerRounds', label: '模型规划轮数上限', min: 2, max: 30, hint: '必须大于工具次数上限，留出最终回答机会。' },
  { key: 'toolTimeoutMs', label: '单次工具超时（毫秒）', min: 1000, max: 120000, hint: '不是模型请求超时；模型参数在模型服务中配置。' },
  { key: 'maxToolResultChars', label: '工具文本结果字符上限', min: 1000, max: 50000, hint: '限制工具返回给模型的文本长度。' },
] as const;

export function toggleCapability(settings: AgentEditableConfiguration, group: AgentConfigurationView['capabilities'][number], enabled: boolean) {
  if (group.system) return;
  const names = new Set(group.tools.map(tool => tool.name));
  const allowed = settings.runtime.allowedTools.filter(name => !names.has(name));
  settings.runtime.allowedTools = enabled ? [...allowed, ...names] : allowed;
}

export function validateAgentSettings(settings: AgentEditableConfiguration): Record<string, string> {
  const errors: Record<string, string> = {};
  const text = (key: string, value: string, max: number) => { if (!value.trim() || value.trim().length > max) errors[key] = `请填写 1–${max} 个字符。`; };
  text('identity.name', settings.identity.name, 80); text('identity.role', settings.identity.role, 200);
  text('identity.persona', settings.identity.persona, 8000); text('answeringInstructions', settings.answeringInstructions, 12000);
  text('welcome.title', settings.welcome.title, 200); text('welcome.description', settings.welcome.description, 500);
  if (!settings.welcome.suggestedQuestions.length || settings.welcome.suggestedQuestions.length > 6 || settings.welcome.suggestedQuestions.some(question => question.trim().length < 2 || question.trim().length > 200)) errors['welcome.suggestedQuestions'] = '推荐问题为 1–6 条，每条 2–200 个字符。';
  for (const [section, fields] of [['runtime', runtimeFields]] as const) {
    for (const field of fields) {
      const value = (settings[section] as unknown as Record<string, number>)[field.key];
      if (!Number.isInteger(value) || value < field.min || value > field.max) errors[`${section}.${field.key}`] = `请输入 ${field.min}–${field.max} 的整数。`;
    }
  }
  if (settings.runtime.maxPlannerRounds <= settings.runtime.maxToolCalls) errors['runtime.maxPlannerRounds'] = '规划轮数必须大于工具次数，保留最终回答机会。';
  return errors;
}
