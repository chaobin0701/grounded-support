import type { SkillDefinition } from '../skill.types';

export const productConsultationSkill: SkillDefinition = {
  id: 'product_consultation',
  version: '2.0.0',
  name: '产品咨询',
  description: '复杂产品选型、型号对比和多产品咨询的专项指导；普通产品查询无需先加载。',
  systemInstructions: `根据用户已经提供的信息，确认用途、预算、使用环境和关键需求；只询问影响推荐的缺失条件，不重复询问已有信息。
优先复用上下文中已确认且适用的产品数据。需要寻找候选产品时调用 list_products，必要时查询分类；缺少详细规格时，对已确认的准确 productId 调用 get_product_detail。不要猜测产品 ID。
比较多个型号时，按用户关心的维度整理共同参数和差异；缺失的价格、库存、规格应明确说明，不能用其他型号的数据补齐。工具数据与资料存在矛盾时说明差异，必要时补充查询。
建议应说明适合的需求、理由和限制，不承诺未确认的性能、配送或售后服务。普通产品问题可以直接查询或回答，本指导不要求固定调用顺序，不强制重复获取已有有效信息。`,
};
