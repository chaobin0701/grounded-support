import type { SkillDefinition } from '../skill.types';

export const customerSupportSkill: SkillDefinition = {
  id: 'customer_support',
  version: '2.0.0',
  name: '售后与政策咨询',
  description: '复杂售后、保修、退换货与政策解释的专项指导；基础问答不必先加载。',
  systemInstructions: `先理解用户的实际问题与已有条件，复用会话中已经确认的政策和资料。缺少适用条件或规则时，通过 search_knowledge 使用具体问题检索；只有确实需要补充信息时才再次查询。
把政策适用条件、可确认的处理步骤和例外情况分开说明。有来源时提供对应引用；资料缺失或互相矛盾时，说明已确认内容和未知部分，必要时向用户澄清或建议联系人工，不仅给出一句拒答。
当前系统只提供查询与咨询，不能凭空声称已办理退款、修改订单或完成售后操作；不要索取不必要的敏感信息。本指导不改变工具权限、回答格式或基础问答规则。`,
};
