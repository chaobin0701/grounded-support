import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { categories, products } from './mock-products';

export function createProductServer() {
  const server = new McpServer({ name: 'grounded-support-mock-products', version: '1.0.0' });

  server.registerTool('list_product_categories', {
    title: '列出产品分类',
    description: '读取虚构商家暖巢电器的全部产品分类。只读、mock 数据。',
    inputSchema: {},
  }, async () => {
    const result = { categories };
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
  });

  server.registerTool('list_products', {
    title: '列出产品',
    description: '按分类或关键词查询虚构产品目录，返回产品名称和简要规格。只读、mock 数据。',
    inputSchema: { categoryId: z.string().optional(), search: z.string().max(100).optional() },
  }, async ({ categoryId, search }) => {
    const needle = search?.trim().toLowerCase();
    const matched = products.filter((product) => (!categoryId || product.categoryId === categoryId)
      && (!needle || `${product.name} ${product.summary} ${Object.values(product.specifications).join(' ')}`.toLowerCase().includes(needle)));
    const result = { total: matched.length, products: matched.map(({ id, name, categoryId: category, summary, specifications }) => ({ id, name, categoryId: category, summary, keySpecifications: Object.entries(specifications).slice(0, 2).map(([key, value]) => `${key}：${value}`) })) };
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
  });

  server.registerTool('get_product_detail', {
    title: '查看产品详情',
    description: '按产品 ID 读取虚构产品的完整规格。只读、mock 数据。',
    inputSchema: { productId: z.string().min(1) },
  }, async ({ productId }) => {
    const product = products.find((item) => item.id === productId);
    if (!product) return { isError: true, content: [{ type: 'text' as const, text: 'PRODUCT_NOT_FOUND' }] };
    return { content: [{ type: 'text', text: JSON.stringify(product) }], structuredContent: product };
  });

  return server;
}

if (require.main === module) {
  void createProductServer().connect(new StdioServerTransport()).catch((error: unknown) => {
    process.stderr.write(`Mock product MCP server failed: ${error instanceof Error ? error.message : 'unknown'}\n`);
    process.exitCode = 1;
  });
}
