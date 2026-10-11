import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ProductCatalogService } from '../../tools/product-catalog/product-catalog.service';
import type { McpPluginDefinition } from '../mcp-plugin.types';
import { productDetailPlanning } from '../../tools/product-catalog/product-tool-planning';
import { productResources } from '../../context/context-contribution';
import type { AgentToolCapability } from '../../tools/tool-capabilities';

export function createProductCatalogPlugin(catalog: ProductCatalogService): McpPluginDefinition {
  return {
    id: 'product_catalog',
    version: '1.0.0',
    enabled: true,
    toolPlanning: { get_product_detail: productDetailPlanning },
    toolContextProjectors: { get_product_detail: productResources },
    toolCapabilities: {
      list_product_categories: ['product-category'],
      list_products: ['product-list'],
      get_product_detail: ['product-detail'],
    } satisfies Readonly<Record<string, readonly AgentToolCapability[]>>,
    createServer: () => {
      const server = new McpServer({ name: 'product_catalog', version: '1.0.0' });
      server.registerTool('list_product_categories', { description: '读取产品目录中的产品分类。', inputSchema: {} }, async () => {
        const data = await catalog.listCategories();
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
      });
      server.registerTool('list_products', { description: '按分类或关键词查询产品。', inputSchema: { categoryId: z.string().optional(), search: z.string().optional() } }, async (input) => {
        const data = await catalog.listProducts(input.categoryId, input.search);
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
      });
      server.registerTool('get_product_detail', { description: '按产品 ID 查询完整规格；可使用 productIds 一次查询多个产品。', inputSchema: { productId: z.string().optional(), productIds: z.array(z.string()).min(1).max(5).optional() } }, async (input) => {
        if (input.productIds) {
          const products = await catalog.getProductDetails(input.productIds);
          if (!products.length) return { isError: true, content: [{ type: 'text', text: 'PRODUCT_NOT_FOUND' }] };
          const data = { products, missingProductIds: input.productIds.filter(id => !products.some(product => product.id === id)) };
          return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
        }
        const data = await catalog.getProductDetail(input.productId!);
        if (!data) return { isError: true, content: [{ type: 'text', text: 'PRODUCT_NOT_FOUND' }] };
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
      });
      return server;
    },
  };
}
