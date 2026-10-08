import { Injectable } from '@nestjs/common';
import { AgentTool } from './agent-tool';
import { ToolContext } from './tool-context';
import { ToolPolicy, ToolExecutionState } from './tool-policy';
import { ToolRegistry } from './tool-registry';
import { ToolResult } from './tool-result';
import type { LlmToolDefinition } from '../providers/provider.types';

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

  capabilities() {
    const definitions = this.toolDefinitions();
    const groups = [
      { id: 'knowledge', name: '知识库检索', description: '检索已启用知识库的资料，返回可引用片段。', names: ['search_knowledge'], source: '知识库', system: false },
      { id: 'categories', name: '产品分类', description: '查看当前产品目录分类。', names: ['list_product_categories', 'mcp_product_catalog_list_product_categories'], source: '产品数据库', system: false },
      { id: 'products', name: '产品列表', description: '按分类或关键词查询官网共用的产品目录。', names: ['list_products', 'mcp_product_catalog_list_products'], source: '产品数据库', system: false },
      { id: 'detail', name: '产品详情', description: '读取准确产品 ID 对应的规格与详细信息。', names: ['get_product_detail', 'mcp_product_catalog_get_product_detail'], source: '产品数据库', system: false },
      { id: 'skills', name: '专项指导读取', description: '模型按需读取可用专项指导，不改变 Agent 权限。', names: ['load_skill'], source: '静态 Skill 注册表', system: true },
    ];
    return groups.map(({ names, ...group }) => ({ ...group, tools: definitions.filter(tool => names.includes(tool.name)).map(tool => ({
      ...tool, source: tool.name.startsWith('mcp_') ? 'MCP' : '本地', canBatch: this.canBatch(tool.name), dependency: this.registry.get(tool.name).planning?.dependency ?? '',
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
        parameters: nativeParametersFor(tool.name),
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
      const result = await this.withTimeout(tool.execute(validation.input, context), state.timeoutMs ?? this.policy.timeoutMs);
      const normalized = this.policy.normalizeResult(result, state.maxResultChars);
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

function nativeParametersFor(name: string): Record<string, unknown> {
  switch (name) {
    case 'load_skill':
      return { type: 'object', properties: { skillId: { type: 'string', description: '可用 Skill 摘要中的准确 ID' } }, required: ['skillId'], additionalProperties: false };
    case 'search_knowledge':
      return {
        type: 'object',
        properties: { query: { type: 'string', description: '要检索的资料问题' }, topK: { type: 'integer', minimum: 1, maximum: 8 } },
        required: ['query'],
        additionalProperties: false,
      };
    case 'list_products':
    case 'mcp_product_catalog_list_products':
      return {
        type: 'object',
        properties: { categoryId: { type: 'string' }, search: { type: 'string' } },
        additionalProperties: false,
      };
    case 'get_product_detail':
    case 'mcp_product_catalog_get_product_detail':
      return { type: 'object', properties: { productId: { type: 'string' } }, required: ['productId'], additionalProperties: false };
    case 'list_product_categories':
    case 'mcp_product_catalog_list_product_categories':
      return { type: 'object', properties: {}, additionalProperties: false };
    default:
      return { type: 'object', additionalProperties: true };
  }
}

class ToolTimeoutError extends Error {
  constructor() {
    super('Tool execution timed out');
    this.name = 'ToolTimeoutError';
  }
}
