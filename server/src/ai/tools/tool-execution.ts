import { Injectable } from '@nestjs/common';
import { AgentTool } from './agent-tool';
import { ToolContext } from './tool-context';
import { ToolPolicy, ToolExecutionState } from './tool-policy';
import { ToolRegistry } from './tool-registry';
import { ToolResult } from './tool-result';

export type ToolExecutionTrace = {
  name: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  durationMs: number;
  errorCode?: string;
  resultChars?: number;
};

export type ToolExecutionOutcome = {
  result: ToolResult;
  trace: ToolExecutionTrace;
};

@Injectable()
export class ToolExecutionService {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly policy: ToolPolicy,
  ) {}

  get maxToolCalls(): number {
    return this.policy.maxToolCalls;
  }

  plannerHints(): string {
    const registryWithList = this.registry as ToolRegistry & { list?: () => AgentTool[] };
    const tools = typeof registryWithList.list === 'function' ? registryWithList.list() : [];
    return tools
      .filter((tool) => tool.planning)
      .map((tool) => `${tool.name}: ${tool.planning!.canBatch ? '可与当前轮其他独立只读工具一起返回' : '单独返回'}${tool.planning!.dependency ? `；${tool.planning!.dependency}` : ''}`)
      .join('\n');
  }

  canBatch(name: string): boolean {
    try {
      return this.registry.get(name).planning?.canBatch ?? true;
    } catch {
      return true;
    }
  }

  createState(): ToolExecutionState {
    return this.policy.createState();
  }

  createStateForSkill(allowedTools: readonly string[], maxToolCalls: number): ToolExecutionState {
    return this.policy.createState({ allowedTools, maxToolCalls });
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
    state: ToolExecutionState,
  ): Promise<ToolExecutionOutcome> {
    const started = Date.now();
    const baseTrace = (): ToolExecutionTrace => ({ name, arguments: args, ok: false, durationMs: Date.now() - started });
    const policyFailure = this.policy.beforeCall(state, name, args);
    if (policyFailure) {
      return this.failure(policyFailure, baseTrace());
    }

    let tool: AgentTool;
    try {
      tool = this.registry.get(name);
    } catch {
      return this.failure('unknown_tool', baseTrace());
    }

    const validation = this.policy.validateInput(tool, args);
    if (!validation.ok) return this.failure(validation.errorCode, baseTrace());

    try {
      const result = await this.withTimeout(tool.execute(validation.input, context));
      const normalized = this.policy.normalizeResult(result);
      const trace: ToolExecutionTrace = {
        name,
        arguments: args,
        ok: normalized.success,
        durationMs: Date.now() - started,
        ...(normalized.errorCode ? { errorCode: normalized.errorCode } : {}),
        resultChars: normalized.content.length,
      };
      return { result: normalized, trace };
    } catch (error) {
      const errorCode = error instanceof ToolTimeoutError ? 'tool_timeout' : 'tool_execution_failed';
      return this.failure(errorCode, { ...baseTrace(), errorCode });
    }
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(new ToolTimeoutError()), this.policy.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private failure(errorCode: string, trace: ToolExecutionTrace): ToolExecutionOutcome {
    return {
      result: { success: false, content: errorCode, errorCode },
      trace: { ...trace, ok: false, errorCode, durationMs: Math.max(0, trace.durationMs) },
    };
  }
}

class ToolTimeoutError extends Error {
  constructor() {
    super('Tool execution timed out');
    this.name = 'ToolTimeoutError';
  }
}
