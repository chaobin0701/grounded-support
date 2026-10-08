import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/ConversationTraceAdmin.vue', import.meta.url), 'utf8');
test('conversation records retain a keyboard-accessible scroller independent of title, filters and pagination', () => {
  assert.match(source, /ref="listScroller"[^>]*role="region"[^>]*aria-label="会话记录"[^>]*tabindex="0"/);
  const scrollRules = source.match(/\.session-list\s*\{([^}]+)\}/)[1];
  assert.match(scrollRules, /min-height:\s*0/);
  assert.match(scrollRules, /overflow:\s*auto/);
  assert.match(scrollRules, /isolation:\s*isolate/);
});
test('native table headers are sticky above row actions, while mobile still uses cards', () => {
  const headerRules = source.match(/\.session-table th\s*\{([^}]+)\}/)[1];
  assert.match(headerRules, /position:\s*sticky/);
  assert.match(headerRules, /top:\s*0/);
  assert.match(headerRules, /z-index:\s*2/);
  assert.match(headerRules, /background:\s*var\(--canvas\)/);
  assert.match(source, /border-collapse:\s*separate;\s*border-spacing:\s*0/);
  assert.match(source, /\.session-table thead\s*\{\s*display:\s*none/);
});
