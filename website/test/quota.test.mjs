import test from "node:test";
import assert from "node:assert/strict";
import { isWebsiteQuota, isChatStatus, quotaPercent, quotaStatusText } from "../src/chat/quota.ts";
import { chatApi, parseAnswer } from "../src/chat/api.ts";
import { createChatStore } from "../src/chat/store.ts";
const now = new Date().toISOString();
const reset = new Date(Date.now() + 86400000).toISOString();
const quota = { scope: "website-shared", startAt: now, resetAt: reset, checkedAt: now, timezone: "Asia/Shanghai", requests: 12, requestLimit: 100, remainingRequests: 88, totalTokens: 1500, reservedTokens: 500, tokenLimit: 10000, remainingTokens: 8000, unknownModelCalls: 0 };
const status = { service: "ready", canSend: true, code: "ready", retryAt: null, checkedAt: now, modelHealth: "not_probed" };
const usage = { inputTokens: 20, outputTokens: 10, totalTokens: 30, reservedTokens: 0, unknownModelCalls: 0, accounting: "actual", includesSummary: false };
const answer = { answer: "完成回答", refused: false, citations: [], usage };
function fixture(t, overrides = {}) {
  const calls = { status: 0, quota: 0, stream: 0 };
  const store = createChatStore({
    list: async () => [], presentation: async () => ({ suggestedQuestions: [] }),
    create: async () => ({ id: "11111111-1111-4111-8111-111111111111" }),
    messages: async () => [], runs: async () => [], remove: async () => {},
    status: async () => { calls.status++; return status; },
    quota: async () => { calls.quota++; return quota; },
    stream: async (_id, _question, _request, cb) => {
      calls.stream++;
      for (let i = 0; i < 100; i++) cb.delta("文字");
      return answer;
    },
    ...overrides,
  });
  t.after(() => store.dispose());
  return { store, calls };
}
async function settled() { await new Promise((resolve) => setTimeout(resolve, 10)); }
test("共享额度契约、预留占用、超额钳制及不限状态不会伪造百分比", () => {
  assert.equal(isWebsiteQuota(quota), true);
  assert.equal(isWebsiteQuota({ ...quota, tokenLimit: null, remainingTokens: null }), true);
  for (const bad of [{ requests: -1 }, { scope: "visitor" }, { tokenLimit: 0 }, { totalTokens: "100" }, { resetAt: "invalid" }, { requestLimit: 0 }]) assert.equal(isWebsiteQuota({ ...quota, ...bad }), false);
  assert.equal(isChatStatus(status), true);
  assert.equal(isChatStatus({ ...status, canSend: "yes" }), false);
  assert.equal(quotaPercent(1500, 500, 10000), 20);
  assert.equal(quotaPercent(15000, 500, 10000), 100);
  assert.equal(quotaPercent(1500, 0, null), null);
  assert.equal(quotaStatusText({ ...status, canSend: false, code: "daily_request_quota_exceeded" }), "今日共享次数已用完");
});
test("额度与状态请求同源且携带 Cookie、不携带管理员或平台密钥", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const paths = [];
  globalThis.fetch = async (path, options) => {
    paths.push(path);
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    assert.equal(options.headers?.Authorization, undefined);
    return Response.json(path.endsWith("quota") ? quota : status);
  };
  assert.equal((await chatApi.quota()).scope, "website-shared");
  assert.equal((await chatApi.status()).canSend, true);
  assert.deepEqual(paths, ["/api/chat/quota", "/api/chat/status"]);
});
test("SSE/JSON 最终结果保留 Provider 用量，非法用量不影响合法回答", () => {
  assert.deepEqual(parseAnswer(answer).usage, usage);
  assert.equal(parseAnswer({ ...answer, usage: { ...usage, totalTokens: -1 } }).usage, undefined);
});
test("初始化与每轮完成更新额度，不按 token 查询；切换视图不重复初始化", async (t) => {
  const { store, calls } = fixture(t);
  await store.initialize(); await settled();
  assert.equal(calls.quota, 1);
  store.openWidget(); store.closeWidget();
  await settled();
  assert.equal(calls.quota, 1);
  await store.send("你好啊"); await settled();
  assert.equal(calls.quota, 2);
  assert.equal(calls.status, 2);
  assert.equal(calls.stream, 1);
  assert.deepEqual(store.state.lastUsage, usage);
  assert.equal(store.state.quota.requests, 12);
});
test("查询失败显示未知而不是零额度，也不阻止正常发送", async (t) => {
  const { store, calls } = fixture(t, { quota: async () => { throw Error("offline"); } });
  await store.initialize(); await settled();
  assert.equal(store.state.quota, null);
  assert.match(store.state.quotaError, /无法查询/);
  await store.send("你好啊"); await settled();
  assert.equal(calls.stream, 1);
  assert.equal(store.state.messages[1].content, "完成回答");
});
test("共享状态暂不可用只展示提示，不永久锁死发送；刷新查询合并", async (t) => {
  let resolveQuota;
  let calls = 0;
  const { store } = fixture(t, { quota: async () => { calls++; return new Promise((resolve) => { resolveQuota = resolve; }); } });
  await store.initialize();
  const one = store.refreshQuota();
  const two = store.refreshQuota();
  assert.equal(calls, 1);
  resolveQuota(quota);
  await Promise.all([one, two]);
  assert.equal(store.state.quotaLoading, false);
  assert.equal(store.busy(), false);
});
