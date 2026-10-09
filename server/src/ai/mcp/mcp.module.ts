import { Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ToolsModule } from '../tools/tools.module';
import { ToolRegistry } from '../tools/tool-registry';
import { ProductCatalogService } from '../tools/product-catalog/product-catalog.service';
import { McpPluginRegistry } from './mcp-plugin-registry';
import { adaptMcpTool } from './mcp-tool.adapter';
import { createProductCatalogPlugin } from './built-in/product-catalog.plugin';
import { InMemoryMessageBus } from '../../message-bus/in-memory-message-bus';
import { randomUUID } from 'node:crypto';

@Module({
  imports: [ToolsModule],
  providers: [McpPluginRegistry],
  exports: [McpPluginRegistry],
})
export class McpModule implements OnModuleInit, OnApplicationShutdown {
  constructor(
    private readonly plugins: McpPluginRegistry,
    private readonly registry: ToolRegistry,
    private readonly catalog: ProductCatalogService,
    private readonly messageBus: InMemoryMessageBus,
  ) {}

  async onModuleInit(): Promise<void> {
    const plugin = createProductCatalogPlugin(this.catalog);
    this.plugins.register(plugin);
    const client = await this.plugins.start('product_catalog');
    if (!client) return;
    const discovered = await client.listTools();
    for (const tool of discovered.tools) this.registry.register(adaptMcpTool('product_catalog', client, tool, (event, context) => {
      this.messageBus.publishEvent({
        eventId: randomUUID(),
        channel: 'api',
        conversationId: context.sessionId ?? 'unknown',
        messageId: 'unknown',
        runId: context.traceId ?? 'unknown',
        occurredAt: new Date().toISOString(),
        visibility: 'internal',
        type: `mcp.tool.${event.type}` as 'mcp.tool.started' | 'mcp.tool.completed' | 'mcp.tool.failed',
        pluginId: event.pluginId,
        toolName: event.toolName,
        ...(event.errorCode ? { errorCode: event.errorCode } : {}),
      });
    }, plugin.toolPlanning?.[tool.name], plugin.toolContextProjectors?.[tool.name]));
  }

  async onApplicationShutdown(): Promise<void> { await this.plugins.stopAll(); }
}
