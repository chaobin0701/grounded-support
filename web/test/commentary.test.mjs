import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = ts.transpileModule(await readFile(new URL('../src/chat-api.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { askInConversationStream } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
test('legacy workspace transports commentary separately from answer deltas and retains it in done', async () => {
  const original = globalThis.fetch;
  const commentary = { type: 'commentary', id: 'planner-1-tools-commentary', text: '我先查看产品目录。' };
  const answer = { answer: '产品介绍', refused: false, citations: [], progressEvents: [commentary] };
  const text = `event: commentary\ndata: ${JSON.stringify(commentary)}\n\nevent: reasoning\ndata: secret\n\nevent: answer_delta\ndata: {"text":"产品介绍"}\n\nevent: done\ndata: ${JSON.stringify(answer)}\n\n`;
  globalThis.fetch = async () => new Response(text);
  try {
    const events = [], deltas = [];
    const result = await askInConversationStream('conversation', '介绍产品', text => deltas.push(text), 'request-1', event => events.push(event));
    assert.deepEqual(events, [commentary]); assert.deepEqual(deltas, ['产品介绍']); assert.deepEqual(result, answer);
  } finally { globalThis.fetch = original; }
});
