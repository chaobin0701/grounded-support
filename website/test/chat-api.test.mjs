import test from "node:test";
import assert from "node:assert/strict";
import { chatApi, ChatApiError, readAnswerStream } from "../src/chat/api.ts";
import { progressSteps } from "../src/chat/progress.ts";
const answer = { answer: "你好，禾序。", refused: false, citations: [] };
test('公开说明是独立事件；不会拼入最终回答，历史与 done 保留说明而忽略推理字段', async () => {
  const commentary = { type: 'commentary', id: 'batch-1-commentary', text: '我先查看产品目录。' };
  const lines = [], deltas = [];
  const text = `event: commentary\ndata: ${JSON.stringify(commentary)}\n\nevent: reasoning\ndata: 私有内容\n\nevent: answer_delta\ndata: {"text":"最终回答"}\n\nevent: done\ndata: ${JSON.stringify({ ...answer, progressEvents: [commentary, { type: 'reasoning', text: 'secret' }] })}\n\n`;
  const result = await readAnswerStream(response(text, true), { delta: text => deltas.push(text), progress: () => {}, started: () => {}, commentary: event => lines.push(event) });
  assert.deepEqual(lines, [commentary]); assert.deepEqual(deltas, ['最终回答']); assert.deepEqual(result.progressEvents, [commentary]);
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify([{ id: 1, role: 'assistant', content: answer.answer, createdAt: '2026-10-08', progressEvents: [commentary] }]));
    assert.deepEqual((await chatApi.messages('conversation'))[0].progressEvents, [commentary]);
  } finally { globalThis.fetch = original; }
});
test('规划说明可以逐段接收，并按同一 ID 合并为一条安全事件', async () => {
  const lines = [];
  const text = [
    'event: commentary_started\ndata: {"id":"planner-1-commentary"}',
    'event: commentary_delta\ndata: {"id":"planner-1-commentary","text":"我先查看"}',
    'event: commentary_delta\ndata: {"id":"planner-1-commentary","text":"产品资料。"}',
    'event: commentary_completed\ndata: {"id":"planner-1-commentary","text":"我先查看产品资料。"}',
    `event: done\ndata: ${JSON.stringify({ ...answer, progressEvents: [{ type: 'commentary', id: 'planner-1-commentary', text: '我先查看产品资料。' }] })}`,
  ].join('\n\n');
  await readAnswerStream(response(`${text}\n\n`, true), { delta: () => {}, progress: () => {}, started: () => {}, commentary: event => lines.push(event) });
  assert.deepEqual(lines.map(item => item.text), ['我先查看', '我先查看产品资料。']);
});
const event = {
  type: "progress",
  id: "tool-start",
  operationId: "op1",
  stage: "tool",
  status: "running",
  text: "正在检索…",
};
function response(text, split = false) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        if (split)
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        else controller.enqueue(bytes);
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
function callbacks() {
  const deltas = [];
  const progress = [];
  const sources = [];
  return {
    deltas,
    progress,
    sources,
    cb: {
      delta: (text) => deltas.push(text),
      progress: (item) => progress.push(item),
      started: (items) => sources.push(items),
    },
  };
}
test("原生 SSE 字节分片、中文 UTF-8、CRLF 跨分片和来源元数据", async () => {
  const result = callbacks();
  const text = `: heartbeat\r\n\r\nevent: answer_started\r\ndata: {"citations":[]}\r\n\r\nevent: progress\r\ndata: ${JSON.stringify(event)}\r\n\r\nevent: answer_delta\r\ndata: {"text":"你好"}\r\n\r\nevent: answer_delta\r\ndata: {"text":"，禾序。"}\r\n\r\nevent: done\r\ndata: ${JSON.stringify(answer)}\r\n\r\n`;
  assert.equal(
    (await readAnswerStream(response(text, true), result.cb)).answer,
    answer.answer,
  );
  assert.deepEqual(result.deltas, ["你好", "，禾序。"]);
  assert.equal(result.progress.length, 1);
  assert.deepEqual(result.sources, [[]]);
});
test('产品 IDs 以可选 JSON context 传递，不拼接正文或提交产品规格', async () => {
  const original = globalThis.fetch; const bodies = [];
  try {
    globalThis.fetch = async (_url, request) => { bodies.push(JSON.parse(request.body)); return response(`event: done\ndata: ${JSON.stringify(answer)}\n\n`); };
    await chatApi.stream('conversation', '适合卧室吗？', 'request', callbacks().cb, undefined, { productIds: ['midea-hft20zbj','xiaomi-air-purifier-pro'] });
    assert.deepEqual(bodies[0], { question: '适合卧室吗？', context: { productIds: ['midea-hft20zbj','xiaomi-air-purifier-pro'] } });
    await chatApi.stream('conversation', '你好', 'request2', callbacks().cb);
    assert.deepEqual(bodies[1], { question: '你好' });
  } finally { globalThis.fetch = original; }
});
test("多行 data、兼容 delta、尾部无空行的 done", async () => {
  const result = callbacks();
  const text = `event: delta\ndata: {"text":\ndata: "你好"}\n\nevent: done\ndata: ${JSON.stringify(answer)}`;
  await readAnswerStream(response(text), result.cb);
  assert.deepEqual(result.deltas, ["你好"]);
});
test("错误事件保持 409/429；未知内部事件不暴露", async () => {
  for (const status of [409, 429])
    await assert.rejects(
      readAnswerStream(
        response(
          `event: error\ndata: {"status":${status},"message":"服务提示"}\n\n`,
        ),
        callbacks().cb,
      ),
      (error) => error instanceof ChatApiError && error.status === status,
    );
  const result = callbacks();
  await readAnswerStream(
    response(
      `event: reasoning\ndata: secret\n\nevent: done\ndata: ${JSON.stringify(answer)}\n\n`,
    ),
    result.cb,
  );
  assert.deepEqual(result.deltas, []);
});

