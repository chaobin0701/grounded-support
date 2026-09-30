import assert from 'node:assert/strict';
import test from 'node:test';
import { ProductCatalogService } from '../dist/ai/tools/product-catalog/product-catalog.service.js';
import { ProductCategoryTool } from '../dist/ai/tools/product-catalog/product-category.tool.js';
import { ProductDetailTool } from '../dist/ai/tools/product-catalog/product-detail.tool.js';
import { ProductListTool } from '../dist/ai/tools/product-catalog/product-list.tool.js';
import { ChatService } from '../dist/chat/chat.service.js';
import { validateAgentAnswer } from '../dist/chat/chat-orchestrator.service.js';

const context = () => ({ permissions: [], state: new Map([['knownProductIds', new Set()]]) });

const catalogRows = [
  { id: 'midea-hft20zbj', brand: 'Midea', name: '美的塔式暖风机 HFT20ZBJ', category_id: 'heating', category_name: '取暖', summary: '面向小空间的塔式取暖器。', description: '适合小空间。', suggested_price: '参考 ¥343', image_url: null, source_url: null, specifications: { 额定功率: '2000 W', 档位: '3 档' } },
  { id: 'xiaomi-electric-warmer', brand: 'Xiaomi', name: '米家电暖器', category_id: 'heating', category_name: '取暖', summary: '对流式电暖器。', description: '适合卧室。', suggested_price: null, image_url: null, source_url: null, specifications: { 额定功率: '1500 W' } },
  { id: 'xiaomi-air-purifier-pro', brand: 'Xiaomi', name: '米家空气净化器 Pro', category_id: 'air', category_name: '空气', summary: '家用空气净化设备。', description: '改善室内空气。', suggested_price: null, image_url: null, source_url: null, specifications: { 颗粒物CADR: '500 m³/h' } },
  { id: 'xiaomi-fresh-air-ventilator', brand: 'Xiaomi', name: '米家新风机', category_id: 'air', category_name: '空气', summary: '壁挂式新风设备。', description: '持续通风。', suggested_price: null, image_url: null, source_url: null, specifications: { 额定风量: '300 m³/h' } },
];

const fakeDatabase = { query: async (statement, values = []) => {
  if (statement.includes('GROUP BY')) return { rows: [{ id: 'heating', name: '取暖' }, { id: 'air', name: '空气' }] };
  if (statement.includes('WHERE id = $1')) return { rows: catalogRows.filter((row) => row.id === values[0]) };
  return { rows: catalogRows };
} };

test('local product tools expose the three read-only catalogue capabilities', async () => {
  const catalog = new ProductCatalogService(fakeDatabase);
  const categories = await new ProductCategoryTool(catalog).execute({}, context());
  assert.equal(categories.data.categories.length, 2);

  const list = await new ProductListTool(catalog).execute({}, context());
  assert.equal(list.data.total, 4);
  assert.equal(list.data.products[0].keySpecifications.length, 2);

  const detailTool = new ProductDetailTool(catalog);
  const blocked = await detailTool.execute({ productId: 'xiaomi-air-purifier-pro' }, context());
  assert.equal(blocked.success, false);

  const allowedContext = context();
  allowedContext.state.get('knownProductIds').add('xiaomi-air-purifier-pro');
  const detail = await detailTool.execute({ productId: 'xiaomi-air-purifier-pro' }, allowedContext);
  assert.equal(detail.data.specifications['颗粒物CADR'], '500 m³/h');
  allowedContext.state.get('knownProductIds').add('missing');
  const missing = await detailTool.execute({ productId: 'missing' }, allowedContext);
  assert.equal(missing.errorCode, 'product_not_found');
});

test('all questions are delegated to the agent, without keyword routing', async () => {
  const questions = [];
  const chat = new ChatService({ askDetailed: async (question) => {
    questions.push(question);
    return { result: { answer: 'ok', refused: false, citations: [] } };
  } });
  await chat.askDetailed('你家有多少产品？');
  await chat.askDetailed('暖风机保修多久？');
  assert.deepEqual(questions, ['你家有多少产品？', '暖风机保修多久？']);
});

test('agent validates response protocol without judging evidence correctness', () => {
  const products = [{ id: 'purifier-a1', name: '清屿 A1 空气净化器' }];
  const answer = JSON.stringify({ status: 'answered', answer: '清屿 A1 空气净化器 purifier-a1', citationIds: [], productIds: ['purifier-a1'] });
  assert.equal(validateAgentAnswer(answer, [], products).answer, '清屿 A1 空气净化器');
  assert.equal(validateAgentAnswer(answer.replaceAll('purifier-a1', 'missing'), [], products).refused, false);
  assert.equal(validateAgentAnswer(JSON.stringify({ status: 'answered', answer: '有 5 款', citationIds: [], productIds: [] }), [], products).refused, false);
  assert.equal(validateAgentAnswer(JSON.stringify({ status: 'answered', answer: '你好啊，我可以帮你查询产品和售后资料。', citationIds: [], productIds: [] }), [], [], 'auto').refused, false);
  assert.equal(validateAgentAnswer('{"status":"answered"}', [], []).refused, true);
});
