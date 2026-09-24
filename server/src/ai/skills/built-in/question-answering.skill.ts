import type { SkillDefinition } from '../skill.types';

export const questionAnsweringSkill: SkillDefinition = {
  id: 'question_answering',
  version: '1.0.0',
  name: '统一问答 Agent',
  description: '根据当前问题自主决定直接回复、检索知识库或查询产品目录。',
  systemInstructions: '你可以先判断用户是在闲聊，还是需要商家资料或产品事实。闲聊可以直接自然回复；需要业务事实时使用合适的工具；没有可靠证据时说明已确认内容和缺失信息，不编造结论。',
  allowedTools: [
    'search_knowledge', 'list_product_categories', 'list_products', 'get_product_detail',
    'mcp_product_catalog_list_product_categories', 'mcp_product_catalog_list_products',
    'mcp_product_catalog_get_product_detail',
  ],
  maxToolCalls: 5,
  maxRuntimeMs: 30_000,
  responseMode: 'auto',
  shouldPreRetrieve: false,
  summary: '统一理解用户问题，并按需使用知识库或产品工具。',
};
