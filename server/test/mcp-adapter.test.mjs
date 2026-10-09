import assert from 'node:assert/strict';
import test from 'node:test';
import { ProductCatalogService } from '../dist/ai/tools/product-catalog/product-catalog.service.js';
import { createProductCatalogPlugin } from '../dist/ai/mcp/built-in/product-catalog.plugin.js';
import { McpPluginRegistry } from '../dist/ai/mcp/mcp-plugin-registry.js';
import { adaptMcpTool } from '../dist/ai/mcp/mcp-tool.adapter.js';
import { ToolPolicy } from '../dist/ai/tools/tool-policy.js';
import { ToolRegistry } from '../dist/ai/tools/tool-registry.js';
import { ToolExecutionService } from '../dist/ai/tools/tool-execution.js';
import { ProductDetailTool } from '../dist/ai/tools/product-catalog/product-detail.tool.js';
import { McpModule } from '../dist/ai/mcp/mcp.module.js';

const fakeDatabase = {
  query: async (statement) => {
    if (statement.includes('GROUP BY')) return { rows: [{ id: 'heating', name: '取暖' }, { id: 'air', name: '空气' }] };
    return { rows: [{
      id: 'midea-hft20zbj', brand: 'Midea', name: '美的塔式暖风机 HFT20ZBJ', category_id: 'heating', category_name: '取暖',
      summary: '面向小空间的塔式取暖器。', description: '适合小空间。', suggested_price: '参考 ¥343', image_url: null, source_url: null,
      specifications: { 额定功率: '2000 W', 档位: '3 档' },
    }] };
  },
};

test('internal product MCP plugin discovers and calls tools through the official protocol', async () => {
  const registry = new McpPluginRegistry();
  registry.register(createProductCatalogPlugin(new ProductCatalogService(fakeDatabase)));
  const client = await registry.start('product_catalog');
  assert.ok(client);

  const discovered = await client.listTools();
  assert.deepEqual(discovered.tools.map((tool) => tool.name), [
    'list_product_categories', 'list_products', 'get_product_detail',
  ]);

  const listTool = adaptMcpTool('product_catalog', client, discovered.tools.find((tool) => tool.name === 'list_products'));
  const result = await listTool.execute({ search: '云' }, { permissions: [], state: new Map() });
  assert.equal(result.success, true);
  assert.match(result.content, /products/);
  assert.equal(result.metadata.mcpPluginId, 'product_catalog');
  await registry.stopAll();
});

test('MCP plugin registry disables a plugin without starting it', async () => {
  const registry = new McpPluginRegistry();
  registry.register({ id: 'disabled', version: '1.0.0', enabled: false, createServer: () => { throw new Error('must not start'); } });
  assert.equal(await registry.start('disabled'), null);
  assert.deepEqual(registry.list().map((plugin) => plugin.id), ['disabled']);
});

test('MCP tools remain subject to an independent Agent tool allowlist', () => {
  const policy = new ToolPolicy();
  const state = policy.createState({ allowedTools: ['mcp_product_catalog_list_products'], maxToolCalls: 5 });
  assert.equal(policy.beforeCall(state, 'mcp_product_catalog_list_products', {}), null);
  assert.equal(policy.beforeCall(state, 'search_knowledge', {}), 'tool_not_allowed');
});
test('module registration gives the local and MCP product-detail tool identical trusted batching hints', async t => {
  const plugins = new McpPluginRegistry(), registry = new ToolRegistry();
  const catalog = new ProductCatalogService(fakeDatabase);
  const local = new ProductDetailTool(catalog); registry.register(local);
  const events = [];
  const module = new McpModule(plugins, registry, catalog, { publishEvent: event => events.push(event) });
  t.after(() => module.onApplicationShutdown());
  await module.onModuleInit();
  const alias = registry.get('mcp_product_catalog_get_product_detail');
  assert.deepEqual(alias.planning, local.planning);
  assert.equal(alias.planning.canBatch, true);
  const execution = new ToolExecutionService(registry, new ToolPolicy());
  const hints = execution.plannerHints();
  assert.match(hints, /get_product_detail: 可与当前轮其他独立只读工具一起返回/);
  assert.match(hints, /mcp_product_catalog_get_product_detail: 可与当前轮其他独立只读工具一起返回/);
  const result = await execution.execute(alias.name, { productId: 'midea-hft20zbj' }, { permissions: [alias.name], state: new Map() }, execution.createStateForAgent([alias.name], 1));
  assert.equal(result.result.success, true);
  assert.deepEqual(events.map(e => e.type), ['mcp.tool.started', 'mcp.tool.completed']);
});
