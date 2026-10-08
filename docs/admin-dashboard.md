# 后台概览统计

`GET /api/admin/dashboard?range=7d`

使用管理员 Bearer Token。需要 `conversations.read`、`documents.read` 或 `knowledge_bases.manage` 中至少一项权限。服务端按当前有效权限返回统计分区：

- `activity`：仅 `conversations.read` 可见。
- `knowledge`：`documents.read` 或 `knowledge_bases.manage` 可见。
- 不可访问的分区返回 `null`，不是零；不返回模型请求、原始输出、密钥或完整调试上下文。

## 时间范围

- `24h`：过去 24 小时，按北京时间小时分桶；首尾可能是部分小时。
- `7d`（默认）、`30d`：包括今天的最近 7 / 30 个北京时间自然日，按天分桶；今天截至查询时刻。
- 响应 `range.since` / `range.until` 是精确边界，采用左闭右开；`timezone` 固定 `Asia/Shanghai`。
- 知识库指标和正在运行/过期请求为当前快照，不受问答日期筛选影响。

## 问答口径

`requestCount` 统计范围内 `chat_traces.kind=answer` 的记录数，不使用前端分页数据，排除摘要轨迹。

- `answeredCount`：执行完成且非拒答。
- `refusedCount`：执行完成且拒答；拒答不是执行失败，也不代表系统给答案打了质量分。
- `failedCount`：回答轨迹执行失败。
- `failedRunCount`：范围内失败的 `conversation_runs`，与失败轨迹是两种记录口径，不可相加。
- `averageDurationMs` / `p95DurationMs`：完成请求的完整执行耗时，含工具和最终生成；不是首字延迟。没有样本时返回 `null`。
- `totalTokens`：已记录的问答轨迹 Token 合计，不含独立摘要轨迹，不估算缺失用量。`tokenRecordedCount` 表示记录覆盖率；有请求但没有 Token 记录时返回 `null`，没有请求时为 `0`。
- `conversationCount` / `visitorCount`：范围内实际发送用户消息的会话和访客去重数。排除空会话。
- `runningCount` / `expiredCount`：当前 `queued` / `running` 请求按到期时间分为正在排队/执行和已超时尚未结束；不是历史超时总数，也不会把已结束的 `expired` 请求算作仍在运行。
- `trend` 补齐无记录的时间桶；`recentFailures` 最多 5 条，包含可关联会话的失败回答轨迹、没有轨迹的失败运行或过期运行，提供会话/轨迹定位 ID，不返回完整上下文。没有关联会话的历史 API 轨迹仍纳入总量，但不生成无法定位的会话入口。

## 资料口径

- 知识库排除已归档项；文件文档排除归档项、归档知识库和 FAQ。
- `documentCount` 是当前文件总量，`processingCount` 包括待解析、排队、处理中和已提取待处理状态。
- `retrievableCount` 需知识库启用、文档启用检索，并存在可检索分段。实时索引要求文档 `ready`；兼容索引仅计算当前启用的 ready 版本，不计算旧版本或父分段。
- `chunkCount` 采用同样的实际检索边界，不能把历史索引分段直接相加。
- 资料可用性根据启用状态与已有索引统计，不额外发起 Embedding 请求或探测外部模型服务是否在线。
- `recentFailures` 最多 5 份未归档失败文档，提供文档与知识库 ID，用于跳转。

第一版没有价格/费用估算、额外模型评审或答案正确性校验。

## 验证

- `server npm test` 包含统计口径、时间范围、权限分区和控制器测试。
- 可设置 `DASHBOARD_TEST_DATABASE_URL` 运行 `server/test/admin-dashboard-postgres.test.mjs`，验证真实 SQL。该测试在独立随机 schema 和单个回滚事务中生成样本，不修改现有业务表。
