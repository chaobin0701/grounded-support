import { Injectable } from '@nestjs/common';
import { ProductCatalogService, type ProductDetail } from '../ai/tools/product-catalog/product-catalog.service';
import { ToolExecutionService, type ToolExecutionOutcome } from '../ai/tools/tool-execution';
import type { ToolContext } from '../ai/tools/tool-context';
import type { ToolExecutionState } from '../ai/tools/tool-policy';
import type { AgentConfiguration } from '../config/agent-config';
import type { SearchHit } from '../documents/fuse-search-results';
import type { PublicProgressEvent } from './chat.service';
import { isProductDetail } from './product-context';
import { z } from 'zod';
import type { AgentTool } from '../ai/tools/agent-tool';
import { productResources } from '../ai/context/context-contribution';
import { hasToolCapability } from '../ai/tools/tool-capabilities';

export type ProductPreparation = {
  requestedIds: string[];
  products: ProductDetail[];
  evidence: SearchHit[];
  entries: Array<{ name: string; arguments: Record<string, unknown>; outcome: ToolExecutionOutcome }>;
  executionState: ToolExecutionState;
  toolContext: ToolContext;
};

@Injectable()
export class ProductContextPreparer {
  constructor(private readonly catalog: ProductCatalogService, private readonly tools: ToolExecutionService) {}

  async prepare(question: string, ids: string[], prior: unknown[], configuration: AgentConfiguration, emit?: (event: PublicProgressEvent) => void, scope: { conversationId?: string; traceId?: string } = {}): Promise<ProductPreparation> {
    const runtime = configuration.runtime;
    const executionState = this.tools.createStateForAgent(runtime.allowedTools, runtime.maxToolCalls, { timeoutMs: runtime.toolTimeoutMs, maxResultChars: runtime.maxToolResultChars });
    const toolContext: ToolContext = { sessionId: scope.conversationId, traceId: scope.traceId, permissions: runtime.allowedTools, enabledSkillIds: configuration.enabledSkills, state: new Map() };
    const prepared: ProductPreparation = { requestedIds: ids, products: [], evidence: [], entries: [], executionState, toolContext };
    const detailName = runtime.allowedTools.find(name => hasToolCapability(name, 'product-detail')) ?? 'get_product_detail';
    const allowed = runtime.allowedTools.includes(detailName);
    let revisions = new Map<string, string>();
    if (allowed) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        revisions = await Promise.race([
          this.catalog.revisions(ids),
          new Promise<Map<string, string>>((_, reject) => { timer = setTimeout(() => reject(new Error('revision_check_timeout')), Math.min(runtime.toolTimeoutMs, 3000)); }),
        ]);
      } catch { /* No reuse unless validity can be established. */ }
      finally { if (timer) clearTimeout(timer); }
    }
    // Snapshot rows are newest first; do not let an older version replace a newer one.
    for (const product of prior) {
      if (allowed && isProductDetail(product) && product.revision && product.revision === revisions.get(product.id) && !executionState.productResults?.has(product.id)) {
        executionState.productResults?.set(product.id, { success: true, content: JSON.stringify(product), data: product });
      }
    }
    const execute = async (name: string, args: Record<string, unknown>, label: string, batch?: AgentTool) => {
      const operationId = `preload-${prepared.entries.length + 1}-${Date.now()}`;
      emit?.({ type: 'progress', id: `${operationId}-start`, operationId, stage: 'tool', status: 'running', text: label, tool: name });
      const outcome = batch ? await this.tools.executePreflight(batch, args, toolContext, executionState) : await this.tools.execute(name, args, toolContext, executionState);
      prepared.entries.push({ name, arguments: args, outcome });
      emit?.({ type: 'progress', id: `${operationId}-done`, operationId, stage: 'tool', status: 'completed', text: outcome.trace.reused ? '已复用产品资料' : outcome.result.success ? label.replace('正在', '已') : '暂未取得这部分资料，将继续处理问题', tool: name, durationMs: outcome.trace.durationMs });
      return outcome;
    };
    const missing = ids.filter(id => !executionState.productResults?.has(id));
    if (missing.length > 1 && allowed) {
      // One bounded SQL read is one execution, not five requests hidden from the budget.
      const batch: AgentTool = {
        name: detailName, description: '后端产品上下文批量预加载，不向模型暴露新的工具协议',
        contributeContext: productResources,
        inputSchema: z.object({ productIds: z.array(z.string().min(1).max(80)).min(1).max(5) }),
        execute: async args => {
          const ids = (args as { productIds: string[] }).productIds;
          const products = await this.catalog.getProductDetails(ids);
          const data = { products, missingProductIds: ids.filter(id => !products.some(p => p.id === id)) };
          return { success: products.length > 0, content: JSON.stringify(data), data, ...(products.length ? {} : { errorCode: 'product_not_found' }) };
        },
      };
      const outcome = await execute(detailName, { productIds: missing }, '正在准备产品详情', batch);
      const data = outcome.result.data as { products?: ProductDetail[] } | undefined;
      if (outcome.result.success) for (const product of data?.products ?? []) {
        prepared.products.push(product);
        executionState.productResults?.set(product.id, { success: true, content: JSON.stringify(product), data: product });
      }
    }
    for (const id of ids.filter(id => !missing.includes(id) || missing.length <= 1 || !allowed)) {
      const outcome = await execute(detailName, { productId: id }, '正在准备产品详情');
      if (outcome.result.success && isProductDetail(outcome.result.data)) prepared.products.push(outcome.result.data);
    }
    prepared.products.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    // Search belongs to the current question, not merely the product; never reuse another question's search.
    const names = prepared.products.map(p => p.name).join('、').slice(0, 100);
    const query = `${names} ${question.slice(0, 100)}`.trim().slice(0, 200);
    if (query.length >= 2) {
      const searched = await execute('search_knowledge', { query, topK: 5 }, '正在检索相关产品资料');
      const data = searched.result.data as { hits?: SearchHit[] } | undefined;
      if (searched.result.success && Array.isArray(data?.hits)) prepared.evidence = data.hits;
    }
    return prepared;
  }
}
