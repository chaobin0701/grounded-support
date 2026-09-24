import type { SkillDefinition } from '../skill.types';

export const customerSupportSkill: SkillDefinition = {
  id: 'customer_support',
  version: '1.0.0',
  name: '客户知识库问答',
  description: '基于商家已上传资料回答客户问题。',
  systemInstructions: '只允许根据检索到的资料回答。没有足够证据时必须明确拒答，回答必须包含合法引用。',
  allowedTools: ['search_knowledge'],
  maxToolCalls: 3,
  maxRuntimeMs: 30_000,
  responseMode: 'grounded',
  shouldPreRetrieve: false,
  preRetrievalTopK: 5,
  summary: '基于已上传资料回答售后、政策和使用问题。',
};
