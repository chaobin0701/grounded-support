import assert from 'node:assert/strict';
import test from 'node:test';
import { KnowledgeSearchTool } from '../dist/ai/tools/knowledge-search.tool.js';
import { ChatOrchestratorService } from '../dist/chat/chat-orchestrator.service.js';

const hit = {
  chunkId: 12, documentId: 3, documentTitle: '退货政策', originalFilename: 'returns.md',
  ordinal: 0, headingPath: '退货条件', content: '七天内可申请退货。', sourceStartLine: 2, sourceEndLine: 4, score: 0.86,
};

test('knowledge search tool separates model content from backend evidence data', async () => {
  let requestedTopK = null;
  const search = {
    searchForAgent: async (query, topK) => {
      assert.equal(query, '退货政策');
      requestedTopK = topK;
      return { hits: [hit], retrievalMode: 'hybrid', vectorIndexedChunks: 4 };
    },
  };
  const tool = new KnowledgeSearchTool(search);
  const parsed = tool.inputSchema.safeParse({ query: '退货政策', topK: 3 });
  assert.equal(parsed.success, true);
  const result = await tool.execute(parsed.data, { permissions: [], state: new Map() });
  assert.equal(requestedTopK, 3);
  assert.match(result.content, /\[12\] 退货政策/);
  assert.deepEqual(result.data.hits, [hit]);
  assert.equal(result.data.lexicalResults, undefined);
  assert.equal(result.metadata.retrievalMode, 'hybrid');
  assert.equal(tool.inputSchema.safeParse({ query: '退货政策', topK: 9 }).success, false);
});

test('agent refuses repeated identical tool calls instead of looping', async () => {
  const toolCall = JSON.stringify({ type: 'tool', name: 'search_knowledge', arguments: { query: '退货政策' } });
  const llm = {
    model: 'test-model',
    completeDetailed: async () => ({ content: toolCall, model: 'test-model', inputTokens: null, outputTokens: null, totalTokens: null }),
  };
  const tool = {
    name: 'search_knowledge',
    description: 'search',
    inputSchema: { safeParse: (input) => ({ success: true, data: input }) },
    execute: async () => ({ success: true, content: '退货政策：七天内可申请退货。', data: { hits: [hit] } }),
  };
  const registry = { get: () => tool };
  const orchestrator = new ChatOrchestratorService(llm, registry);
  const run = await orchestrator.askDetailed('退货政策是什么？', [], '');
  assert.equal(run.result.refused, true);
  assert.equal(run.contextSnapshot.toolCalls[1].error, 'duplicate_tool_call');
});
