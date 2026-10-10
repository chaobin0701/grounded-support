import { Injectable } from '@nestjs/common';
import { AgentTool } from './agent-tool';
import { ToolContext } from './tool-context';
import { ToolPolicy, ToolExecutionState } from './tool-policy';
import { ToolRegistry } from './tool-registry';
import { ToolResult } from './tool-result';
import type { LlmToolDefinition } from '../providers/provider.types';
import type { ContextResource } from '../context/context-contribution';
import { hasToolCapability, type AgentToolCapability } from './tool-capabilities';

export type ToolExecutionTrace = {
  name: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  durationMs: number;
  errorCode?: string;
  resultChars?: number;
  reused?: boolean;
  deferred?: boolean;
};

export type ToolExecutionOutcome = {
  result: ToolResult;
  trace: ToolExecutionTrace;
  contextResources?: ContextResource[];
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

  capabilities() {
    const definitions = this.toolDefinitions();
    const registryWithList = this.registry as ToolRegistry & { list?: () => AgentTool[] };
    const registered = typeof registryWithList.list === 'function' ? registryWithList.list() : [];
    const byName = new Map(registered.map(tool => [tool.name, tool]));
    const hasCapability = (name: string, capability: AgentToolCapability) => {
      const tool = byName.get(name);
      return tool?.capabilities?.includes(capability) || hasToolCapability(name, capability);
    };
    const groups: Array<{ id: string; name: string; description: string; capability: AgentToolCapability; source: string; system: boolean }> = [
      { id: 'knowledge', name: '知识库检索', description: '检索已启用知识库的资料，返回可引用片段。', capability: 'knowledge-search', source: '知识库', system: false },
      { id: 'categories', name: '产品分类', description: '查看当前产品目录分类。', capability: 'product-category', source: '产品数据库', system: false },
      { id: 'products', name: '产品列表', description: '按分类或关键词查询官网共用的产品目录。', capability: 'product-list', source: '产品数据库', system: false },
      { id: 'detail', name: '产品详情', description: '读取准确产品 ID 对应的规格与详细信息。', capability: 'product-detail', source: '产品数据库', system: false },
      { id: 'skills', name: '专项指导读取', description: '模型按需读取可用专项指导，不改变 Agent 权限。', capability: 'skill', source: '静态 Skill 注册表', system: true },
    ];
    return groups.map(({ capability, ...group }) => ({ ...group, names: definitions.filter(tool => hasCapability(tool.name, capability)).map(tool => tool.name), tools: definitions.filter(tool => hasCapability(tool.name, capability)).map(tool => ({
      ...tool, source: tool.name.startsWith('mcp_') ? 'MCP' : '本地', canBatch: this.canBatch(tool.name), dependency: byName.get(tool.name)?.planning?.dependency ?? '',
    })) })).filter(group => group.tools.length);
  }

  plannerHints(allowedTools?: readonly string[]): string {
    const registryWithList = this.registry as ToolRegistry & { list?: () => AgentTool[] };
    const tools = typeof registryWithList.list === 'function' ? registryWithList.list() : [];
    return tools
      .filter((tool) => tool.planning && (!allowedTools || allowedTools.includes(tool.name)))
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

  /** Convert the registered, policy-visible tools to the provider-neutral native tool contract. */
  toolDefinitions(allowedTools?: readonly string[]): LlmToolDefinition[] {
    const allowed = allowedTools ? new Set(allowedTools) : undefined;
    const registryWithList = this.registry as ToolRegistry & { list?: () => AgentTool[] };
    const tools = typeof registryWithList.list === 'function' ? registryWithList.list() : [];
    return tools
      .filter((tool) => !allowed || allowed.has(tool.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: nativeParametersFor(tool),
      }));
  }

  createState(): ToolExecutionState {
    return this.policy.createState();
  }

  createStateForAgent(allowedTools: readonly string[], maxToolCalls: number, limits: { timeoutMs?: number; maxResultChars?: number } = {}): ToolExecutionState {
    return this.policy.createState({ allowedTools, maxToolCalls, ...limits });
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
    state: ToolExecutionState,
  ): Promise<ToolExecutionOutcome> {
    return this.executeWithTool(name, args, context, state);
  }

  /** Close the native call pair explicitly; the model may reissue it after reading fresh guidance. */
  deferUntilReplanning(name: string, args: Record<string, unknown>, state: ToolExecutionState): ToolExecutionOutcome {
    const trace: ToolExecutionTrace = { name, arguments: args, ok: false, durationMs: 0 };
    const failure = this.policy.checkCall(state, name, args);
    if (failure) return this.failure(failure, trace);
    let tool: AgentTool;
    try { tool = this.registry.get(name); }
    catch { return this.failure('unknown_tool', trace); }
    const validation = this.policy.validateInput(tool, args);
    if (!validation.ok) return this.failure(validation.errorCode, trace);
    return this.failure('tool_requires_replanning', { ...trace, deferred: true });
  }

  /** Trusted backend-only batch adapter. Retains the registered capability's permission and budget. */
  async executePreflight(tool: AgentTool, args: Record<string, unknown>, context: ToolContext, state: ToolExecutionState): Promise<ToolExecutionOutcome> {
    return this.executeWithTool(tool.name, args, context, state, tool);
  }

  private async executeWithTool(name: string, args: Record<string, unknown>, context: ToolContext, state: ToolExecutionState, preflightTool?: AgentTool): Promise<ToolExecutionOutcome> {
    const started = Date.now();
    const baseTrace = (): ToolExecutionTrace => ({ name, arguments: args, ok: false, durationMs: Date.now() - started });
    const detail = hasToolCapability(name, 'product-detail');
    // Successful, revision-checked product details only. Never cache errors or arbitrary tools.
    if (detail && (!state.allowedTools || state.allowedTools.has(name))) {
      try {
        const parsed = !preflightTool ? this.registry.get(name).inputSchema.safeParse(args) : { success: false as const };
        const id = parsed.success ? (parsed.data as { productId: string }).productId : undefined;
        const cached = id ? state.productResults?.get(id) : undefined;
        if (cached) return this.outcome(this.registry.get(name), this.policy.normalizeResult(cached, state.maxResultChars), { ...baseTrace(), ok: true, reused: true, resultChars: cached.content.length });
      } catch { /* The normal path safely reports unknown tools. */ }
    }
    const policyFailure = this.policy.beforeCall(state, name, args);
    if (policyFailure) {
      return this.failure(policyFailure, baseTrace());
    }

    let tool: AgentTool;
    try {
      tool = this.registry.get(name);
      if (preflightTool) tool = preflightTool;
    } catch {
      return this.failure('unknown_tool', baseTrace());
    }

    const validation = this.policy.validateInput(tool, args);
    if (!validation.ok) return this.failure(validation.errorCode, baseTrace());

    try {
      const result = await this.withTimeout(tool.execute(validation.input, context), state.timeoutMs ?? this.policy.timeoutMs);
      const normalized = this.policy.normalizeResult(result, state.maxResultChars);
      if (detail && normalized.success && !preflightTool) state.productResults?.set((validation.input as { productId: string }).productId, normalized);
      const trace: ToolExecutionTrace = {
        name,
        arguments: args,
        ok: normalized.success,
        durationMs: Date.now() - started,
        ...(normalized.errorCode ? { errorCode: normalized.errorCode } : {}),
        resultChars: normalized.content.length,
      };
      return this.outcome(tool, normalized, trace);
    } catch (error) {
      const errorCode = error instanceof ToolTimeoutError ? 'tool_timeout' : 'tool_execution_failed';
      return this.failure(errorCode, { ...baseTrace(), errorCode });
    }
  }

  private outcome(tool: AgentTool, result: ToolResult, trace: ToolExecutionTrace): ToolExecutionOutcome {
    // Projection failures cannot change a successfully executed business operation.
    try { return { result, trace, ...(result.success && tool.contributeContext ? { contextResources: tool.contributeContext(result) } : {}) }; }
    catch { return { result, trace }; }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(new ToolTimeoutError()), timeoutMs);
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

function nativeParametersFor(tool: AgentTool): Record<string, unknown> {
  const capabilities = new Set(tool.capabilities ?? []);
  // The registry is the source of the business capability. The fallback map in
  // hasToolCapability only exists for older adapters that have not yet declared
  // metadata; product aliases therefore do not leak into this schema mapping.
  if (capabilities.has('skill') || hasToolCapability(tool.name, 'skill')) {
    return { type: 'object', properties: { skillId: { type: 'string', description: '可用 Skill 摘要中的准确 ID' } }, required: ['skillId'], additionalProperties: false };
  }
  if (capabilities.has('knowledge-search') || hasToolCapability(tool.name, 'knowledge-search')) {
    return {
      type: 'object',
      properties: { query: { type: 'string', description: '要检索的资料问题' }, topK: { type: 'integer', minimum: 1, maximum: 8 } },
      required: ['query'],
      additionalProperties: false,
    };
  }
  if (capabilities.has('product-list') || hasToolCapability(tool.name, 'product-list')) {
    return { type: 'object', properties: { categoryId: { type: 'string' }, search: { type: 'string' } }, additionalProperties: false };
  }
  if (capabilities.has('product-detail') || hasToolCapability(tool.name, 'product-detail')) {
    return { type: 'object', properties: { productId: { type: 'string' } }, required: ['productId'], additionalProperties: false };
  }
  if (capabilities.has('product-category') || hasToolCapability(tool.name, 'product-category')) {
    return { type: 'object', properties: {}, additionalProperties: false };
  }
  return { type: 'object', additionalProperties: true };
}

class ToolTimeoutError extends Error {
  constructor() {
    super('Tool execution timed out');
    this.name = 'ToolTimeoutError';
  }
}
