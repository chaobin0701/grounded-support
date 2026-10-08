import test from "node:test";
import assert from "node:assert/strict";
import { nextTick } from "vue";
import { createRouter, createMemoryHistory } from "vue-router";
import { createChatStore, ACTIVE_KEY, DRAFT_PREFIX } from "../src/chat/store.ts";
import { bindChatRoute, assistantLocation } from "../src/chat/route.ts";
import { ChatApiError } from "../src/chat/api.ts";

const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const message = { id: 1, role: "assistant", content: "保存的回答", citations: [], createdAt: new Date().toISOString() };
function fixture(t, overrides = {}, saved = {}) {
  const memory = new Map(Object.entries(saved));
  const calls = { messages: [], create: 0, stream: 0 };
  const store = createChatStore({
    list: async () => [],
    presentation: async () => ({ suggestedQuestions: [] }),
    messages: async (value) => { calls.messages.push(value); return [message]; },
    runs: async () => [],
    create: async () => { calls.create++; return { id }; },
    stream: async () => { calls.stream++; return { answer: "新的回答", refused: false, citations: [] }; },
    remove: async () => {},
    ...overrides,
  }, {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: (key) => memory.delete(key),
  });
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/", component: {} },
    { path: "/assistant/:conversationId?", name: "assistant", component: {} },
  ] });
  const stop = bindChatRoute(router, store);
  t.after(() => { stop(); store.dispose(); });
  return { store, router, calls, memory };
}
async function settled() {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await nextTick();
}
test("会话深链接优先于本地上次 ID，恢复消息和草稿不重新发送", async (t) => {
  const { router, store, calls, memory } = fixture(t, {}, {
    [ACTIVE_KEY]: other,
    [`${DRAFT_PREFIX}${id}`]: "这个会话的草稿",
  });
  await router.push(`/assistant/${id}`);
  assert.equal(store.state.activeId, id);
  assert.equal(memory.get(ACTIVE_KEY), id);
  assert.equal(store.state.draft, "这个会话的草稿");
  assert.equal(store.state.messages[0].content, message.content);
  assert.ok(calls.messages.every((value) => value === id));
  assert.equal(calls.create, 0);
  assert.equal(calls.stream, 0);
});
test("首次发送写入路径；切换、新建、删除同步 URL，空白状态无新建操作", async (t) => {
  const { router, store, calls } = fixture(t);
  await router.push("/assistant");
  assert.equal(store.hasContent(), false);
  assert.equal(calls.create, 0);
  await store.send("你好啊");
  await settled();
  assert.equal(router.currentRoute.value.path, `/assistant/${id}`);
  assert.equal(store.hasContent(), true);
  await store.openConversation(other);
  await settled();
  assert.equal(router.currentRoute.value.path, `/assistant/${other}`);
  store.newConversation();
  await settled();
  assert.equal(router.currentRoute.value.path, "/assistant");
  assert.equal(store.hasContent(), false);
  await router.push(`/assistant/${id}`);
  await store.removeConversation(id);
  await settled();
  assert.equal(router.currentRoute.value.path, "/assistant");
  assert.equal(calls.create, 1);
});
test("直接访问空路径恢复当前浏览器；导航历史中的路径指定另一会话", async (t) => {
  const { router, store } = fixture(t, {}, { [ACTIVE_KEY]: id });
  await router.push("/assistant");
  await settled();
  assert.equal(router.currentRoute.value.path, `/assistant/${id}`);
  await router.push(`/assistant/${other}`);
  assert.equal(store.state.activeId, other);
  router.back();
  await settled();
  assert.equal(store.state.activeId, id);
  assert.equal(router.currentRoute.value.path, `/assistant/${id}`);
});
test("不同浏览器的 Cookie 不授予访问；404 清除 URL 和加载状态，不新建或重发", async (t) => {
  const { router, store, calls } = fixture(t, { messages: async (value) => {
    calls.messages.push(value);
    throw new ChatApiError(404);
  } });
  await router.push(`/assistant/${id}`);
  await settled();
  assert.equal(router.currentRoute.value.path, "/assistant");
  assert.equal(store.state.activeId, null);
  assert.deepEqual(store.state.messages, []);
  assert.equal(store.state.loading, false);
  assert.match(store.state.error, /当前浏览器/);
  assert.deepEqual(calls.messages, [id]);
  assert.equal(calls.create, 0);
  assert.equal(calls.stream, 0);
});
test("非法路径 ID 不请求消息；现有会话拒绝访问不会覆盖已加载内容", async (t) => {
  const { router, store, calls } = fixture(t, { messages: async (value) => {
    calls.messages.push(value);
    if (value === other) throw new ChatApiError(404);
    return [message];
  } });
  await router.push("/assistant/not-a-uuid");
  assert.equal(calls.messages.length, 0);
  await router.push(`/assistant/${id}`);
  await router.push(`/assistant/${other}`);
  assert.equal(store.state.activeId, id);
  assert.equal(router.currentRoute.value.path, `/assistant/${id}`);
  assert.match(store.state.error, /当前浏览器/);
});
test("生成中从悬浮模式进入完整页不重复消费 SSE，也不允许路径切换会话", async (t) => {
  let finish;
  const { router, store, calls } = fixture(t, { stream: async () => {
    calls.stream++;
    return new Promise((resolve) => { finish = resolve; });
  } });
  await router.push("/");
  await store.initialize();
  const sending = store.send("你好啊");
  await settled();
  await router.push(assistantLocation(store.state.activeId));
  assert.equal(router.currentRoute.value.path, `/assistant/${id}`);
  await router.push(`/assistant/${other}`);
  assert.equal(store.state.activeId, id);
  assert.equal(router.currentRoute.value.path, `/assistant/${id}`);
  assert.equal(calls.messages.length, 0);
  assert.equal(calls.stream, 1);
  finish({ answer: "生成完成", refused: false, citations: [] });
  await sending;
  assert.equal(store.state.messages.length, 2);
});
