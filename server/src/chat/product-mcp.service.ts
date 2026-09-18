import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join } from 'node:path';
import { z } from 'zod';

const categorySchema = z.object({ categories: z.array(z.object({ id: z.string(), name: z.string() })) });
const productSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  products: z.array(z.object({ id: z.string(), name: z.string(), categoryId: z.string(), summary: z.string(), keySpecifications: z.array(z.string()) })),
});
const productDetailSchema = z.object({
  id: z.string(), name: z.string(), categoryId: z.string(), summary: z.string(), specifications: z.record(z.string(), z.string()),
});

export type ProductSummary = z.infer<typeof productSummarySchema>['products'][number];
export type ProductDetail = z.infer<typeof productDetailSchema>;

@Injectable()
export class ProductMcpService implements OnModuleDestroy {
  private connection: Promise<Client> | null = null;

  private async client(): Promise<Client> {
    if (!this.connection) {
      this.connection = (async () => {
        const transport = new StdioClientTransport({
          command: process.execPath,
          args: [join(__dirname, '..', 'mcp', 'product-server.js')],
          // The mock catalogue has no need for DB credentials or LLM secrets.
          env: { PATH: process.env.PATH || '', NODE_ENV: 'production' },
          stderr: 'pipe',
        });
        const client = new Client({ name: 'grounded-support-api', version: '1.0.0' });
        await client.connect(transport);
        return client;
      })().catch((error: unknown) => {
        this.connection = null;
        throw error;
      });
    }
    return this.connection;
  }

  private async call<T>(name: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
    try {
      const client = await this.client();
      const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 5000 });
      if (response.isError) throw new Error(`MCP tool ${name} failed`);
      const parsed = schema.safeParse(response.structuredContent);
      if (!parsed.success) throw new Error(`MCP tool ${name} returned invalid data`);
      return parsed.data;
    } catch {
      throw new ServiceUnavailableException('Product catalogue is temporarily unavailable');
    }
  }

  listCategories() { return this.call('list_product_categories', {}, categorySchema); }
  listProducts(categoryId?: string, search?: string) { return this.call('list_products', { categoryId, search }, productSummarySchema); }
  getProductDetail(productId: string) { return this.call('get_product_detail', { productId }, productDetailSchema); }

  async onModuleDestroy(): Promise<void> {
    if (this.connection) {
      try { await (await this.connection).close(); } catch { /* The child may already have exited. */ }
      this.connection = null;
    }
  }
}
