import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createProductReferencePicker, findProductCommand, productSubtitle, searchReferenceProducts } from "../src/chat/product-reference.ts";
import { createChatStore, DRAFT_PREFIX } from "../src/chat/store.ts";

const heater = {
  id: "midea-hft20zbj", brand: "Midea", name: "美的塔式暖风机 HFT20ZBJ", categoryId: "heating", category: "取暖",
  summary: "小空间取暖", description: "真实目录的详情", suggestedPrice: null, imageUrl: null, sourceUrl: null,
  specifications: { 型号: "HFT20ZBJ", 功率: "2000 W" },
};
const air = { ...heater, id: "xiaomi-air-pro", brand: "Xiaomi", name: "米家空气净化器 Pro", categoryId: "air", category: "空气", specifications: { 型号: "AC-M3" } };
function fixture(t, loader = async () => [heater, air]) {
  const selected = [];
  const availability = { disabled: false };
  const picker = createProductReferencePicker(loader, () => selected, () => availability.disabled);
  t.after(() => picker.dispose());
  return { picker, selected, availability };
}
async function settled(picker) {
  for (let i = 0; i < 30 && picker.state.loading; i++) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(picker.state.loading, false);
}
test("显式斜杠可以位于开头、换行和空格之后，只处理当前光标 token", () => {
  for (const text of ["/", "/小米", "想比较一下 /HFT20", "问题\n/美的"]) {
    const command = findProductCommand(text, text.length);
    assert.ok(command);
    assert.equal(text.slice(command.from, command.to), `/${command.query}`);
  }
  const text = "请比较 /小米 与已有产品";
  assert.deepEqual(findProductCommand(text, text.indexOf(" 与")), { from: 4, to: 7, query: "小米" });
  assert.equal(findProductCommand(text, 6, 7), null);
  assert.equal(findProductCommand("/小米", 2), null);
});
test("普通名称、URL、日期、分数、转义斜杠与代码不触发引用", () => {
  for (const text of [
    "美的暖风机适合卧室吗？", "https://example.com/", "请看 https://example.com/HFT20", "2026/10/08",
    "/2026-10-08", "1/2", "\\/小米", "`/小米", "```ts\n/小米", "~~~text\n/小米", "产品/小米",
  ]) assert.equal(findProductCommand(text, text.length), null, text);
  const afterCode = "```ts\nconst n = 1\n```\n/小米";
  assert.ok(findProductCommand(afterCode, afterCode.length));
  const afterInlineCode = "`示例` /小米";
  assert.ok(findProductCommand(afterInlineCode, afterInlineCode.length));
  for (const text of ["21321 /", "第一段\n/", "\uFFFC/"]) assert.ok(findProductCommand(text, text.length), text);
});
test("搜索支持原品牌/中文品牌、名称、型号与全角大小写，不匹配价格和详情", () => {
  for (const query of ["美的", "midea", "HFT20", "ｈｆｔ２０", " 美的 HFT20 "])
    assert.deepEqual(searchReferenceProducts([heater, air], query), [heater]);
  for (const query of ["小米", "XIAOMI", "AC-M3", "米家"])
    assert.deepEqual(searchReferenceProducts([heater, air], query), [air]);
  assert.deepEqual(searchReferenceProducts([heater, air], "真实目录"), []);
  assert.equal(productSubtitle(air), "小米 · AC-M3");
});
test("按钮打开不会修改草稿；首次斜杠打开才加载，后续筛选不重复请求", async t => {
  let loads = 0;
  const { picker } = fixture(t, async () => { loads++; return [heater, air]; });
  picker.syncInput("/小", 2);
  await settled(picker);
  picker.syncInput("/小米", 3);
  assert.equal(loads, 1);
  assert.deepEqual(picker.rows().map(product => product.id), [air.id]);
  const selected = picker.selection(air, "/小米");
  assert.equal(selected.draft, "");
  picker.close();
  picker.openBrowse();
  await settled(picker);
  assert.equal(picker.state.source, "button");
  assert.equal(picker.selection(heater, "适合卧室吗？").draft, "适合卧室吗？");
  assert.equal(loads, 2);
});
test("选中只删除当前命令片段，保留前后正文，不会自动提交问题", async t => {
  const { picker } = fixture(t);
  const draft = "请比较 /小米 和我已有的暖风机";
  picker.syncInput(draft, draft.indexOf(" 和"));
  await settled(picker);
  const selection = picker.selection(air, draft);
  assert.equal(selection.draft, "请比较  和我已有的暖风机");
  assert.equal(selection.caret, 4);
  assert.equal(picker.selection(air, "用户已换了一个问题"), null);
});
test("上下键跳过已选项并循环，Enter 选择而不是发送；Esc 不被光标事件重开", async t => {
  const { picker, selected } = fixture(t);
  picker.syncInput("/", 1); await settled(picker);
  assert.equal(picker.key("Enter").product.id, heater.id);
  picker.key("ArrowUp"); assert.equal(picker.state.activeId, air.id);
  picker.key("ArrowDown"); assert.equal(picker.state.activeId, heater.id);
  selected.push(heater.id); picker.resetActive();
  assert.equal(picker.state.activeId, air.id);
  picker.key("ArrowDown"); assert.equal(picker.state.activeId, air.id);
  assert.equal(picker.key("Escape").handled, true);
  picker.syncInput("/", 1); assert.equal(picker.state.opened, false);
  picker.syncInput("/小", 2); assert.equal(picker.state.opened, true);
  await settled(picker);
  assert.equal(picker.key("Tab").handled, false);
  assert.equal(picker.state.opened, false);
});
test("中文输入法提交及 Shift+Enter 不被菜单作为添加/发送动作处理", async t => {
  const { picker } = fixture(t);
  picker.syncInput("/", 1); await settled(picker);
  picker.syncInput("/小米", 3, 3, true);
  assert.equal(picker.state.query, "");
  assert.equal(picker.key("Enter", { composing: true }).handled, false);
  assert.equal(picker.key("Escape", { composing: true }).handled, false);
  assert.equal(picker.key("Enter", { shift: true }).handled, false);
  picker.syncInput("/小米", 3);
  assert.equal(picker.key("Enter").product.id, air.id);
});
test("重复产品与第六个产品不可选择，运行中不打开菜单", async t => {
  const { picker, selected, availability } = fixture(t);
  picker.openBrowse(); await settled(picker);
  selected.push(heater.id);
  assert.equal(picker.selection(heater, "问题"), null);
  selected.push("2", "3", "4", "5"); picker.resetActive();
  assert.equal(picker.state.activeId, "");
  assert.equal(picker.selection(air, "问题"), null);
  assert.equal(picker.key("Enter").handled, true);
  picker.close(); availability.disabled = true;
  picker.openBrowse(); assert.equal(picker.state.opened, false);
  picker.syncInput("/小米", 3); assert.equal(picker.state.opened, false);
});
test("加载、空结果和失败时 Enter 仍不会发送；失败清除旧数据并可重试", async t => {
  let resolve;
  let attempts = 0;
  const { picker } = fixture(t, async () => {
    attempts++;
    if (attempts === 1) return new Promise(done => { resolve = done; });
    if (attempts === 2) throw new Error("目录服务不可用");
    return [];
  });
  picker.openBrowse();
  assert.deepEqual(picker.key("Enter"), { handled: true, product: undefined });
  resolve([heater]); await settled(picker);
  picker.setQuery("不存在"); assert.equal(picker.key("Enter").product, undefined);
  await picker.reload();
  assert.equal(picker.state.error, "目录服务不可用");
  assert.deepEqual(picker.state.products, []);
  await picker.reload();
  assert.equal(picker.state.error, "");
  assert.equal(picker.state.products.length, 0);
});
test("取消/卸载及过期目录请求的结果不能覆盖新结果", async t => {
  const pending = [];
  const { picker } = fixture(t, signal => new Promise(resolve => pending.push({ signal, resolve })));
  picker.openBrowse();
  const reloaded = picker.reload();
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve([air]); await reloaded;
  pending[0].resolve([heater]); await Promise.resolve();
  assert.equal(picker.state.products[0].id, air.id);
  const final = picker.reload(); picker.dispose();
  assert.equal(pending[2].signal.aborted, true);
  pending[2].resolve([heater]); await final;
  assert.equal(picker.state.products[0].id, air.id);
});
test("从菜单选择到草稿恢复再到 SSE，正文保留名称、ID 用于查询且无斜杠标记", async t => {
  const map = new Map();
  const storage = { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
  const requests = [];
  const api = {
    list: async () => [], presentation: async () => ({ suggestedQuestions: [] }),
    create: async () => ({ id: "11111111-1111-4111-8111-111111111111" }),
    stream: async (_id, question, _key, _callbacks, _signal, context) => { requests.push({ question, context }); return { answer: "已回复", refused: false, citations: [] }; },
  };
  const store = createChatStore(api, storage); t.after(() => store.dispose());
  await store.initialize(); store.setDraft("/美的 适合卧室吗？");
  const { picker } = fixture(t);
  picker.syncInput(store.state.draft, 3); await settled(picker);
  const selection = picker.selection(heater, store.state.draft);
  store.setComposer(selection.draft, [{ id: selection.product.id, name: selection.product.name, offset: selection.caret }]);
  assert.equal(requests.length, 0);
  assert.equal(JSON.parse(map.get(`${DRAFT_PREFIX}new.products`))[0].id, heater.id);
  store.attachProduct({ id: air.id, name: air.name });
  store.removeProduct(air.id);
  assert.equal(store.state.draft, selection.draft);
  assert.deepEqual(store.state.products.map(product => product.id), [heater.id]);
  const restored = createChatStore(api, storage); t.after(() => restored.dispose());
  await restored.initialize();
  assert.equal(restored.state.products[0].id, heater.id);
  await restored.send();
  assert.deepEqual(requests, [{ question: `${heater.name} 适合卧室吗？`, context: { productIds: [heater.id], productReferences: [{ productId: heater.id, offset: 0, length: heater.name.length }] } }]);
  assert.equal(restored.state.messages[0].context.products[0].name, heater.name);
});
test("产品引用与正文继承同一字号行高，图标与文字垂直居中且不影响换行", async () => {
  const css = await readFile(new URL('../src/product-reference.css', import.meta.url), 'utf8');
  const rule = css.match(/^\.chat-inline-product\s*\{([^}]+)\}/m)?.[1];
  assert.ok(rule);
  for (const declaration of ['align-items: center', 'vertical-align: middle', 'font: inherit', 'line-height: inherit', 'padding: 0 8px', 'margin-inline: 4px']) assert.ok(rule.includes(declaration));
  assert.doesNotMatch(rule, /font-size:\s*13px|line-height:\s*20px/);
  assert.match(css, /\.chat-inline-product > svg\s*\{[^}]*width: 1em;[^}]*height: 1em;/);
  assert.match(css, /\.chat-user-text-segment\s*\{[^}]*vertical-align: middle;/);
  const component = await readFile(new URL('../src/components/UserMessageContent.vue', import.meta.url), 'utf8');
  assert.ok(component.includes('class="chat-user-text-segment"'));
  assert.doesNotMatch(css, /\.chat-user-content\s*\{[^}]*display:\s*flex/);
});
test("双模式共用选择器，无嵌套按钮链接，浮层不撑开布局且监听完整清理", async () => {
  const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const workspace = await read("src/components/ChatWorkspace.vue");
  assert.match(workspace, /<ProductReferencePicker ref="productPicker"/);
  assert.match(workspace, /productPicker.value\?\.keyboard\(event\)/);
  assert.match(workspace, /keyCode === 229/);
  assert.match(workspace, /:active-descendant="productPicker\?\.activeDescendant"/);
  assert.ok(workspace.indexOf('class="chat-composer"') < workspace.indexOf('<InlineComposer ref="composer"'));
  assert.match(workspace, /JSON.stringify\(state.products\), fitComposer/);
  const editor = await read("src/components/InlineComposer.vue");
  assert.match(editor, /@compositionstart="compositionStart"/);
  assert.match(editor, /PRODUCT_TOKEN/);
  assert.match(editor, /event.key === "Backspace" \|\| event.key === "Delete"/);
  const component = await read("src/components/ProductReferencePicker.vue");
  for (const text of ['role="listbox"', 'role="option"', 'aria-autocomplete="list"', 'event.stopPropagation()', 'ResizeObserver', 'visualViewport', 'picker.dispose()', 'observer?.disconnect()']) assert.ok(component.includes(text));
  assert.match(component, /HTMLButtonElement && event.key !== "Escape"/);
  assert.doesNotMatch(component, /scrollIntoView/);
  for (const name of ["pointerdown", "focusin", "resize", "scroll"]) assert.ok(component.includes(`removeEventListener("${name}"`));
  const card = await read("src/components/ProductCard.vue");
  assert.ok(card.indexOf("</RouterLink>") < card.indexOf("<button"));
  assert.match(card, /chat.openWidget\(\{ id: product.id, name: product.name \}\)/);
  assert.match(await read("src/components/FloatingAssistant.vue"), /<ChatWorkspace mode="widget"/);
  assert.match(await read("src/pages/AssistantPage.vue"), /<ChatWorkspace mode="full"/);
  assert.match(await read("src/product-reference.css"), /\.chat-product-popover\s*\{[^}]*position: absolute;/);
  assert.match(await read("src/product-reference.css"), /prefers-reduced-motion/);
});
test('添加入口位于输入框左下角，先展开菜单再选择产品，保留斜杠与引用插入能力', async () => {
  const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const workspace = await read('src/components/ChatWorkspace.vue');
  const toolbar = workspace.slice(workspace.indexOf('class="chat-toolbar"'), workspace.indexOf('<form class="chat-composer"'));
  assert.doesNotMatch(toolbar, /ProductReferencePicker/);
  assert.ok(workspace.indexOf('<form class="chat-composer"') < workspace.indexOf('<ProductReferencePicker'));
  const picker = await read('src/components/ProductReferencePicker.vue');
  assert.match(picker, /<Plus :size="20"/);
  assert.match(picker, /role="menu"/);
  assert.match(picker, /role="menuitem" @click="browse"/);
  assert.match(picker, /添加产品/);
  assert.match(picker, /picker\.openBrowse\(\)/);
  assert.match(picker, /composer\.getBoundingClientRect\(\)\.top/);
  const css = await read('src/product-reference.css');
  assert.match(css, /\.chat-product-trigger\s*\{[^}]*position: absolute;[^}]*left: 10px;[^}]*bottom: 8px;[^}]*width: 44px;[^}]*height: 44px;/);
  assert.match(css, /\.chat-add-menu\s*\{[^}]*position: absolute;/);
});
