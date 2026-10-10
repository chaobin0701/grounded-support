/** Stable business capabilities used by orchestration code.
 *
 * Tool names are provider/adapter details. Code that needs to know what a
 * tool does should use a capability rather than repeating local and MCP names.
 */
export type AgentToolCapability =
  | 'knowledge-search'
  | 'product-category'
  | 'product-list'
  | 'product-detail'
  | 'skill';

export const TOOL_CAPABILITIES: Readonly<Record<string, readonly AgentToolCapability[]>> = Object.freeze({
  search_knowledge: ['knowledge-search'],
  list_product_categories: ['product-category'],
  mcp_product_catalog_list_product_categories: ['product-category'],
  list_products: ['product-list'],
  mcp_product_catalog_list_products: ['product-list'],
  get_product_detail: ['product-detail'],
  mcp_product_catalog_get_product_detail: ['product-detail'],
  load_skill: ['skill'],
});

export function hasToolCapability(name: string, capability: AgentToolCapability): boolean {
  return TOOL_CAPABILITIES[name]?.includes(capability) ?? false;
}

