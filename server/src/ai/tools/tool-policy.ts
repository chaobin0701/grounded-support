import { z } from 'zod';
import { AgentTool } from './agent-tool';
import { ToolResult } from './tool-result';

export const DEFAULT_MAX_TOOL_CALLS = 6;
export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RESULT_CHARS = 12_000;

export type ToolExecutionState = {
  callCount: number;
  seenCalls: Set<string>;
};

export type ToolPolicyFailure = 'tool_call_limit_exceeded' | 'duplicate_tool_call' | 'invalid_arguments';

export type ToolInputValidation =
  | { ok: true; input: unknown }
  | { ok: false; errorCode: ToolPolicyFailure };

export class ToolPolicy {
  readonly maxToolCalls = DEFAULT_MAX_TOOL_CALLS;
  readonly timeoutMs = DEFAULT_TOOL_TIMEOUT_MS;
  readonly maxResultChars = DEFAULT_MAX_RESULT_CHARS;

  createState(): ToolExecutionState {
    return { callCount: 0, seenCalls: new Set<string>() };
  }

  beforeCall(state: ToolExecutionState, name: string, args: Record<string, unknown>): ToolPolicyFailure | null {
    if (state.callCount >= this.maxToolCalls) return 'tool_call_limit_exceeded';
    const key = JSON.stringify({ name, arguments: args });
    if (state.seenCalls.has(key)) return 'duplicate_tool_call';
    state.seenCalls.add(key);
    state.callCount += 1;
    return null;
  }

  validateInput(tool: AgentTool, args: Record<string, unknown>): ToolInputValidation {
    const parsed = tool.inputSchema.safeParse(args);
    return parsed.success ? { ok: true, input: parsed.data } : { ok: false, errorCode: 'invalid_arguments' };
  }

  normalizeResult(result: ToolResult): ToolResult {
    if (result.content.length <= this.maxResultChars) return result;
    return {
      ...result,
      content: `${result.content.slice(0, this.maxResultChars)}\n[tool_result_truncated]`,
      metadata: { ...result.metadata, resultTruncated: true },
    };
  }
}