test("HTTP 和 SSE 配额错误保留错误码、明确文案及重试时间", async () => {
  const detail={code:"daily_token_quota_exceeded",message:"今日 Token 额度已用完",retryAt:"2026-10-08T16:00:00.000Z"};
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response(JSON.stringify({error:detail,requestId:"fixture"}),{status:429});
    await assert.rejects(chatApi.stream("example","你好","request-id",callbacks().cb),e=>e instanceof ChatApiError&&e.code===detail.code&&e.message===detail.message&&e.retryAt===detail.retryAt);
    await assert.rejects(readAnswerStream(response(`event: error\ndata: ${JSON.stringify({status:429,...detail})}\n\n`),callbacks().cb),e=>e instanceof ChatApiError&&e.code===detail.code&&e.retryAt===detail.retryAt);
  } finally {globalThis.fetch=original;}
});
test("不完整/非法流和错误最终契约不可伪装成功", async () => {
  for (const text of [
    'event: answer_delta\ndata: {"text":"一半"}\n\n',
    "event: done\ndata: {}\n\n",
    "event: answer_delta\ndata: nope\n\n",
  ])
    await assert.rejects(
      readAnswerStream(response(text), callbacks().cb),
      ChatApiError,
    );
});
test("进度按 operationId 合并，隐藏固定前置阶段，结束后不继续转圈", () => {
  const steps = progressSteps(
    [
      { ...event, stage: "planning" },
      event,
      { ...event, id: "tool-end", status: "completed", text: "已检索…" },
      { ...event, id: "answer-start", operationId: undefined, stage: "answer" },
    ],
    true,
  );
  assert.equal(steps.length, 1);
  assert.equal(steps[0].text, "已检索");
  assert.equal(steps[0].stateLabel, "已完成");
});
test("POST 同源 SSE 带访客凭证、幂等 ID，只有一次请求", async () => {
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async (url, options) => {
    count++;
    assert.equal(url, "/api/chat/conversations/example/messages/stream");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.headers["Idempotency-Key"], "request-id");
    assert.deepEqual(JSON.parse(options.body), { question: "你好" });
    return response(`event: done\ndata: ${JSON.stringify(answer)}\n\n`);
  };
  try {
    await chatApi.stream("example", "你好", "request-id", callbacks().cb);
    assert.equal(count, 1);
  } finally {
    globalThis.fetch = original;
  }
});
