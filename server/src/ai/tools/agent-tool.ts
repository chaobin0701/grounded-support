import { z } from 'zod';
import { ToolContext } from './tool-context';
import { ToolResult } from './tool-result';
import type { ContextProjector } from '../context/context-contribution';

export type AgentToolPlanning = {
  /** Independent reads can share a response. A successful false tool requires replanning before subsequent calls. */
  readonly canBatch: boolean;
  /** Human-readable dependency hint for the planner; execution still validates inputs. */
  readonly dependency?: string;
};

/** A business capability that an agent may execute by name. */
export interface AgentTool<TInput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodTypeAny;
  readonly planning?: AgentToolPlanning;
  /** Trusted opt-in projection of safe result fields into persistent model context. */
  readonly contributeContext?: ContextProjector;

  execute(input: TInput, context: ToolContext): Promise<ToolResult>;
}
