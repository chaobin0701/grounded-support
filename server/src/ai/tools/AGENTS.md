# AI Tools 目录说明

这里存放 Agent 可以调用的本地业务工具，以及统一的 `ToolRegistry`。

## 文件职责

- `agent-tool.ts`：定义工具的名称、描述、输入校验和执行接口。
- `tool-context.ts`：定义一次 Agent 运行传给工具的上下文与临时状态。
- `tool-result.ts`：统一工具成功、失败、数据和错误码的返回结构。
- `tool-errors.ts`：处理重复注册和未知工具等 Registry 错误。
- `tool-registry.ts`：注册、查找和列出工具；不负责模型调用或 Agent 决策。
- `tools.module.ts`：注册当前应用内置工具。
- `knowledge-search.tool.ts`：把知识库检索封装为 `search_knowledge` 工具。
- `product-catalog/`：包含虚构产品目录数据、查询服务和三个只读产品工具。

## 设计边界

工具只执行能力并返回结构化结果，不生成最终客服答案，也不绕过回答引用校验。模型调用由 Provider 负责，调用循环由 `ChatOrchestratorService` 负责。

当前暂不引入 MCP。未来接入 MCP 时，应增加实现 `AgentTool` 的适配器，不要把 MCP 协议细节泄漏到业务工具或 Orchestrator 中。
