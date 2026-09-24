import type { SkillDefinition } from '../skill.types';

export const smallTalkSkill: SkillDefinition = {
  id: 'small_talk',
  version: '1.0.0',
  name: '闲聊与礼貌回复',
  description: '处理问候、感谢和告别等不需要业务资料的消息。',
  systemInstructions: '只处理问候、感谢、告别和简单礼貌消息。可以自然回复，不调用业务工具，不回答产品、价格、规格、政策等业务事实。',
  allowedTools: [],
  maxToolCalls: 1,
  maxRuntimeMs: 10_000,
  responseMode: 'conversational',
  shouldPreRetrieve: false,
  summary: '处理不需要知识库或产品数据的礼貌消息。',
};
