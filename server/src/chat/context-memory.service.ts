import { Injectable, Optional } from '@nestjs/common';
import { ProductCatalogService } from '../ai/tools/product-catalog/product-catalog.service';
import { SearchService } from '../documents/search.service';
import type { AgentConfiguration } from '../config/agent-config';
import { readContextBlocks, canUseContextSource, evidenceDigest, type ContextResource, type RestoredContext } from '../ai/context/context-contribution';
import { ContextGovernor } from './context-governor';
import { hasToolCapability } from '../ai/tools/tool-capabilities';

@Injectable()
export class ContextMemoryService {
  constructor(private readonly catalog: ProductCatalogService, private readonly search: SearchService,
    @Optional() private readonly governor?: ContextGovernor) {}

  async restore(conversationId: string, blocks: unknown, configuration: AgentConfiguration): Promise<RestoredContext> {
    const flags = configuration.memory.toolResults;
    const allowed = new Set(configuration.runtime.allowedTools);
    const unique = new Map<string, ContextResource>();
    const permittedKeys = new Set<string>();
    // Caller supplies newest traces first. Never let an older resource replace a newer one.
    for (const block of readContextBlocks(blocks, conversationId)) {
      for (const resource of block.resources) {
        // An older trace may lack index metadata; it still represents the same chunk.
        const identity = resource.kind === 'product' ? `product:${resource.data.id}` : `knowledge:${resource.data.documentId}:${resource.data.chunkId}`;
        if (unique.has(identity)) continue;
        unique.set(identity, resource);
        if (canUseContextSource(block.source, configuration.runtime.allowedTools)) permittedKeys.add(resource.key);
      }
    }
    const candidates = [...unique.values()].slice(0, 44);
    const historyProductIds = candidates.filter(r => r.kind === 'product').map(r => r.data.id);
    const result: RestoredContext = { resources: [], products: [], evidence: [], historyProductIds,
      diagnostics: { enabled: flags.enabled, candidates: candidates.length, restored: 0, omitted: candidates.length } };
    if (!flags.enabled) return result;
    const products = candidates.filter((r): r is Extract<ContextResource, { kind: 'product' }> => r.kind === 'product').slice(0, 20);
    const knowledge = candidates.filter((r): r is Extract<ContextResource, { kind: 'knowledge' }> => r.kind === 'knowledge').slice(0, 24);
    let revisions = new Map<string, string>();
    let evidence: typeof result.evidence = [];
    const bounded = async <T>(operation: Promise<T>, fallback: T): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { return await Promise.race([operation, new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), Math.min(configuration.runtime.toolTimeoutMs, 3000)); })]); }
      catch { return fallback; }
      finally { if (timer) clearTimeout(timer); }
    };
    await Promise.all([
      flags.products && products.length && [...allowed].some(name => hasToolCapability(name, 'product-detail'))
        ? bounded(this.catalog.revisions(products.map(r => r.data.id)), revisions).then(value => { revisions = value; }) : undefined,
      flags.knowledge && knowledge.length && allowed.has('search_knowledge')
        ? bounded(this.search.restoreEvidence(knowledge.map(r => r.data)), evidence).then(value => { evidence = value; }) : undefined,
    ]);
    const inputTokens = this.governor?.inspect({ systemPrompt: '', userPrompt: '', purpose: 'planner' }).inputBudgetTokens;
    const budget = Math.min(24000, configuration.runtime.maxToolResultChars * 2, inputTokens === undefined ? 24000 : Math.floor(inputTokens * 2 * 0.35));
    let used = 0;
    for (const resource of candidates) {
      if (!permittedKeys.has(resource.key)) continue;
      const valid = resource.kind === 'product'
        ? flags.products && !!resource.data.revision && revisions.get(resource.data.id) === resource.data.revision
        : flags.knowledge && evidence.some(hit => hit.chunkId === resource.data.chunkId && hit.documentId === resource.data.documentId && evidenceDigest(hit) === resource.digest);
      if (!valid) continue;
      const size = JSON.stringify(resource).length;
      if (used + size > budget) continue;
      result.resources.push(resource); used += size;
      if (resource.kind === 'product') result.products.push(resource.data);
      else result.evidence.push(resource.data);
    }
    result.diagnostics.restored = result.resources.length;
    result.diagnostics.omitted = candidates.length - result.resources.length;
    return result;
  }
}
