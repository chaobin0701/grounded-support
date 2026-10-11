import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AgentTool } from '../agent-tool';
import { ToolContext } from '../tool-context';
import { ToolResult } from '../tool-result';
import { ProductCatalogService } from './product-catalog.service';

@Injectable()
export class ProductCategoryTool implements AgentTool<Record<string, never>> {
  readonly name = 'list_product_categories';
  readonly capabilities = ['product-category'] as const;
  readonly description = '读取官网产品目录中的全部产品分类。只读、数据库数据。';
  readonly inputSchema = z.object({});
  readonly planning = { canBatch: true } as const;

  constructor(private readonly catalog: ProductCatalogService) {}

  async execute(_input: Record<string, never>, _context: ToolContext): Promise<ToolResult> {
    const data = await this.catalog.listCategories();
    return { success: true, content: JSON.stringify(data), data };
  }
}
