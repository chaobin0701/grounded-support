import type { SearchHit } from '../../documents/fuse-search-results';
import type { ProductDetail, ProductSummary } from '../tools/product-catalog/product-catalog.service';
import type { ChatAnswer } from '../../chat/chat.service';
import type { ToolExecutionTrace } from '../tools/tool-execution';
import type { SelectedSkill } from '../skills/skill.types';

export type AgentResult = {
  result: ChatAnswer;
  contextSnapshot: Record<string, unknown>;
  rawModelOutput: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  toolCalls: ToolExecutionTrace[];
  toolResults: Array<Record<string, unknown>>;
  sources: SearchHit[];
  products: Array<ProductSummary | ProductDetail>;
  skill: Pick<SelectedSkill['skill'], 'id' | 'version'>;
};
