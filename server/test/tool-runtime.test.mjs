import assert from 'node:assert/strict';
import test from 'node:test';
import { ToolExecutionService } from '../dist/ai/tools/tool-execution.js';
import { ToolPolicy } from '../dist/ai/tools/tool-policy.js';

const context = { permissions: [], state: new Map() };

test('tool execution validates input and records a normalized trace', async () => {
  let executions = 0;
  const tool = {
    name: 'example',
    inputSchema: { safeParse: (input) => input.ok ? { success: true, data: input } : { success: false } },
    execute: async (input) => { executions += 1; return { success: true, content: `ok:${input.value}`, data: input }; },
  };
  const runtime = new ToolExecutionService({ get: () => tool }, new ToolPolicy());
  const state = runtime.createState();
  const invalid = await runtime.execute('example', { ok: false }, context, state);
  assert.equal(invalid.result.errorCode, 'invalid_arguments');
  assert.equal(executions, 0);
  const valid = await runtime.execute('example', { ok: true, value: 'one' }, context, state);
  assert.equal(valid.result.content, 'ok:one');
  assert.equal(valid.trace.ok, true);
  assert.equal(valid.trace.resultChars, 6);
  assert.equal(executions, 1);
});

test('tool execution rejects duplicate calls and truncates model-facing results', async () => {
  const policy = new ToolPolicy();
  policy.maxResultChars = 5;
  const runtime = new ToolExecutionService({ get: () => ({
    name: 'example',
    inputSchema: { safeParse: (input) => ({ success: true, data: input }) },
    execute: async () => ({ success: true, content: '0123456789', data: { retained: true } }),
  }) }, policy);
  const state = runtime.createState();
  const first = await runtime.execute('example', {}, context, state);
  assert.equal(first.result.content, '01234\n[tool_result_truncated]');
  assert.equal(first.result.metadata.resultTruncated, true);
  assert.equal(first.result.data.retained, true);
  const duplicate = await runtime.execute('example', {}, context, state);
  assert.equal(duplicate.result.errorCode, 'duplicate_tool_call');
  assert.equal(duplicate.trace.ok, false);
});

test('tool execution converts timeout and unknown tool failures to safe error codes', async () => {
  const policy = new ToolPolicy();
  policy.timeoutMs = 10;
  const runtime = new ToolExecutionService({ get: (name) => {
    if (name === 'missing') throw new Error('not found');
    return {
      name,
      inputSchema: { safeParse: (input) => ({ success: true, data: input }) },
      execute: () => new Promise(() => {}),
    };
  } }, policy);
  const timeout = await runtime.execute('slow', {}, context, runtime.createState());
  assert.equal(timeout.result.errorCode, 'tool_timeout');
  const unknown = await runtime.execute('missing', {}, context, runtime.createState());
  assert.equal(unknown.result.errorCode, 'unknown_tool');
});

test('tool execution enforces a skill tool allowlist and call limit', async () => {
  const tool = (name) => ({
    name,
    inputSchema: { safeParse: (input) => ({ success: true, data: input }) },
    execute: async () => ({ success: true, content: name }),
  });
  const runtime = new ToolExecutionService({ get: (name) => tool(name) }, new ToolPolicy());
  const state = runtime.createStateForSkill(['allowed'], 1);
  const denied = await runtime.execute('blocked', {}, context, state);
  assert.equal(denied.result.errorCode, 'tool_not_allowed');
  const allowed = await runtime.execute('allowed', {}, context, state);
  assert.equal(allowed.result.success, true);
  const limited = await runtime.execute('allowed-again', {}, context, state);
  assert.equal(limited.result.errorCode, 'tool_not_allowed');
});
