import assert from 'node:assert/strict';
import test from 'node:test';
import { ProductCatalogService } from '../dist/ai/tools/product-catalog/product-catalog.service.js';
import { ProductCategoryTool } from '../dist/ai/tools/product-catalog/product-category.tool.js';
import { ProductDetailTool } from '../dist/ai/tools/product-catalog/product-detail.tool.js';
import { ProductListTool } from '../dist/ai/tools/product-catalog/product-list.tool.js';
import { ChatService } from '../dist/chat/chat.service.js';
import { validateAgentAnswer } from '../dist/chat/chat-orchestrator.service.js';

const context = () => ({ permissions: [], state: new Map([['knownProductIds', new Set()]]) });

test('local product tools expose the three read-only catalogue capabilities', async () => {
  const catalog = new ProductCatalogService();
  const categories = await new ProductCategoryTool(catalog).execute({}, context());
  assert.equal(categories.data.categories.length, 3);

  const list = await new ProductListTool(catalog).execute({}, context());
  assert.equal(list.data.total, 5);
  assert.equal(list.data.products[0].keySpecifications.length, 2);

  const detailTool = new ProductDetailTool(catalog);
  const blocked = await detailTool.execute({ productId: 'purifier-a1' }, context());
  assert.equal(blocked.success, false);

  const allowedContext = context();
  allowedContext.state.get('knownProductIds').add('purifier-a1');
  const detail = await detailTool.execute({ productId: 'purifier-a1' }, allowedContext);
  assert.equal(detail.data.specifications['颗粒物CADR'], '300 m³/h');
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

test('agent rejects unsupported IDs and does not expose internal product IDs', () => {
  const products = [{ id: 'purifier-a1', name: '清屿 A1 空气净化器' }];
  const answer = JSON.stringify({ status: 'answered', answer: '清屿 A1 空气净化器 purifier-a1', citationIds: [], productIds: ['purifier-a1'] });
  assert.equal(validateAgentAnswer(answer, [], products).answer, '清屿 A1 空气净化器');
  assert.equal(validateAgentAnswer(answer.replaceAll('purifier-a1', 'missing'), [], products).refused, true);
  assert.equal(validateAgentAnswer(JSON.stringify({ status: 'answered', answer: '有 5 款', citationIds: [], productIds: [] }), [], products).refused, true);
  assert.equal(validateAgentAnswer(JSON.stringify({ status: 'answered', answer: '你好啊，我可以帮你查询产品和售后资料。', citationIds: [], productIds: [] }), [], [], 'auto').refused, false);
});
