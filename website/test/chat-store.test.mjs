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
test('说明与答案分别保存；重复说明事件去重且不会改变发送正文或答案', async t => {
  const commentary = { type: 'commentary', id: 'batch-1', text: '我先查看产品资料。' };
  const { store } = fixture(t, { stream: async (_id, _question, _req, callbacks) => {
    callbacks.commentary(commentary); callbacks.commentary(commentary);
    assert.deepEqual(store.state.progress, [commentary]);
    assert.equal(store.state.partialAnswer, '');
    callbacks.delta(answer.answer);
    return answer;
  } });
  await store.initialize(); store.setDraft('介绍产品'); await store.send();
  const message = store.state.messages.at(-1);
  assert.equal(message.content, answer.answer); assert.deepEqual(message.progressEvents, [commentary]);
});
test('只引用一个产品也能发送：名称进入正文、ID 与范围独立提交，首次发送才创建会话', async t => {
  const bodies = [];
  const { store, counts } = fixture(t, { stream: async (_id, question, _req, _callbacks, _signal, context) => { bodies.push({ question, context }); return answer; } });
  await store.initialize();
  store.attachProduct({ id: 'xiaomi-fresh-air', name: '米家新风机' });
  assert.equal(store.state.draft, '');
  assert.equal(counts.create, 0);
  await store.send();
  assert.equal(counts.create, 1);
  assert.deepEqual(bodies, [{ question: '米家新风机', context: { productIds: ['xiaomi-fresh-air'], productReferences: [{ productId: 'xiaomi-fresh-air', offset: 0, length: 5 }] } }]);
  assert.equal(store.state.messages[0].content, '米家新风机');
  assert.equal(store.state.products.length, 0);
});
test('只引用多个产品支持发送与去重；删除最后一个引用后，空白不能创建会话', async t => {
  const bodies = [];
  const { store, counts } = fixture(t, { stream: async (_id, question, _req, _callbacks, _signal, context) => { bodies.push({ question, context }); return answer; } });
  await store.initialize();
  store.setComposer(' \n ', [{ id: '1', name: '米家新风机', offset: 0 }, { id: '1', name: '米家新风机', offset: 0 }, { id: '2', name: '米家电暖器', offset: 2 }]);
  await store.send();
  assert.deepEqual(bodies[0], { question: '米家新风机 \n米家电暖器', context: { productIds: ['1', '2'], productReferences: [{ productId: '1', offset: 0, length: 5 }, { productId: '2', offset: 7, length: 5 }] } });
  store.newConversation();
  store.attachProduct({ id: '1', name: '米家新风机' });
  store.removeProduct('1');
  store.setDraft(' \n ');
  await store.send();
  assert.equal(bodies.length, 1);
  assert.equal(counts.create, 1);
  assert.equal(store.state.activeId, null);
});
test('产品附件最多五个，自动去重、移除、刷新恢复，正文保留名称且 ID 独立提交', async t => {
  const bodies = [];
  const { store, storage } = fixture(t, { stream: async (_id, _q, _req, _callbacks, _signal, context) => { bodies.push(context); return answer; } });
  await store.initialize();
  for (let i = 1; i <= 5; i++) assert.equal(store.attachProduct({ id: String(i), name: `产品${i}` }), true);
  store.attachProduct({ id: '1', name: '产品1' });
  assert.equal(store.state.products.length, 5);
  assert.equal(store.attachProduct({ id: '6', name: '产品6' }), false);
  const restored = fixture(t, {}, storage).store; await restored.initialize();
  assert.equal(restored.state.products.length, 5);
  store.removeProduct('2'); store.setDraft('适合卧室使用吗？');
  await store.send();
  assert.deepEqual(bodies[0], { productIds: ['1','3','4','5'], productReferences: ['1','3','4','5'].map((productId, index) => ({ productId, offset: index * 3, length: 3 })) });
  assert.equal(store.state.messages[0].content, '产品1产品3产品4产品5适合卧室使用吗？');
  assert.equal(store.state.messages[0].context.products.length, 4);
  assert.equal(store.state.products.length, 0);
});
test('恢复失败请求时保留产品，换产品重发不会复用旧幂等 ID', async t => {
  const storage = new MemoryStorage();
  storage.setItem(ACTIVE_KEY, id);
  storage.setItem(PENDING_KEY, JSON.stringify({ conversationId: id, requestId: 'old', question: '适合卧室吗？', products: [{ id: '1', name: '产品1' }] }));
  const { store, requests } = fixture(t, {}, storage);
  await store.initialize();
  assert.equal(store.state.products[0]?.id, '1');
  store.removeProduct('1'); store.attachProduct({ id: '2', name: '产品2' });
  await store.send('适合卧室吗？');
  assert.notEqual(requests[0], 'old');
});
test('正文中间与换行后的引用随草稿恢复，发送时修正空白偏移，历史原位保存', async t => {
  const bodies = [];
  const { store, storage } = fixture(t, { stream: async (_id, question, _req, _callbacks, _signal, context) => { bodies.push({ question, context }); return answer; } });
  await store.initialize();
  const text = '  前🙂\n后  ', products = [{ id: '1', name: '产品1', offset: 3 }, { id: '2', name: '产品2', offset: 6 }];
  store.setComposer(text, products);
  const restored = fixture(t, {}, storage).store; await restored.initialize();
  assert.equal(restored.state.draft, text); assert.deepEqual([...restored.state.products], products);
  await store.send();
  const context = { productIds: ['1','2'], productReferences: [{ productId: '1', offset: 1, length: 3 }, { productId: '2', offset: 7, length: 3 }] };
  assert.deepEqual(bodies[0], { question: '前产品1🙂\n产品2后', context });
  assert.deepEqual(store.state.messages[0].context.productReferences, context.productReferences);
});
test('相同正文与产品沿用未确认请求 ID，完成恢复后不会遗留产品草稿', async t => {
  const storage = new MemoryStorage();
  storage.setItem(ACTIVE_KEY, id);
  storage.setItem(PENDING_KEY, JSON.stringify({ conversationId: id, requestId: 'same', question: '适合卧室吗？', products: [{ id: '1', name: '产品1' }] }));
  const { store, requests } = fixture(t, {}, storage);
  await store.initialize();
  await store.send(); assert.equal(requests[0], 'same');
  assert.equal(store.state.products.length, 0);
});
test('新的未确认请求恢复编辑器草稿，重发沿用完整正文、范围和幂等 ID', async t => {
  const storage = new MemoryStorage();
  const products = [{ id: '1', name: '米家电暖器', offset: 8 }];
  const context = { productIds: ['1'], productReferences: [{ productId: '1', offset: 8, length: 5 }] };
  storage.setItem(ACTIVE_KEY, id);
  storage.setItem(PENDING_KEY, JSON.stringify({ conversationId: id, requestId: 'new-range', question: '这个产品怎么样\n米家电暖器', draft: '这个产品怎么样\n', products, context }));
  const bodies = [];
  const { store } = fixture(t, { stream: async (_id, question, requestId, _cb, _signal, context) => { bodies.push({ question, requestId, context }); return answer; } }, storage);
  await store.initialize();
  assert.equal(bodies.length, 0); // Refresh never resends automatically.
  assert.equal(store.state.draft, '这个产品怎么样\n');
  assert.deepEqual([...store.state.products], products);
  await store.send();
  assert.deepEqual(bodies, [{ question: '这个产品怎么样\n米家电暖器', requestId: 'new-range', context }]);
});
test('失败回答从服务端完整正文恢复内联编辑器，重新发送不重复名称', async t => {
  const storage = new MemoryStorage(); storage.setItem(ACTIVE_KEY, id);
  const context = { productIds: ['1'], productReferences: [{ productId: '1', offset: 8, length: 5 }] };
  storage.setItem(PENDING_KEY, JSON.stringify({ conversationId: id, requestId: 'failed', question: '这个产品怎么样\n米家电暖器', draft: '这个产品怎么样\n', products: [{ id: '1', name: '米家电暖器', offset: 8 }], context }));
  const bodies = []; let failure = true;
  const { store } = fixture(t, { runs: async () => failure ? [{ clientRequestId: 'failed', status: 'failed', question: '这个产品怎么样\n米家电暖器', context }] : [], stream: async (_id, question, requestId, _cb, _signal, context) => { bodies.push({ question, requestId, context }); return answer; } }, storage);
  await store.initialize(); failure = false;
  assert.equal(store.state.draft, '这个产品怎么样\n');
  assert.equal(store.state.products[0].name, '米家电暖器');
  assert.equal(storage.getItem(PENDING_KEY), null);
  await store.send();
  assert.equal(bodies[0].question, '这个产品怎么样\n米家电暖器');
  assert.deepEqual(bodies[0].context, context);
  assert.notEqual(bodies[0].requestId, 'failed');
});
test('网络失败保留不含标签名称的编辑草稿和产品位置，手动重试不重复名称', async t => {
  const bodies = []; let failure = true;
  const { store } = fixture(t, { stream: async (_id, question, requestId, _cb, _signal, context) => { bodies.push({ question, requestId, context }); if (failure) throw new Error('断网'); return answer; } });
  await store.initialize();
  store.setComposer('这个产品怎么样\n', [{ id: '1', name: '米家电暖器', offset: 8 }]);
  await store.send();
  assert.equal(store.state.draft, '这个产品怎么样\n');
  assert.equal(store.state.products[0].offset, 8);
  failure = false; await store.send();
  assert.deepEqual(bodies[1], bodies[0]);
});
test('损坏的新请求元数据不能覆盖草稿或引发恢复崩溃', async t => {
  for (const corrupt of [{ draft: 7 }, { context: { productReferences: 'invalid' } }, { context: { productIds: ['1'], productReferences: [{ productId: '1', offset: 0, length: 99 }] } }]) {
    const storage = new MemoryStorage(); storage.setItem(ACTIVE_KEY, id);
    storage.setItem(`${DRAFT_PREFIX}${id}`, '下一条问题');
    storage.setItem(PENDING_KEY, JSON.stringify({ conversationId: id, requestId: 'corrupt', question: '旧问题', ...corrupt }));
    const { store } = fixture(t, {}, storage);
    await store.initialize(); assert.equal(store.state.draft, '下一条问题');
    await store.send(); assert.equal(store.state.messages[0].content, '下一条问题');
  }
});
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

test("每日额度不足保留明确提示而不是提问频繁，不自动重新发送", async (t) => {
  const { store, counts } = fixture(t, { stream: async () => { counts.stream++; throw new ChatApiError(429, "今日 Token 额度已用完，请明日再试。", "daily_token_quota_exceeded", "2026-10-09T00:00:00+08:00"); } });
  await store.initialize(); store.setDraft("你好"); await store.send();
  assert.equal(counts.stream, 1);
  assert.equal(store.state.error, "今日 Token 额度已用完，请明日再试。");
  assert.equal(store.state.draft, "你好");
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
test("历史列表失败不影响恢复已保存的当前会话与草稿", async (t) => {
  const storage = new MemoryStorage();
  storage.setItem(ACTIVE_KEY, id);
  storage.setItem(`${DRAFT_PREFIX}${id}`, "当前会话草稿");
  const { store, counts } = fixture(t, {
    list: async () => { throw new ChatApiError(503); },
    messages: async () => [message],
  }, storage);
  await store.initialize();
  assert.equal(store.state.activeId, id);
  assert.equal(store.state.messages[0].content, message.content);
  assert.equal(store.state.draft, "当前会话草稿");
  assert.equal(counts.create, 0);
  assert.equal(counts.stream, 0);
});
