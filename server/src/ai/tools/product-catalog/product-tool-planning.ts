import type { AgentToolPlanning } from '../agent-tool';

/** Shared by the local tool and its statically registered MCP alias. */
export const productDetailPlanning: AgentToolPlanning = Object.freeze({
  canBatch: true,
  dependency: '需要已确认的 productId；多个产品 ID 已知时可在同一响应中多次调用。ID 未知时先查询产品目录，不能依赖本批次尚未返回的结果填写参数。',
});
