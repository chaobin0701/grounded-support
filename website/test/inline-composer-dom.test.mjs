// DOM simulation only: no browser is launched and no page screenshot is taken.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import ts from "typescript";
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: "http://localhost:8849" });
for (const key of ["window", "document", "Node", "Element", "HTMLElement", "SVGElement", "HTMLButtonElement", "KeyboardEvent", "MouseEvent", "CompositionEvent", "Event", "InputEvent"]) globalThis[key] = dom.window[key];
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
const { createApp, h, reactive, ref, nextTick } = await import("vue");
const { parse, compileScript } = await import("@vue/compiler-sfc");
const { readEditor, editorSelection, setEditorSelection, renderEditor } = await import("../src/chat/inline-editor-dom.ts");
const { encodeDocument, normalizeDocument } = await import("../src/chat/inline-document.ts");
const file = new URL("../src/components/InlineComposer.vue", import.meta.url);
const { descriptor } = parse(await readFile(file, "utf8"));
let compiled = compileScript(descriptor, { id: "inline-composer-test", inlineTemplate: true }).content;
compiled = compiled.replace(/(from\s*["'])([^"']+)(["'])/gu, (_all, start, specifier, end) => {
  const resolved = specifier === "vue" ? new URL("../node_modules/vue/index.mjs", import.meta.url) : new URL(specifier.endsWith(".ts") ? specifier : `${specifier}.ts`, file);
  return start + resolved.href + end;
});
compiled = ts.transpileModule(compiled, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const Composer = (await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`)).default;
const messageFile = new URL("../src/components/UserMessageContent.vue", import.meta.url);
const messageDescriptor = parse(await readFile(messageFile, "utf8")).descriptor;
let messageSource = ts.transpileModule(compileScript(messageDescriptor, { id: "user-message-test", inlineTemplate: true }).content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
messageSource = messageSource.replace(/(from\s*["'])([^"']+)(["'])/gu, (_all, start, specifier, end) => start + (specifier.startsWith('.') ? new URL(`${specifier}.ts`, messageFile).href : import.meta.resolve(specifier)) + end);
const UserMessage = (await import(`data:text/javascript;base64,${Buffer.from(messageSource).toString("base64")}`)).default;
const progressFile = new URL('../src/components/ChatProgress.vue', import.meta.url);
const progressDescriptor = parse(await readFile(progressFile, 'utf8')).descriptor;
let progressSource = ts.transpileModule(compileScript(progressDescriptor, { id: 'chat-progress-test', inlineTemplate: true }).content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
progressSource = progressSource.replace(/(from\s*["'])([^"']+)(["'])/gu, (_all, start, specifier, end) => start + (specifier.startsWith('.') ? new URL(`${specifier}.ts`, progressFile).href : import.meta.resolve(specifier)) + end);
const ChatProgress = (await import(`data:text/javascript;base64,${Buffer.from(progressSource).toString('base64')}`)).default;
const commentaryFile = new URL('../src/components/ChatCommentary.vue', import.meta.url);
const commentaryDescriptor = parse(await readFile(commentaryFile, 'utf8')).descriptor;
let commentarySource = ts.transpileModule(compileScript(commentaryDescriptor, { id: 'chat-commentary-test', inlineTemplate: true }).content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
commentarySource = commentarySource.replace(/(from\s*["'])([^"']+)(["'])/gu, (_all, start, specifier, end) => start + (specifier.startsWith('.') ? new URL(`${specifier}.ts`, commentaryFile).href : import.meta.resolve(specifier)) + end);
const ChatCommentary = (await import(`data:text/javascript;base64,${Buffer.from(commentarySource).toString('base64')}`)).default;
test('真实公开说明组件只显示最新批次、支持礼貌通知、按纯文本显示且不渲染 HTML', async t => {
  const host = document.createElement('div'); document.body.append(host);
  const state = reactive({ events: [] });
  const app = createApp({ render: () => h(ChatCommentary, { events: state.events }) }); app.mount(host);
  t.after(() => { app.unmount(); host.remove(); });
  assert.equal(host.querySelector('p'), null);
  state.events.push({ type: 'commentary', id: '1', text: '我先查看产品目录。' }); await nextTick();
  assert.equal(host.textContent, '我先查看产品目录。'); assert.equal(host.querySelector('p').getAttribute('aria-live'), 'polite');
  state.events.push({ type: 'progress', id: 'tool', stage: 'tool', status: 'running', text: '正在查看目录' }); await nextTick();
  assert.equal(host.textContent, '我先查看产品目录。');
  state.events.push({ type: 'commentary', id: '2', text: '<img src=x onerror=alert(1)>' }); await nextTick();
  assert.equal(host.querySelector('img'), null); assert.equal(host.textContent, '<img src=x onerror=alert(1)>');
});
test('真实过程组件用紧凑单行展示、按操作合并、结束后收起，状态保留为图标和无障碍描述', async t => {
  const host = document.createElement('div'); document.body.append(host);
  const catalog = { type: 'progress', id: 'catalog-start', operationId: 'catalog', stage: 'tool', status: 'running', text: '正在查看产品目录' };
  const state = reactive({ events: [catalog], settled: false });
  const app = createApp({ render: () => h(ChatProgress, { events: state.events, settled: state.settled }) }); app.mount(host);
  t.after(() => { app.unmount(); host.remove(); });
  assert.equal(host.querySelector('details').open, true);
  assert.match(host.textContent, /查看产品目录/);
  state.events.push({ ...catalog, id: 'catalog-done', status: 'completed', text: '已查看产品目录', durationMs: 1234, resultCount: 8 });
  state.events.push({ ...catalog, id: 'detail-start', operationId: 'detail', text: '正在读取产品详细规格' });
  await nextTick();
  assert.equal(host.querySelectorAll('li').length, 2);
  assert.match(host.textContent, /查看产品目录.*读取产品详细规格/s);
  const rows = host.querySelectorAll('li');
  assert.equal(rows[0].getAttribute('aria-label'), '查看产品目录，已完成');
  assert.equal(rows[1].getAttribute('aria-label'), '读取产品详细规格，进行中');
  assert.ok(rows[0].querySelector('.lucide-wrench'));
  assert.equal(host.querySelector('.lucide-check'), null);
  assert.equal(rows[0].querySelectorAll('span').length, 1);
  assert.equal(rows[0].querySelector('small'), null);
  assert.doesNotMatch(host.textContent, /资料查询|回答整理|已完成|进行中|已查看|正在读取/);
  assert.doesNotMatch(host.textContent, /1234|ms|1\.2 s|8 条/);
  state.settled = true; await nextTick();
  assert.equal(host.querySelector('details').open, false);
  assert.equal(host.querySelector('.spinner'), null);
  assert.match(host.textContent, /查看处理过程/);
  assert.match(host.textContent, /未完成/);
});
test('过程仅展示工具、步数不包含回答生成；只有回答阶段时不显示空过程', async t => {
  const host = document.createElement('div'); document.body.append(host);
  const answer = { type: 'progress', id: 'answer-end', stage: 'answer', status: 'completed', text: '回答生成完成' };
  const state = reactive({ events: [answer] });
  const app = createApp({ render: () => h(ChatProgress, { events: state.events, settled: true }) }); app.mount(host);
  t.after(() => { app.unmount(); host.remove(); });
  assert.equal(host.querySelector('details'), null);
  state.events.push({ type: 'progress', id: 'categories-end', operationId: 'categories', stage: 'tool', status: 'completed', text: '已查看产品分类' }); await nextTick();
  assert.equal(host.querySelectorAll('li').length, 1);
  assert.match(host.querySelector('summary').textContent, /1 步/);
  assert.equal(host.querySelector('li span').textContent, '查看产品分类');
  assert.ok(host.querySelector('li .lucide-wrench'));
  assert.doesNotMatch(host.textContent, /回答生成|已查看/);
});
test('过程展开保留公开说明、允许手动收起，空步骤不产生空面板', async t => {
  const host = document.createElement('div'); document.body.append(host);
  const state = reactive({ events: [], settled: false });
  const app = createApp({ render: () => h(ChatProgress, { events: state.events, settled: state.settled }) }); app.mount(host);
  t.after(() => { app.unmount(); host.remove(); });
  assert.equal(host.querySelector('details'), null);
  state.events.push({ type: 'commentary', id: 'model', text: '我先查看产品目录。' }); await nextTick();
  assert.equal(host.querySelector('details'), null);
  state.events.push({ type: 'progress', id: 'tool-start', operationId: 'tool', stage: 'tool', status: 'running', text: '正在查看产品目录' }); await nextTick();
  const details = host.querySelector('details'); details.open = false;
  state.events.push({ type: 'progress', id: 'tool-end', operationId: 'tool', stage: 'tool', status: 'completed', text: '已查看产品目录' }); await nextTick();
  assert.equal(details.open, false); // SSE updates do not override the user's collapse choice.
  state.settled = true; await nextTick();
  assert.equal(details.open, false);
  details.open = true;
  assert.match(details.textContent, /我先查看产品目录。/);
});
const product = (id, offset = 0) => ({ id, name: `产品${id}`, offset });
test("真实用户消息组件原位显示新范围和旧引用，名称只出现一次，HTML 保持文本", async t => {
  for (const [content, reference] of [['这个产品怎么样\n米家电暖器', { offset: 8, length: 5 }], ['这个产品怎么样\n', { offset: 8 }]]) {
    const host = document.createElement('div'); document.body.append(host);
    const message = reactive({ content, context: { productIds: ['1'], productReferences: [{ productId: '1', ...reference }], products: [{ id: '1', name: '米家电暖器' }] } });
    const app = createApp({ render: () => h(UserMessage, { message }) }); app.mount(host);
    t.after(() => { app.unmount(); host.remove(); });
    assert.equal(host.textContent, '这个产品怎么样\n米家电暖器');
    assert.equal(host.querySelectorAll('.chat-inline-product').length, 1);
    assert.equal(host.textContent.split('米家电暖器').length - 1, 1);
    message.content = '<img src=x onerror=alert(1)>米家电暖器';
    message.context.productReferences = [{ productId: '1', offset: message.content.length - 5, length: 5 }];
    await nextTick();
    assert.equal(host.querySelector('img'), null); assert.equal(host.textContent, message.content);
  }
});
async function mount(t, doc = { text: "", products: [] }) {
  const host = document.createElement("div"); document.body.append(host);
  const state = reactive({ ...doc, blocked: false, key: 'same-conversation' }), instance = ref(), notices = [], submissions = [];
  const app = createApp({ render: () => h(Composer, {
    ref: instance, id: "test-composer", text: state.text, products: state.products, disabled: false,
    referencesDisabled: state.blocked, documentKey: state.key, expanded: false,
    onChange: doc => { state.text = doc.text; state.products = doc.products; },
    onNotice: message => notices.push(message),
    onKeydown: event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submissions.push(state.text); } },
  }) });
  app.mount(host); await nextTick(); await nextTick();
  const root = host.querySelector(".chat-inline-editor");
  t.after(() => { app.unmount(); host.remove(); });
  const key = (key, options = {}) => root.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
  const caret = position => { root.focus(); setEditorSelection(root, position); document.dispatchEvent(new Event("selectionchange")); };
  return { root, state, instance, notices, submissions, key, caret };
}
test("DOM 中正文和原子引用真实交错，Range 在引用前/后、中间和换行后都正确", () => {
  const root = document.createElement("div"); document.body.append(root);
  const doc = { text: "前🙂\n后", products: [product("1", 1), product("2", 4)] };
  renderEditor(root, doc, false);
  assert.deepEqual(readEditor(root), doc);
  const encoded = encodeDocument(doc);
  for (let offset = 0; offset <= encoded.length; offset++) {
    setEditorSelection(root, offset);
    assert.deepEqual(editorSelection(root), { from: offset, to: offset }, `offset ${offset}`);
  }
  root.remove();
});
test("选中产品替换光标处的 /，不是加在开头；Shift+Enter 后可继续插入引用", async t => {
  const { root, state, instance, caret, key, submissions } = await mount(t, { text: "21321 / 后面", products: [] });
  caret(7);
  assert.equal(instance.value.insertProduct({ product: product("1"), draft: "21321  后面", caret: 6, replace: { from: 6, to: 7 } }), true);
  await nextTick();
  assert.equal(state.text, "21321  后面");
  assert.deepEqual(state.products, [product("1", 6)]);
  caret(7); key("Enter", { shiftKey: true }); await nextTick();
  assert.equal(state.text, "21321 \n 后面");
  instance.value.insertProduct({ product: product("2"), draft: "", caret: null }); await nextTick();
  assert.deepEqual(state.products, [product("1", 6), product("2", 7)]);
  assert.equal(encodeDocument(readEditor(root)), "21321 \uFFFC\n\uFFFC 后面");
  assert.equal(submissions.length, 0);
});
test("无 ×；任意位置的 Backspace/Delete 与选区删除同步更新产品 ID", async t => {
  const { root, state, caret, key } = await mount(t, { text: "前\n后", products: [product("1", 1), product("2", 2)] });
  caret(2); key("Backspace"); await nextTick();
  assert.deepEqual(state.products, [product("2", 2)]); assert.equal(state.text, "前\n后");
  caret(2); key("Delete"); await nextTick();
  assert.equal(state.products.length, 0);
  assert.equal(root.querySelector("[data-remove-product]"), null);
  state.products = [product("4", 1)]; await nextTick(); await nextTick();
  setEditorSelection(root, 0, 3); key("Delete"); await nextTick();
  assert.equal(state.text, "后"); assert.equal(state.products.length, 0);
});
test("剪切/粘贴保留引用位置，普通 HTML 粘贴变成文本，不执行标记", async t => {
  const { root, state, caret } = await mount(t, { text: "前\n后", products: [product("1", 2)] });
  const values = new Map();
  const clipboardData = { setData: (type, value) => values.set(type, value), getData: type => values.get(type) || "" };
  setEditorSelection(root, 1, 4);
  const cut = new Event("cut", { bubbles: true, cancelable: true }); Object.defineProperty(cut, "clipboardData", { value: clipboardData }); root.dispatchEvent(cut); await nextTick();
  assert.equal(state.text, "前"); assert.equal(state.products.length, 0);
  assert.equal(values.get("text/plain"), "\n产品1后");
  caret(1);
  const paste = new Event("paste", { bubbles: true, cancelable: true }); Object.defineProperty(paste, "clipboardData", { value: clipboardData }); root.dispatchEvent(paste); await nextTick();
  assert.equal(state.text, "前\n后"); assert.deepEqual(state.products, [product("1", 2)]);
  values.clear(); values.set("text/plain", "<img src=x onerror=alert(1)>"); caret(4);
  root.dispatchEvent(paste); await nextTick();
  assert.equal(root.querySelector("img"), null); assert.ok(state.text.includes("<img"));
});
test("移动引用不改变正文；撤销和重做保留原位置", async t => {
  const { root, state, caret, key } = await mount(t, { text: "前\n后", products: [product("1", 0)] });
  const dataTransfer = { effectAllowed: "", setData() {}, getData: () => "" };
  const start = new Event("dragstart", { bubbles: true, cancelable: true }); Object.defineProperty(start, "dataTransfer", { value: dataTransfer });
  root.querySelector("[data-product-id]").dispatchEvent(start);
  caret(4);
  const drop = new Event("drop", { bubbles: true, cancelable: true }); Object.defineProperty(drop, "dataTransfer", { value: dataTransfer }); root.dispatchEvent(drop); await nextTick();
  assert.deepEqual(state.products, [product("1", 3)]); assert.equal(state.text, "前\n后");
  key("z", { ctrlKey: true }); await nextTick(); assert.deepEqual(state.products, [product("1", 0)]);
  key("z", { ctrlKey: true, shiftKey: true }); await nextTick(); assert.deepEqual(state.products, [product("1", 3)]);
});
test("中文输入法提交不误发送；受限状态不删除引用；正常 Enter 仍发送", async t => {
  const { root, state, submissions, key, caret } = await mount(t, { text: "问题", products: [product("1", 1)] });
  root.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  key("Enter"); assert.equal(submissions.length, 0);
  root.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); await nextTick();
  state.blocked = true; await nextTick(); await nextTick();
  caret(2); key("Backspace"); await nextTick(); assert.equal(state.products.length, 1);
  state.blocked = false; await nextTick(); caret(3); key("Enter"); assert.equal(submissions.length, 1);
});
test("新建空白编辑器的第一次插入可以撤销到空白，不污染 HTML", async t => {
  const { root, instance, state, key } = await mount(t);
  assert.equal(instance.value.insertProduct({ product: product("1"), draft: "", caret: null }), true); await nextTick();
  assert.equal(state.products.length, 1);
  key("z", { ctrlKey: true }); await nextTick(); assert.equal(state.products.length, 0);
  assert.equal(root.querySelector("script"), null);
});
test('手机 beforeinput 退格删除引用；切换同内容会话不会沿用另一会话的撤销历史', async t => {
  const { root, state, instance, caret, key } = await mount(t, { text: '前后', products: [product('1', 1)] });
  caret(2); root.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true })); await nextTick();
  assert.equal(state.products.length, 0); assert.equal(state.text, '前后');
  instance.value.insertProduct({ product: product('2'), draft: '', caret: null }); await nextTick();
  state.key = 'another-conversation'; await nextTick();
  key('z', { ctrlKey: true }); await nextTick();
  assert.deepEqual(state.products, [product('2', 1)]);
});
