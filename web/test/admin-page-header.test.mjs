import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parse, compileScript } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';

const source = await readFile(new URL('../src/ui/AdminPageHeader.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
const compiled = compileScript(descriptor, { id: 'admin-page-header-test', inlineTemplate: true });
const code = ts.transpileModule(compiled.content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/from (["'])(vue|@lucide\/vue)\1/gu, (_match, _quote, name) => `from ${JSON.stringify(import.meta.resolve(name))}`);
const { default: Header } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

async function render(props, slots = {}) {
  const app = createSSRApp({ render: () => h(Header, props, slots) });
  app.component('RouterLink', { props: ['to'], setup: (props, { slots, attrs }) => () => h('a', { ...attrs, href: props.to }, slots.default?.()) });
  return renderToString(app);
}

test('root page header contains only the title, optional badge and actions, without explanatory rows', async () => {
  const html = await render({ title: '会话管理' }, { badge: () => h('span', '只读'), actions: () => h('button', '刷新') });
  assert.match(html, /<h1>会话管理<\/h1>/u);
  assert.match(html, /<button>刷新<\/button>/u);
  assert.match(html, /只读/u);
  assert.doesNotMatch(html, /<nav|<p|eyebrow|description/u);
});

test('detail header returns to an explicit parent route rather than browser history', async () => {
  const html = await render({ title: '售后知识库', backTo: '/admin/knowledge', backLabel: '返回知识库' });
  assert.match(html, /href="\/admin\/knowledge"/u);
  assert.match(html, /返回知识库/u);
  assert.match(html, /aria-label="页面导航"/u);
  assert.match(html, /aria-hidden="true"/u);
  assert.doesNotMatch(source, /router\.back|history\.back/u);
});

test('document navigation supports returning one level and jumping to the root without losing title/actions', async () => {
  const html = await render({ title: '保修政策', backTo: '/admin/knowledge/5/documents', backLabel: '返回文档列表' }, {
    breadcrumb: () => h('a', { href: '/admin/knowledge' }, '知识库'), actions: () => h('button', '重新解析'),
  });
  assert.match(html, /href="\/admin\/knowledge\/5\/documents"/u);
  assert.match(html, /href="\/admin\/knowledge"/u);
  assert.match(html, /<h1>保修政策<\/h1>/u);
  assert.match(html, /重新解析/u);
});
