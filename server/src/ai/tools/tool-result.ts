export interface ToolResult {
  readonly success: boolean;
  readonly content: string;
  readonly data?: unknown;
  readonly errorCode?: string;
  readonly metadata?: Record<string, unknown>;
}
