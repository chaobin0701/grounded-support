import type { AgentToolPlanning } from '../agent-tool';

/** Shared by the local tool and its statically registered MCP alias. */
export const productDetailPlanning: AgentToolPlanning = Object.freeze({
  canBatch: true,
  dependency: '优先使用当前上下文中的 productIds；可传 productId 查询单个产品，也可传 productIds 一次查询多个产品。ID 未知时先查询产品目录，不能依赖本批次尚未返回的结果填写参数。',
});
