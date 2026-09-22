import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ProductCatalogService } from '../../tools/product-catalog/product-catalog.service';
import type { McpPluginDefinition } from '../mcp-plugin.types';

export function createProductCatalogPlugin(catalog: ProductCatalogService): McpPluginDefinition {
  return {
    id: 'product_catalog',
    version: '1.0.0',
    enabled: true,
    createServer: () => {
      const server = new McpServer({ name: 'product_catalog', version: '1.0.0' });
      server.registerTool('list_product_categories', { description: '读取虚构商家的产品分类。', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: JSON.stringify(catalog.listCategories()) }], structuredContent: catalog.listCategories() }));
      server.registerTool('list_products', { description: '按分类或关键词查询产品。', inputSchema: { categoryId: z.string().optional(), search: z.string().optional() } }, async (input) => {
        const data = catalog.listProducts(input.categoryId, input.search);
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
      });
      server.registerTool('get_product_detail', { description: '按产品 ID 查询完整规格。', inputSchema: { productId: z.string() } }, async (input) => {
        const data = catalog.getProductDetail(input.productId);
        if (!data) return { isError: true, content: [{ type: 'text', text: 'PRODUCT_NOT_FOUND' }] };
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
      });
      return server;
    },
  };
}
