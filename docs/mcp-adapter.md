# 内部 MCP Adapter

第八阶段只实现进程内 MCP Plugin，不开放远程 MCP 配置。

```text
ProductCatalogService
  -> ProductCatalog MCP Plugin
  -> MCP Server + InMemoryTransport + MCP Client
  -> McpToolAdapter
  -> ToolRegistry
  -> AgentRunner
```

内置插件 `product_catalog` 暴露三个工具，并使用命名空间注册为：

- `mcp_product_catalog_list_product_categories`
- `mcp_product_catalog_list_products`
- `mcp_product_catalog_get_product_detail`

MCP 结果会转换为项目的 `ToolResult`，仍然经过 `ToolExecutionService`、Skill 白名单、参数校验、超时和调用次数限制。原有产品工具暂时保留，便于对比验证。

本阶段不支持管理员配置、数据库配置、远程 HTTP/stdio、任意命令执行、MCP Resource、Prompt 或 Sampling。
