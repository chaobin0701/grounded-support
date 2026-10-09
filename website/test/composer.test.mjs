import test from "node:test";
import assert from "node:assert/strict";
import { MAX_COMPOSER_LINES, resizeComposer } from "../src/chat/composer.ts";
import { readFile } from "node:fs/promises";

function fixture(contentHeight, viewportCap = Infinity) {
  const element = {
    style: { height: "", overflowY: "" },
    scrollTop: 72,
    contentHeight,
    get scrollHeight() { return this.contentHeight; },
    get clientHeight() { return Math.min(Number.parseFloat(this.style.height) || 0, viewportCap); },
  };
  const measure = () => ({ lineHeight: "24px", paddingTop: "0px", paddingBottom: "0px" });
  return { element, resize: () => resizeComposer(element, measure) };
}
test("输入框默认一行，按实际换行/自动折行高度增高，最多十行", () => {
  assert.equal(MAX_COMPOSER_LINES, 10);
  for (const [content, expected] of [[0, 24], [24, 24], [72, 72], [240, 240], [264, 240], [480, 240]]) {
    const f = fixture(content);
    assert.equal(f.resize(), content <= 24);
    assert.equal(f.element.style.height, `${expected}px`);
    assert.equal(f.element.style.overflowY, content > 240 ? "auto" : "hidden");
  }
});
test("粘贴超长输入开启内部滚动，删除/发送清空后回到一行", () => {
  const f = fixture(480);
  f.resize();
  assert.equal(f.element.style.overflowY, "auto");
  assert.equal(f.element.scrollTop, 72);
  f.element.contentHeight = 24;
  f.resize();
  assert.equal(f.element.style.height, "24px");
  assert.equal(f.element.style.overflowY, "hidden");
  assert.equal(f.element.scrollTop, 0);
});
test("小视口/手机键盘压缩可用高度后，十行以内也可内部滚动", () => {
  const f = fixture(168, 100);
  f.resize();
  assert.equal(f.element.style.overflowY, "auto");
});
test("两个模式共享自适应输入、草稿更新和尺寸监听，不遗留观察器", async () => {
  const workspace = await readFile(new URL("../src/components/ChatWorkspace.vue", import.meta.url), "utf8");
  assert.match(workspace, /watch\(\(\) => state.draft/);
  assert.match(workspace, /<InlineComposer ref="composer"/);
  assert.match(workspace, /composer.value.measure\(\)/);
  const editor = await readFile(new URL("../src/components/InlineComposer.vue", import.meta.url), "utf8");
  assert.match(editor, /resizeComposer\(element.value\)/);
  assert.match(editor, /document.removeEventListener\("selectionchange", selectionChanged\)/);
  assert.match(workspace, /new ResizeObserver/);
  assert.match(workspace, /composerObserver\?\.disconnect\(\)/);
  assert.match(workspace, /removeEventListener\("resize", fitComposer\)/);
  assert.match(workspace, /class="chat-composer-actions"/);
  assert.match(workspace, /'chat-composer--compact': compactComposer/);
  assert.match(workspace, /@compact="compactComposer = \$event"/);
  assert.doesNotMatch(workspace, /classList.add\("chat-composer--compact"\)/);
  const css = await readFile(new URL("../src/chat.css", import.meta.url), "utf8");
  assert.match(css, /max-height: min\(240px, 35dvh\);/);
  assert.match(css, /\.chat-composer\s*\{[^}]*position: relative;[^}]*min-height: 62px;[^}]*border-radius: 24px;[^}]*padding: 14px 64px;/);
  assert.match(css, /\.chat-composer--compact\s*\{[^}]*padding-block: 18px;/);
  assert.match(css, /\.chat-composer-actions\s*\{[^}]*position: absolute;[^}]*right: 10px;[^}]*bottom: 8px;[^}]*width: 44px;[^}]*height: 44px;/);
  assert.match(css, /bottom: calc\(var\(--chat-composer-height, 160px\) \+ 12px\);/);
  assert.match(css, /\.chat-composer-actions > button\s*\{/);
  assert.doesNotMatch(css, /\.chat-composer button\s*\{/);
});
