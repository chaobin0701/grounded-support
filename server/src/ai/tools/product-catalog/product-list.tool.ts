import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AgentTool } from '../agent-tool';
import { ToolContext } from '../tool-context';
import { ToolResult } from '../tool-result';
import { ProductCatalogService } from './product-catalog.service';

const inputSchema = z.object({
  categoryId: z.string().trim().max(80).optional(),
  search: z.string().trim().max(80).optional(),
});

@Injectable()
export class ProductListTool implements AgentTool<z.infer<typeof inputSchema>> {
  readonly name = 'list_products';
  readonly capabilities = ['product-list'] as const;
  readonly description = '按分类或关键词查询官网产品目录，返回产品名称和简要规格。只读、数据库数据。';
  readonly inputSchema = inputSchema;
  readonly planning = { canBatch: true } as const;

  constructor(private readonly catalog: ProductCatalogService) {}

  async execute(input: z.infer<typeof inputSchema>, _context: ToolContext): Promise<ToolResult> {
    const data = await this.catalog.listProducts(input.categoryId, input.search);
    return { success: true, content: JSON.stringify(data), data };
  }
}
