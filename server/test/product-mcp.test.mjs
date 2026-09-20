import assert from 'node:assert/strict';
import test from 'node:test';
import { ProductMcpService } from '../dist/chat/product-mcp.service.js';
import { ChatService } from '../dist/chat/chat.service.js';
import { validateAgentAnswer } from '../dist/chat/chat-orchestrator.service.js';

test('mock product MCP server exposes three read-only catalogue tools', async () => {
  const products = new ProductMcpService();
  try {
    const categories = await products.listCategories();
    assert.equal(categories.categories.length, 3);
    const list = await products.listProducts();
    assert.equal(list.total, 5);
    const detail = await products.getProductDetail('purifier-a1');
    assert.equal(detail.specifications['颗粒物CADR'], '300 m³/h');
    await assert.rejects(() => products.getProductDetail('missing'), (error) => error.getStatus() === 503);
  } finally {
    await products.onModuleDestroy();
  }
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
});
