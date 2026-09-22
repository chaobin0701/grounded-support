# 第九阶段：离线评测系统

当前评测使用固定 Mock LLM 和工具结果，运行完整的 `AgentRunner`、`AgentLoop`、`ToolExecutionService`，但不调用远程模型、不访问数据库。它用于验证 Agent 行为基线，而不是评估某个模型的语言质量。

## 运行

```bash
cd server
npm run eval:agent
npm run eval:agent -- --case returns-basic
```

输出是 JSON，包含每个案例的通过状态、拒答状态、工具调用名称、重复次数、Token 消耗、耗时和 Skill。评测失败时进程返回非零状态。

## 当前指标

- 资料命中和内容特征；
- 引用是否存在；
- 无资料时是否拒答；
- 重复工具调用；
- 工具调用次数上限；
- 输入、输出和总 Token；
- 单案例耗时；
- MCP 产品工具是否仍能作为 AgentTool 执行；
- 会话评测用独立运行状态检查证据不泄漏。

评测数据在 `samples/eval/expected.json`，可读问题列表在 `samples/eval/questions.md`。数据库重建后不应依赖自增 chunk ID；案例优先使用文件名和内容特征。真实模型评测、基线趋势比较和在线监控留到后续阶段。
