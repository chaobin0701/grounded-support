import assert from 'node:assert/strict';
import test from 'node:test';
import { McpCapabilityGateway } from '../dist/mcp/mcp-capability.gateway.js';
import { McpCapabilityAdminService } from '../dist/mcp/mcp-capability-admin.service.js';

test('the gateway exposes only enabled tools and rechecks before execution', async () => {
  let serviceEnabled = true;
  let toolEnabled = true;
  let productCalls = 0;
  const database = { query: async (_statement, args) => {
    if (args.length === 1) return { rows: serviceEnabled && toolEnabled ? [{ tool_name: 'list_products' }] : [] };
    return { rowCount: serviceEnabled && toolEnabled && args[1] === 'list_products' ? 1 : 0 };
  } };
  const gateway = new McpCapabilityGateway(database, { listProducts: async () => {
    productCalls += 1;
    return { total: 0, products: [] };
  } });
  assert.deepEqual([...await gateway.availableProductTools()], ['list_products']);
  toolEnabled = false;
  await assert.rejects(() => gateway.listProducts(), (error) => error.getStatus() === 403);
  assert.equal(productCalls, 0);
  toolEnabled = true;
  await gateway.listProducts();
  assert.equal(productCalls, 1);
  serviceEnabled = false;
  assert.equal((await gateway.availableProductTools()).size, 0);
  await assert.rejects(() => gateway.listProducts(), (error) => error.getStatus() === 403);
  assert.equal(productCalls, 1);
});

test('administrative updates require current permission and write an audit entry', async () => {
  const statements = [];
  let authorized = false;
  const client = { query: async (statement, args) => {
    statements.push({ statement, args });
    if (statement.includes("rp.permission_code = 'mcp.manage'")) return { rowCount: authorized ? 1 : 0 };
    return { rowCount: 1 };
  } };
  const service = new McpCapabilityAdminService({ transaction: async (work) => work(client) });
  await assert.rejects(() => service.setCapability(4, 'product_catalog', false), (error) => error.getStatus() === 403);
  assert.equal(statements.length, 1);
  authorized = true;
  await service.setTool(4, 'product_catalog', 'list_products', false);
  assert.ok(statements.some(({ statement }) => statement.includes('UPDATE mcp_tool_policies')));
  assert.ok(statements.some(({ statement }) => statement.includes('INSERT INTO audit_logs')));
});
