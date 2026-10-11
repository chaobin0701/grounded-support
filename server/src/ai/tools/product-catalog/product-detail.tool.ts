import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AgentTool } from '../agent-tool';
import { ToolContext } from '../tool-context';
import { ToolResult } from '../tool-result';
import { ProductCatalogService } from './product-catalog.service';
import { productDetailPlanning } from './product-tool-planning';
import { productResources } from '../../context/context-contribution';

const inputSchema = z.object({
  productId: z.string().trim().min(1).max(80).optional(),
  productIds: z.array(z.string().trim().min(1).max(80)).min(1).max(5).optional(),
}).refine(value => Boolean(value.productId) !== Boolean(value.productIds), 'Provide productId or productIds');

@Injectable()
export class ProductDetailTool implements AgentTool<z.infer<typeof inputSchema>> {
  readonly name = 'get_product_detail';
  readonly capabilities = ['product-detail'] as const;
  readonly description = '按产品 ID 读取官网产品目录中的完整规格。可使用上下文中的 productIds 一次查询多个产品；只读、数据库数据。';
  readonly inputSchema = inputSchema;
  readonly planning = productDetailPlanning;
  readonly contributeContext = productResources;

  constructor(private readonly catalog: ProductCatalogService) {}

  async execute(input: z.infer<typeof inputSchema>, _context: ToolContext): Promise<ToolResult> {
    if (input.productIds) {
      const products = await this.catalog.getProductDetails(input.productIds);
      const missingProductIds = input.productIds.filter(id => !products.some(product => product.id === id));
      return products.length
        ? { success: true, content: JSON.stringify({ products, missingProductIds }), data: { products, missingProductIds } }
        : { success: false, content: 'PRODUCT_NOT_FOUND', errorCode: 'product_not_found', data: { products: [], missingProductIds } };
    }
    const data = await this.catalog.getProductDetail(input.productId!);
    if (!data) return { success: false, content: 'PRODUCT_NOT_FOUND', errorCode: 'product_not_found' };
    return { success: true, content: JSON.stringify(data), data };
  }
}
