import type { SearchHit } from '../../documents/fuse-search-results';
import type { ProductDetail, ProductSummary } from '../tools/product-catalog/product-catalog.service';
import type { ToolContext } from '../tools/tool-context';
import type { ToolExecutionTrace } from '../tools/tool-execution';
import type { ToolExecutionState } from '../tools/tool-policy';

export type AgentState = {
  toolContext: ToolContext;
  executionState: ToolExecutionState;
  toolCalls: ToolExecutionTrace[];
  toolResults: Array<Record<string, unknown>>;
  hits: Map<number, SearchHit>;
  products: Map<string, ProductSummary | ProductDetail>;
  contextSnapshot: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageSeen: boolean;
  finalRaw: string;
};
