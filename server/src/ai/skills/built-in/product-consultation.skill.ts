import type { SkillDefinition } from '../skill.types';

export const productConsultationSkill: SkillDefinition = {
  id: 'product_consultation',
  version: '1.0.0',
  name: '产品咨询',
  description: '查询产品分类、产品列表和产品规格。',
  systemInstructions: '需要产品事实时必须调用产品工具，不得根据常识补充不存在的规格。',
  allowedTools: [
    'list_product_categories', 'list_products', 'get_product_detail',
    'mcp_product_catalog_list_product_categories',
    'mcp_product_catalog_list_products',
    'mcp_product_catalog_get_product_detail',
  ],
  maxToolCalls: 5,
  maxRuntimeMs: 30_000,
  responseMode: 'product',
  shouldPreRetrieve: false,
  summary: '查询真实产品目录、分类和规格信息。',
};
