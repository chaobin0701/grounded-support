# AI Tools 目录说明

这里存放 Agent 可以调用的本地业务工具，以及统一的 `ToolRegistry`。

## 文件职责

- `agent-tool.ts`：定义工具的名称、描述、输入校验和执行接口。
- `tool-context.ts`：定义一次 Agent 运行传给工具的上下文与临时状态。
- `tool-result.ts`：统一工具成功、失败、数据和错误码的返回结构。
- `tool-errors.ts`：处理重复注册和未知工具等 Registry 错误。
- `tool-registry.ts`：注册、查找和列出工具；不负责模型调用或 Agent 决策。
- `tool-policy.ts`：定义单轮调用次数、重复调用、输入校验、超时和结果大小等执行策略。
- `tool-execution.ts`：提供统一工具执行入口，负责调用 Registry、执行策略、异常转换和执行轨迹。
- `tools.module.ts`：注册当前应用内置工具。
- `knowledge-search.tool.ts`：把知识库检索封装为 `search_knowledge` 工具。
- `product-catalog/`：包含虚构产品目录数据、查询服务和三个只读产品工具。

## 设计边界

工具只执行能力并返回结构化结果，不生成最终客服答案，也不绕过回答引用校验。模型调用由 Provider 负责，调用循环由 `ChatOrchestratorService` 负责；工具执行的通用限制由 Tool Runtime 负责。

MCP 适配器位于 `../mcp/`，只将静态、进程内插件转换为 `AgentTool`；业务工具和 Orchestrator 不应依赖 MCP 协议细节。
