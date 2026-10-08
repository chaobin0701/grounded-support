# 默认能力与按需 Skills

基础问答、上下文复用和基础产品咨询属于 Agent 默认提示词，不是 Skill。没有默认 `question_answering`、关键词路由或强制的闲聊分类。

## 运行流程

```text
默认提示词 + 会话上下文 + 可用 Skill 摘要
  → 模型直接回答 / 调用业务工具 / 按需 load_skill
  → 工具结果与已加载指导进入下一轮上下文
  → 最终回答（仅基础格式校验）
```

普通产品问题可以直接使用 `list_products` 和 `get_product_detail`。需要更详细的选型、比较或售后流程时，模型才读取专项说明；不要求每个请求都加载 Skill。

## 注册的专项指导

- `product_consultation@2.0.0`：需求澄清、选型、比较和详细产品咨询。
- `customer_support@2.0.0`：售后政策、资料定位和不能办理事项的说明。

首次规划只提供 ID、名称、版本和摘要，不注入所有详细规则。`load_skill({"skillId":"product_consultation"})` 读取注册的静态说明，下一轮默认提示词中增加这份指导。未知 ID 或文件路径不能读取；工具错误交回模型作下一步判断。

Skill 只有元信息和说明文本，不包含回答模式、工具权限、检索开关或预算。不会切换 Agent，不自行执行工具，也不调用其他 Skill。

## 独立运行限制

数据库 Agent 配置的 `runtime` 独立维护工具白名单、最大工具次数、最大规划轮数、工具超时和结果长度；JSON 仅提供初始化默认值。`ToolPolicy` 负责执行权限、重复调用保护、参数校验、超时和结果截断，每轮使用固定配置快照。

默认每次请求最多 5 次工具调用、6 轮规划，为最终回复留一轮。`load_skill` 也计入预算；加载指导不能扩大权限或绕过预算。同一批次工具按顺序执行；`load_skill` 单独读取，下一轮再决定后续动作。

## 上下文与安全

运行轨迹保存可用 Skill 摘要、已加载 Skill ID/版本、加载工具参数、模型请求和完整指导，供授权调试接口复盘。普通 `conversations.read` 轨迹详情隐藏系统提示词、完整模型请求、原始输出和加载工具中的完整指导；公共 SSE 只显示安全的过程标签。

后台 `/admin/agent-config` 使用 `agent_config.read` 展示配置，`agent_config.manage` 可修改行为、记忆和能力启停。Skill 文本保持只读；模型只收到启用指导的摘要，`load_skill` 同样执行启停检查。完整逐轮模型请求继续使用 `conversations.debug` 调试权限查询。

新增 Skill 时定义 `SkillDefinition`，在 `SkillsModule` 静态注册，并添加加载/权限边界测试。不要复制 Tool Runtime 或 Agent Loop，不提供任意文件读取、远程下载或动态脚本执行。
