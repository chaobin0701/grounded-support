import test from "node:test";
import assert from "node:assert/strict";
import {
  createChatStore,
  ACTIVE_KEY,
  PENDING_KEY,
  DRAFT_PREFIX,
} from "../src/chat/store.ts";
import { ChatApiError } from "../src/chat/api.ts";
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const item = {
  id,
  title: "测试会话",
  summary: "",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const answer = { answer: "你好，欢迎咨询。", refused: false, citations: [] };
const message = {
  id: 2,
  role: "assistant",
  content: answer.answer,
  refused: false,
  citations: [],
  createdAt: new Date().toISOString(),
};
class MemoryStorage {
  data = new Map();
  getItem(key) {
    return this.data.get(key) ?? null;
  }
  setItem(key, value) {
    this.data.set(key, value);
  }
  removeItem(key) {
    this.data.delete(key);
  }
}
function fixture(
  t,
  overrides = {},
  storage = new MemoryStorage(),
  options = {},
) {
  const counts = { list: 0, create: 0, stream: 0, remove: 0 };
  const requests = [];
  const api = {
    list: async () => {
      counts.list++;
      return [];
    },
    create: async () => {
      counts.create++;
      return item;
    },
    messages: async () => [],
    runs: async () => [],
    remove: async () => {
      counts.remove++;
    },
    presentation: async () => ({
      title: "",
      description: "",
      suggestedQuestions: [],
    }),
    stream: async (_id, _q, req) => {
      counts.stream++;
      requests.push(req);
      return answer;
    },
    ...overrides,
  };
  const store = createChatStore(api, storage, options);
  t.after(() => store.dispose());
  return { store, counts, storage, requests };
}
async function eventually(fn) {
  for (let i = 0; i < 100 && !fn(); i++)
    await new Promise((resolve) => setTimeout(resolve, 2));
  assert.ok(fn());
}
test("初始化一次、打开窗口和新建不创建空会话，首次发送才创建", async (t) => {
  const { store, counts } = fixture(t);
  const first = store.initialize();
  assert.equal(first, store.initialize());
  await first;
  store.openWidget();
  store.closeWidget();
  store.newConversation();
  store.newConversation();
  assert.equal(counts.create, 0);
  assert.equal(counts.list, 1);
  store.setDraft("你好啊");
  await store.send();
  assert.equal(counts.create, 1);
  assert.equal(counts.stream, 1);
  assert.equal(store.state.messages.length, 2);
  store.setDraft("再次问候");
  await store.send();
  assert.equal(counts.create, 1);
  assert.equal(counts.stream, 2);
});
test("生成中关闭/打开/进入完整视图只改变展示，SSE 单次消费；下一问题草稿保留", async (t) => {
  let resolveAnswer;
  let cb;
  let streams = 0;
  const { store, storage } = fixture(t, {
    stream: async (_id, _q, _r, callbacks) => {
      streams++;
      cb = callbacks;
      return new Promise((resolve) => {
        resolveAnswer = resolve;
      });
    },
  });
  await store.initialize();
  store.setDraft("你好");
  const sending = store.send();
  await eventually(() => !!cb);
  cb.delta("正在输出");
  store.closeWidget();
  store.openWidget();
  store.closeWidget();
  assert.equal(store.state.partialAnswer, "正在输出");
  assert.equal(store.newConversation(), false);
  store.setDraft("下一轮的草稿");
  await store.send();
  assert.equal(streams, 1);
  resolveAnswer(answer);
  await sending;
  assert.equal(store.state.isSending, false);
  assert.equal(store.state.draft, "下一轮的草稿");
  assert.equal(storage.getItem(`${DRAFT_PREFIX}${id}`), "下一轮的草稿");
});
test("刷新恢复当前会话与草稿，运行状态仅查询不重发", async (t) => {
  const storage = new MemoryStorage();
  storage.setItem(ACTIVE_KEY, id);
  storage.setItem(`${DRAFT_PREFIX}${id}`, "未发送的草稿");
  const { store, counts } = fixture(
    t,
    { messages: async () => [message] },
    storage,
  );
  await store.initialize();
  assert.equal(store.state.activeId, id);
  assert.equal(store.state.draft, "未发送的草稿");
  assert.equal(store.state.messages[0].content, message.content);
  assert.equal(counts.stream, 0);
});
test("失效会话 ID 和损坏存储不使应用崩溃", async (t) => {
  const storage = new MemoryStorage();
  storage.setItem(ACTIVE_KEY, id);
  storage.setItem(PENDING_KEY, "{bad");
  const { store } = fixture(
    t,
    {
      messages: async () => {
        throw new ChatApiError(404);
      },
    },
    storage,
  );
  await store.initialize();
  assert.equal(store.state.activeId, null);
  assert.equal(store.state.loading, false);
  const bad = fixture(
    t,
    {},
    {
      getItem() {
        throw Error("blocked");
      },
      setItem() {
        throw Error("blocked");
      },
      removeItem() {
        throw Error("blocked");
      },
    },
  ).store;
  await bad.initialize();
  bad.setDraft("安全草稿");
  assert.equal(bad.state.draft, "安全草稿");
});
test("409 后查询 running，恢复完成，不重复执行请求，不永久加载", async (t) => {
  let key;
  let polls = 0;
  const { store } = fixture(
    t,
    {
      stream: async (_id, _q, req) => {
        key = req;
        throw new ChatApiError(409);
      },
      runs: async () => [
        {
          id: other,
          clientRequestId: key,
          question: "你好啊",
          status: ++polls < 2 ? "running" : "completed",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      ],
      messages: async () => (polls >= 2 ? [message] : []),
    },
    undefined,
    { pollMs: 1 },
  );
  await store.initialize();
  await store.send("你好啊");
  await eventually(() => !store.state.recovering);
  assert.equal(store.state.messages[0].content, answer.answer);
  assert.equal(store.state.isSending, false);
  assert.equal(store.state.draft, "");
  assert.equal(store.state.unresolved, false);
});
test("相同历史问题不能被误认为本次失败请求的成功答案", async (t) => {
  const { store, requests } = fixture(t, {
    messages: async () => [message],
    runs: async () => [
      {
        id: other,
        clientRequestId: "older-request",
        question: "相同问题",
        status: "completed",
        expiresAt: new Date().toISOString(),
      },
    ],
    stream: async (_id, _q, req) => {
      requests.push(req);
      throw new ChatApiError(0);
    },
  });
  await store.initialize();
  await store.send("相同问题");
  assert.equal(store.state.notice, "");
  assert.equal(store.state.draft, "相同问题");
  assert.equal(store.state.isSending, false);
  await store.send();
  assert.equal(requests.length, 2);
  assert.equal(requests[0], requests[1]);
});
test("429 保留问题且允许稍后手动重试，不启动自动重试", async (t) => {
  let streams = 0;
  const { store } = fixture(t, {
    stream: async () => {
      streams++;
      throw new ChatApiError(429);
    },
  });
  await store.initialize();
  await store.send("你好");
  assert.equal(streams, 1);
  assert.match(store.state.error, /频繁/);
  assert.equal(store.state.draft, "你好");
  assert.equal(store.state.unresolved, false);
});
test("恢复查询失败三次/超时停止加载，显示检查状态入口", async (t) => {
  const storage = new MemoryStorage();
  storage.setItem(ACTIVE_KEY, id);
  let calls = 0;
  const { store } = fixture(
    t,
    {
      runs: async () => {
        calls++;
        if (calls > 1) throw new ChatApiError(0);
        return [
          {
            id: other,
            clientRequestId: "run",
            question: "问题",
            status: "running",
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          },
        ];
      },
    },
    storage,
    { pollMs: 1 },
  );
  await store.initialize();
  await eventually(() => !store.state.recovering);
  assert.equal(store.state.unresolved, true);
  assert.match(store.state.error, /检查上轮状态/);
  assert.equal(store.state.isSending, false);
  assert.equal(calls, 4);
});
test("会话切换保存不同草稿，删除清理当前会话并发出通用提示", async (t) => {
  const { store, storage, counts } = fixture(t, {
    list: async () => [item],
    messages: async () => [message],
  });
  await store.initialize();
  await store.openConversation(id);
  store.setDraft("这个会话的草稿");
  store.newConversation();
  store.setDraft("新会话草稿");
  await store.openConversation(id);
  assert.equal(store.state.draft, "这个会话的草稿");
  await store.removeConversation(id);
  assert.equal(counts.remove, 1);
  assert.equal(store.state.activeId, null);
  assert.equal(store.state.notice, "会话已删除");
  assert.equal(store.state.draft, "新会话草稿");
  assert.equal(storage.getItem(`${DRAFT_PREFIX}${id}`), null);
});
