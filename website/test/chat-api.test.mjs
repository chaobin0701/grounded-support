import test from "node:test";
import assert from "node:assert/strict";
import { chatApi, ChatApiError, readAnswerStream } from "../src/chat/api.ts";
import { progressSteps } from "../src/chat/progress.ts";
const answer = { answer: "你好，禾序。", refused: false, citations: [] };
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
  assert.equal(steps.length, 2);
  assert.equal(steps[0].text, "已检索");
  assert.equal(steps[0].stateLabel, "已完成");
  assert.equal(steps[1].stateLabel, "未完成");
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
