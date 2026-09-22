import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export type McpPluginDefinition = {
  readonly id: string;
  readonly version: string;
  readonly enabled: boolean;
  readonly createServer: () => McpServer;
};
