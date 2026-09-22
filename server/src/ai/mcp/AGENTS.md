# MCP Adapter 目录说明

本目录只负责进程内 MCP Plugin 的注册、发现、调用和协议结果转换。

- MCP Plugin 只能由代码静态注册，不能由访客或管理员提交任意地址。
- `McpClientAdapter` 使用官方 SDK 的进程内 Transport；当前不支持远程 HTTP、stdio、Resource、Prompt 或 Sampling。
- `McpToolAdapter` 把 MCP Tool 转换为现有 `AgentTool`，并把协议结果转换为项目自己的 `ToolResult`。
- MCP Plugin 只能调用已有业务 Service，不直接访问数据库，也不负责 Agent 决策、会话和权限。
- 所有 MCP Tool 仍必须经过 `ToolExecutionService` 和 `ToolPolicy`。
