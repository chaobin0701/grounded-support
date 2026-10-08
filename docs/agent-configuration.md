# Agent 配置与能力管理

后台：`/admin/agent-config`，管理接口：`GET /api/admin/agent-config` 和 `PATCH /api/admin/agent-config`。

查看需要管理员 Bearer Token 和 `agent_config.read` 或 `agent_config.manage`；保存仅允许 `agent_config.manage`，默认只授予超级管理员。只读账号可查看但不能保存。接口不返回模型密钥或完整环境变量。

## 配置来源

`agent_settings` 单例数据库记录是生效配置的唯一来源。`server/config/agent.json`（或 `AGENT_CONFIG_PATH`）仅在首次初始化时提供默认值；后续重启不会覆盖管理员保存的配置。非法配置直接报错，不静默回退。

保存同时提交 `revision`、`configurationVersion` 和 `settings`。版本不匹配返回 409，不覆盖本地草稿；字段或关联约束错误返回 400。配置更新和字段差异在同一事务写入审计日志 `agent_config.updated`。每个请求捕获不可变快照，记忆读取、规划、工具执行、最终回答和异步摘要使用同一版本；轨迹保存版本及指纹。保存立即用于后续请求，不需要重启。

## 页面与可配置范围

- 基本与回答：名称、角色、人设、基础业务规则、语气与详细程度。
- 会话与记忆：欢迎语、推荐问题、近期问答轮数、摘要触发与保留轮数、摘要长度及高级读取窗口。推荐问题实时预览。
- Skills：启停已注册专项指导；元信息和详细指导只读。不预选默认 Skill，也不添加关键词分类。
- 工具能力：知识库检索、产品分类、列表、详情统一启停；同功能本地和 MCP 别名必须同时启停。停用会限制实际执行，不只是隐藏入口。
- 高级设置：规划轮数、工具次数、工具超时和结果长度。输出协议、格式校验、参数 Schema、执行顺序及内部 utils 只读。

没有启用任何 Skill 时，运行快照会自动移除 `load_skill`；基础问答仍正常工作。启停仅影响新请求可加载的指导，不删除历史消息或工具记忆。模型参数仍在模型服务配置，知识库处理参数仍由知识库管理。

页面提供未保存提示、撤销、离开确认、字段校验及保存反馈；长指导和原始规则默认折叠。

基础问答与产品咨询直接来自 `identity.persona` 和 `answeringInstructions`，不包装成默认 Skill，不通过关键词分类。模型 ID、上下文窗口和输出上限取当前模型服务，不复制到 Agent 配置。输出协议和参数校验由代码维护。

## 默认提示词与专项指导

后台展示实际生效的默认提示词、基础回答规则，以及由运行时同一构建函数生成的完整提示词预览。每轮默认提示词包含可用 Skill 摘要；模型通过 `load_skill` 按需读取详细流程。产品查询本身不要求先加载 Skill。

当前专项指导为产品咨询和售后政策；它们不包含权限、回答模式或检索开关，不会改变 Agent 默认行为边界。详细说明见 [Skills](skills.md)。

## 独立运行配置

- `runtime.allowedTools`：当前 Agent 可调用的注册工具，包含 `load_skill`。
- `runtime.maxToolCalls`：每次请求最大工具次数，默认 5。
- `runtime.maxPlannerRounds`：每次请求最大模型规划轮数，默认 6，必须大于工具次数上限，以保留最终回答机会。
- `runtime.toolTimeoutMs`：单次工具超时，默认 30000 毫秒。
- `runtime.maxToolResultChars`：单次工具文本结果上限，默认 12000 字符。

工具调用按顺序执行，Skill 加载也计入工具次数；权限、重复调用保护和预算不会因 Skill 指导变化。答案仍只做基础格式校验，不增加正确性或“本轮必须重新取证”的拒答限制。

## 记忆语义

- `recentTurns`：上下文构建器使用的最近有效问答轮数，默认 3。
- `snapshotTurns`：读取近期会话消息的窗口，默认 6，必须不小于 `recentTurns`。
- `summaryTriggerTurns`：尚未总结的消息达到多少轮后触发摘要，默认 6（一轮按用户和助手两条消息计）。
- `summaryKeepRecentTurns`：摘要保留最近多少轮原文，默认 2，必须小于触发阈值。
- `summaryMaxChars`：摘要存储和读取的字符上限，默认 1500。
- `summaryBatchMaxMessages`：单次摘要读取未总结消息的最大条数，默认 100。
- `transcriptMaxMessages` / `transcriptMaxTraces`：读取工具链记忆的消息和轨迹上限，默认 120 / 50。

摘要异步执行，不阻塞已经保存的回答。不是“每隔 6 轮重新清空上下文”，也不删除完整会话消息和轨迹。近期问答过滤拒答回复，工具 transcript 单独保留，现有格式校验和工具调度机制不变。

## 首轮对话

`GET /api/chat/presentation` 只返回 `welcome` 中的标题、说明和推荐问题。共享 ChatWorkspace 的完整助手和官网机器人均通过此接口获取配置。不会为获取欢迎语创建访客或空会话，不暴露人设、摘要指令、工具权限等内部策略。

## 验证

`server npm test`、`web npm test`、`web npm run build`。验证真实接口保存、冲突、非法配置、欢迎语立即生效及审计；浏览器验证编辑/只读权限、字段校验、冲突保留草稿与移动端布局。
