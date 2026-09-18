import { ForbiddenException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import { ProductMcpService } from '../chat/product-mcp.service';

export const PRODUCT_CAPABILITY_ID = 'product_catalog';
export const PRODUCT_TOOL_NAMES = ['list_product_categories', 'list_products', 'get_product_detail'] as const;
export type ProductToolName = typeof PRODUCT_TOOL_NAMES[number];

@Injectable()
export class McpCapabilityGateway {
  constructor(private readonly database: DatabaseService, private readonly products: ProductMcpService) {}

  async availableProductTools(): Promise<Set<ProductToolName>> {
    const result = await this.database.query<{ tool_name: ProductToolName }>(
      `SELECT p.tool_name FROM mcp_capabilities c
       JOIN mcp_tool_policies p ON p.capability_id = c.id
       WHERE c.id = $1 AND c.manifest_key = 'builtin.mock_products'
         AND c.enabled AND p.enabled`, [PRODUCT_CAPABILITY_ID],
    );
    return new Set(result.rows.map((row) => row.tool_name).filter((name) => PRODUCT_TOOL_NAMES.includes(name)));
  }

  private async authorize(toolName: ProductToolName): Promise<void> {
    // Recheck at execution time: an administrator may disable a tool after
    // the agent received its initial tool list.
    const result = await this.database.query(
      `SELECT 1 FROM mcp_capabilities c
       JOIN mcp_tool_policies p ON p.capability_id = c.id
       WHERE c.id = $1 AND c.manifest_key = 'builtin.mock_products'
         AND c.enabled AND p.enabled AND p.tool_name = $2 LIMIT 1`,
      [PRODUCT_CAPABILITY_ID, toolName],
    );
    if (!result.rowCount) throw new ForbiddenException('MCP tool is disabled');
  }

  async listCategories() {
    await this.authorize('list_product_categories');
    return this.products.listCategories();
  }

  async listProducts(categoryId?: string, search?: string) {
    await this.authorize('list_products');
    return this.products.listProducts(categoryId, search);
  }

  async getProductDetail(productId: string) {
    await this.authorize('get_product_detail');
    return this.products.getProductDetail(productId);
  }
}
