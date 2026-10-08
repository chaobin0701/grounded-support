import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const read = (path) => readFile(resolve(root, path), "utf8");

test("独立 npm 项目、自己的锁文件、中文网页与必要规则", async () => {
  const manifest = JSON.parse(await read("package.json"));
  assert.equal(manifest.name, "hexu-corporate-website");
  for (const script of ["dev", "build", "test"])
    assert.ok(manifest.scripts[script]);
  assert.ok((await stat(resolve(root, "package-lock.json"))).isFile());
  assert.match(await read("index.html"), /lang="zh-CN"/);
  assert.match(await read("AGENTS.md"), /设计方向/);
  assert.match(await read("设计规范.md"), /Furni/);
});
test("品牌和服务资料只有一个目录，七份中文 Markdown 可下载", async () => {
  const names = await readdir(resolve(root, "资料"));
  assert.equal(names.length, 7);
  const page = await read("src/pages/SupportPage.vue");
  for (const name of names) {
    assert.match(name, /^[\u4e00-\u9fa5]+\.md$/);
    const markdown = await read(`资料/${name}`);
    assert.match(markdown, /^# /);
    assert.match(markdown, /2026-10-08/);
    assert.ok(markdown.length > 650);
    assert.ok(page.includes(name));
  }
  assert.match(page, /:download=/);
});
test("应用不导入旧官网实现、不含交易路由", async () => {
  async function inspect(path) {
    for (const entry of await readdir(resolve(root, path), {
      withFileTypes: true,
    })) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) await inspect(child);
      else assert.doesNotMatch(await read(child), /\.\.\/web\/src/);
    }
  }
  await inspect("src");
  assert.doesNotMatch(
    await read("src/router.ts"),
    /path: ['"]\/(cart|checkout|login)/,
  );
});
test("动态 API、净化富文本、图片失败和减少动效均保留", async () => {
  assert.match(
    await read("src/components/RichDescription.vue"),
    /DOMPurify\.sanitize/,
  );
  assert.match(await read("src/components/ProductImage.vue"), /@error/);
  assert.match(await read("src/style.css"), /prefers-reduced-motion/);
  assert.match(await read("src/pages/HomePage.vue"), /useProducts/);
  assert.match(await read("src/pages/ProductsPage.vue"), /useProducts/);
  assert.equal(
    (await stat(resolve(root, "public/images/舒适生活.png"))).size > 100000,
    true,
  );
});
test("紧凑会话操作位于输入框上方，头像消除右侧自动留白，列表向上覆盖", async () => {
  const workspace = await read("src/components/ChatWorkspace.vue");
  const area = workspace.indexOf('class="chat-composer-area"');
  const toolbar = workspace.indexOf('class="chat-toolbar"');
  const input = workspace.indexOf('class="chat-composer"');
  assert.ok(area < toolbar && toolbar < input);
  const css = await read("src/chat-layout.css");
  assert.match(css, /\.chat-toolbar \.chat-new\s*\{[^}]*min-height: 32px;/);
  assert.match(css, /\.chat-message--user\s*\{[^}]*margin-right: 0;/);
  assert.match(css, /\.chat-history-popover\s*\{[^}]*bottom: calc\(100% \+ 8px\);/);
  assert.match(css, /\.chat-workspace--full \.chat-welcome\s*\{[^}]*margin-inline: 64px 0;/);
});
test("双模式发送按钮校验带商品名称的完整正文，不阻止只引用商品", async () => {
  const workspace = await read("src/components/ChatWorkspace.vue");
  assert.match(workspace, /const readableDraft = computed\(\(\) => serializeMessageDocument\(\{ text: state\.draft, products: state\.products \}\)\.question\)/);
  assert.match(workspace, /:disabled="busy \|\| state\.unresolved \|\| readableDraft\.length < 2 \|\| readableDraft\.length > 2000"/);
  assert.doesNotMatch(workspace, /:disabled="[^"]*!state\.draft\.trim\(\)/);
});
test("完整与悬浮助手不显示历史或流式回答的来源提示，回答与处理过程保留", async () => {
  const workspace = await read("src/components/ChatWorkspace.vue");
  assert.doesNotMatch(workspace, /chat-sources|来源 ·|message\.citations|state\.partialCitations/);
  assert.match(workspace, /:text="message\.content"/);
  assert.match(workspace, /:text="state\.partialAnswer"/);
  assert.match(workspace, /:events="message\.progressEvents \|\| \[\]"/);
});
test("历史和正在生成的执行过程均在正文之前，步骤无横线、二级分类和远端状态栏", async () => {
  const workspace = await read("src/components/ChatWorkspace.vue");
  const history = workspace.slice(workspace.indexOf('v-for="message in state.messages"'), workspace.indexOf('class="chat-message chat-message--assistant chat-pending"'));
  const pending = workspace.slice(workspace.indexOf('class="chat-message chat-message--assistant chat-pending"'));
  assert.ok(history.indexOf('<ChatProgress') < history.indexOf('<ChatMarkdown'));
  assert.ok(pending.indexOf('<ChatProgress') < pending.indexOf('<ChatMarkdown'));
  const process = await read("src/components/ChatProgress.vue");
  assert.doesNotMatch(process, /step\.label|<div>|step\.durationMs|step\.resultCount/);
  assert.match(process, /:aria-label="`\$\{toolLabel\(step\.text\)\}，\$\{step\.stateLabel\}`"/);
  const css = await read("src/chat.css");
  assert.doesNotMatch(css.match(/\.chat-process li\s*\{[^}]*\}/)?.[0] || '', /border|box-shadow/);
  assert.match(css, /\.chat-process summary\s*\{[^}]*min-height: 44px;/);
});
test("顶部咨询使用完整助手路由，双模式空白对话隐藏新建，深链接不显示悬浮机器人", async () => {
  const app = await read("src/App.vue");
  assert.match(app, /class="header-consult"\s+:to="assistantLocation\(chat.state.activeId\)"/);
  assert.doesNotMatch(app, /chat\.openWidget\(\)/);
  const workspace = await read("src/components/ChatWorkspace.vue");
  assert.match(workspace, /v-if="chat\.hasContent\(\)"\s+class="button chat-new"/);
  const widget = await read("src/components/FloatingAssistant.vue");
  assert.match(widget, /v-if="chat\.hasContent\(\)"/);
  assert.match(widget, /route.name === "assistant"/);
  assert.match(widget, /:to="assistantLocation\(chat.state.activeId\)"/);
});
test("额度位于最近会话旁，详情向上覆盖且支持焦点、关闭和刷新", async () => {
  const workspace = await read("src/components/ChatWorkspace.vue");
  const history = workspace.indexOf("<ChatHistoryMenu />");
  const quota = workspace.indexOf("<ChatQuota />");
  const composer = workspace.indexOf('class="chat-composer"');
  assert.ok(history < quota && quota < composer);
  assert.equal(workspace.split("<ChatQuota />").length - 1, 1);
  const component = await read("src/components/ChatQuota.vue");
  assert.match(component, /aria-expanded="opened"/);
  assert.match(component, /role="dialog"/);
  assert.match(component, /@keydown\.esc\.stop\.prevent/);
  assert.match(component, /panel\.value\?\.focus\(\)/);
  assert.match(component, /removeEventListener\("pointerdown", outside\)/);
  assert.match(component, /chat\.refreshQuota\(true\)/);
  for (const text of ["官网共享额度", "预留中", "剩余额度", "剩余次数", "北京时间", "以下为上次统计"])
    assert.ok(component.includes(text));
  assert.match(await read("src/chat-layout.css"), /\.chat-quota-popover\s*\{[^}]*position: absolute;[^}]*bottom: calc\(100% \+ 8px\);/);
});
test("完整助手为滚动条预留右侧空间，输入框保持同一网格", async () => {
  const css = await read("src/chat-layout.css");
  assert.match(css, /\.chat-workspace--full \.chat-messages\s*\{[^}]*padding: 6px 24px 16px 0;/);
  assert.match(css, /\.chat-workspace--full \.chat-composer-area\s*\{[^}]*padding: 12px 24px 10px 64px;/);
  assert.match(css, /\.chat-workspace--full \.chat-messages\s*\{[^}]*padding: 8px 16px 16px 0;/);
  assert.match(css, /\.chat-workspace--full \.chat-composer-area\s*\{[^}]*padding: 12px 16px 8px 46px;/);
  assert.match(await read("src/chat.css"), /\.chat-messages\s*\{[^}]*overflow-y: auto;[^}]*scrollbar-gutter: stable;/);
});
test("双模式消息只用头像区分角色，不展示名称和时间，保留未完成提示", async () => {
  const source = await read("src/components/ChatWorkspace.vue");
  assert.doesNotMatch(source, /chat-message-heading|<time|function time\(/);
  assert.doesNotMatch(source, /禾序 AI 助手/);
  assert.match(source, /class="chat-avatar"/);
  assert.match(source, /:aria-label="message.role === 'user' \? '用户消息' : '助手回答'"/);
  assert.match(source, /class="chat-incomplete">未完成/);
});
test("用户消息悬停或键盘聚焦显示复制图标，触屏始终可用且复制原文", async () => {
  const source = await read("src/components/ChatWorkspace.vue");
  assert.match(source, /v-if="message.role === 'user'"\s+class="chat-copy chat-copy--user"/);
  assert.match(source, /aria-label="复制我的消息"/);
  assert.match(source, /@click="copy\(clipboardText\(messageDocument\(message.content, message.context\)\), '消息'\)"/);
  assert.match(source, /navigator.clipboard.writeText\(text\)/);
  assert.match(source, /state.notice = `已复制\$\{kind\}`/);
  const css = await read("src/chat-layout.css");
  assert.match(css, /\.chat-copy--user\s*\{[^}]*width: 44px;[^}]*min-height: 44px;[^}]*opacity: 0;/);
  assert.match(css, /\.chat-copy--user\s*\{[^}]*top: calc\(100% \+ 4px\);[^}]*right: 0;/);
  assert.match(css, /\.chat-message--user\s*\{[^}]*padding: 0 0 48px;/);
  assert.match(css, /\.chat-message--user:hover \.chat-copy--user/);
  assert.match(css, /\.chat-message--user:focus-within \.chat-copy--user/);
  assert.match(css, /@media \(hover: none\), \(pointer: coarse\)\s*\{\s*\.chat-copy--user \{ opacity: 1; \}/);
});
test("正文移除重复注释说明，Footer 声明与产品事实入口保留", async () => {
  for (const path of [
    "src/pages/HomePage.vue", "src/pages/AboutPage.vue",
    "src/pages/ProductsPage.vue", "src/pages/ProductDetailPage.vue",
    "src/pages/SupportPage.vue", "src/components/ChatWorkspace.vue",
  ]) {
    const source = await read(path);
    assert.doesNotMatch(source, /class="(?:hero-footnote|honesty-note|catalog-disclaimer|price-note|detail-brand-note|chat-composer-note)"/);
    assert.doesNotMatch(source, /<figcaption>|学习与官网内容演示|后续导入知识库|AI 回答仅供参考/);
  }
  const app = await read("src/App.vue");
  assert.match(app, /虚拟品牌学习展示/);
  assert.match(app, /无合作或代理关系/);
  assert.match(app, /设计参考/);
  const detail = await read("src/pages/ProductDetailPage.vue");
  assert.match(detail, /查看官方资料/);
  assert.match(detail, /价格以官方渠道为准/);
  assert.match(detail, /productBrand/);
});
test("GSAP 入镜仅应用基础内容页，欢迎标题保留完整可读空间，聊天流不做打字模拟", async () => {
  assert.ok(JSON.parse(await read("package.json")).dependencies.gsap);
  assert.match(await read("src/main.ts"), /directive\("reveal", revealDirective\)/);
  for (const page of ["HomePage", "AboutPage", "ProductsPage", "SupportPage", "ProductDetailPage"]) {
    assert.match(await read(`src/pages/${page}.vue`), /v-reveal/);
  }
  assert.doesNotMatch(await read("src/App.vue"), /v-reveal/);
  const workspace = await read("src/components/ChatWorkspace.vue");
  assert.doesNotMatch(workspace, /v-reveal/);
  assert.match(workspace, /<ChatWelcome/);
  const welcome = await read("src/components/ChatWelcome.vue");
  assert.match(welcome, /<h2 ref="title">你好，我是禾序 AI 助手<\/h2>/);
  assert.doesNotMatch(welcome, /WelcomeTitle|typewriter|typing/);
  assert.doesNotMatch(await read("src/chat-layout.css"), /typewriter|welcome-caret/);
  assert.match(await read("src/motion/directive.ts"), /context\?\.revert\(\)/);
});
test("欢迎区按照图标、标题、说明、问题顺序动画，交互可跳过，卸载不遗留动画", async () => {
  const welcome = await read("src/components/ChatWelcome.vue");
  assert.match(welcome, /\.fromTo\(icon.value/);
  assert.match(welcome, /\.fromTo\(title.value/);
  assert.match(welcome, /\.fromTo\(subtitle.value/);
  assert.match(welcome, /\.fromTo\(buttons\(\)/);
  assert.match(welcome, /if \(preference.matches \|\| settled\) \{ finish\(\); return; \}/);
  assert.match(welcome, /@focusin="finish" @pointerdown.capture="finish"/);
  assert.match(welcome, /if \(!mounted \|\| settled \|\| !context\) return/);
  assert.match(welcome, /removeEventListener\("change", preferenceChanged\)/);
  assert.match(welcome, /context\?\.revert\(\)/);
});
