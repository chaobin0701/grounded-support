import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AgentTool } from '../agent-tool';
import { ToolContext } from '../tool-context';
import { ToolResult } from '../tool-result';
import { ProductCatalogService } from './product-catalog.service';

const inputSchema = z.object({ productId: z.string().trim().min(1).max(80) });

@Injectable()
export class ProductDetailTool implements AgentTool<z.infer<typeof inputSchema>> {
  readonly name = 'get_product_detail';
  readonly description = '按产品 ID 读取虚构产品的完整规格。只读、mock 数据。';
  readonly inputSchema = inputSchema;
  readonly planning = { canBatch: false, dependency: '需要已知且已验证的 productId' } as const;

  constructor(private readonly catalog: ProductCatalogService) {}

  async execute(input: z.infer<typeof inputSchema>, context: ToolContext): Promise<ToolResult> {
    const knownProductIds = context.state.get('knownProductIds');
    if (knownProductIds instanceof Set && !knownProductIds.has(input.productId)) {
      return { success: false, content: 'PRODUCT_ID_NOT_AVAILABLE', errorCode: 'product_id_not_available' };
    }
    const data = this.catalog.getProductDetail(input.productId);
    if (!data) return { success: false, content: 'PRODUCT_NOT_FOUND', errorCode: 'product_not_found' };
    return { success: true, content: JSON.stringify(data), data };
  }
}
