import { z } from 'zod';
import { ToolContext } from './tool-context';
import { ToolResult } from './tool-result';

/** A business capability that an agent may execute by name. */
export interface AgentTool<TInput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodTypeAny;

  execute(input: TInput, context: ToolContext): Promise<ToolResult>;
}
