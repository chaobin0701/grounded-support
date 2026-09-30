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
  readonly description = '按产品 ID 读取官网产品目录中的完整规格。只读、数据库数据。';
  readonly inputSchema = inputSchema;
  readonly planning = { canBatch: false, dependency: '需要有效的 productId' } as const;

  constructor(private readonly catalog: ProductCatalogService) {}

  async execute(input: z.infer<typeof inputSchema>, _context: ToolContext): Promise<ToolResult> {
    const data = await this.catalog.getProductDetail(input.productId);
    if (!data) return { success: false, content: 'PRODUCT_NOT_FOUND', errorCode: 'product_not_found' };
    return { success: true, content: JSON.stringify(data), data };
  }
}
