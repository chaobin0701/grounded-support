# grounded-support

一个用于学习知识库检索与有据回答的虚构小家电客服项目。

## 当前阶段

目前有可运行的 Vue 访客问答页、NestJS API、独立 Worker、PostgreSQL + pgvector、管理员权限管理，以及 Markdown、DOCX、文字版 PDF 上传、异步切片和管理员检索诊断。回答模型通过 OpenAI-compatible HTTP 接口调用；同一浏览器可创建多段独立会话，管理员可查看受权限保护的回答轨迹。

## 目录

- `web/`：Vue 访客问答页与管理员资料/权限后台
- `server/`：NestJS API 与同一代码库中的 Worker
- `infra/`：数据库初始化脚本
- `samples/`：后续放入虚构政策与验收问题

## 本地服务边界

| 服务 | 启动内容 | 当前职责 |
| --- | --- | --- |
| `web` | Nginx 托管 Vue 构建结果 | 展示页面，并将 `/api/` 转发给 API |
| `migrate` | `npm run db:migrate` | 启动 API 前运行数据库迁移；成功后退出 |
| `api` | `node dist/main.js` | 健康检查、管理员权限与资料 API |
| `worker` | `node dist/worker.js` | 消费 `document-ingest` 任务，提取资料正文并生成片段 |
| `postgres` | PostgreSQL + pgvector | 保存应用数据和任务，启用 `vector` 扩展 |

API 与 Worker 使用同一份 `server/` 代码和镜像，分别运行；两者共享 `uploads` 命名卷。数据库健康后运行迁移，迁移成功后 API 启动，API 健康后 Web 与 Worker 启动。

## 本地启动

1. 将 `.env.example` 复制为 `.env`，设置数据库密码及至少 32 字节的 `JWT_SECRET`。`.env` 不会提交到 Git。
2. 运行 `docker compose up --build -d`。
3. 访问 `http://localhost:8081`（端口可在 `.env` 中修改）。页面会请求 `/api/health`。
4. 运行 `docker compose ps`，确认 `postgres`、`api`、`worker`、`web` 均在运行。
5. 需要查看后台进程时运行 `docker compose logs -f worker`。

本机数据库映射到 `localhost:5433`，供数据库客户端连接；容器之间通过服务名 `postgres:5432` 通信。API 不直接暴露到主机，由 Web 容器代理 `/api/`。

停止服务：`docker compose down`。数据库使用命名卷保存；不要使用 `down -v`，除非明确要清空本地数据。

## 管理员权限：设计与使用

`admins` 存账号与 BCrypt 密码摘要；`roles` 是可配置角色；`permissions` 是后端定义的权限代码；`admin_roles`、`role_permissions` 是多对多关联表；`audit_logs` 记录权限管理变更。数据库迁移在 `server/migrations/`，Drizzle 表结构在 `server/src/db/schema.ts`。新权限代码要随实际业务接口一同定义和迁移，管理 API 只能把已有权限代码组合成角色。

首次启动后，在终端交互创建第一位超级管理员，不存在默认账号或默认密码：

```bash
docker compose run --rm -it api node dist/admin/bootstrap.js
```

该命令仅在 `admins` 表为空时有效。密码至少 12 个字符，最长 72 个 UTF-8 字节。创建后可用 `POST /api/admin/auth/login` 登录，示例：

```bash
curl -X POST http://localhost:8081/api/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"你创建的邮箱","password":"你设置的密码"}'
```

登录响应包含 15 分钟有效的 JWT Access Token。后续管理请求使用 `Authorization: Bearer <accessToken>`。JWT 只携带管理员 ID；每次请求从数据库检查账号状态和当前权限，因此停用账号、修改角色或权限在下一次请求生效。没有 Token 返回 401，权限不足返回 403。

也可打开 `http://localhost:8081/admin` 使用 Vue 管理后台。登录后按当前有效权限显示资料库、对话轨迹、管理员、角色权限和操作记录。后台支持 Markdown、DOCX、文字版 PDF 上传、查看处理状态及片段、失败重试、重新处理、下架，以及创建管理员、分配角色、启停账号、创建/编辑角色。前端隐藏按钮并不构成授权；每个请求仍由后端守卫校验。Token 仅保存在页面内存中，刷新或关闭页面需重新登录，不存入 localStorage。当前没有刷新 Token，15 分钟到期后重新登录。

| 方法 | 路径 | 所需权限 | 作用 |
| --- | --- | --- | --- |
| POST | `/api/admin/auth/login` | 无 | 登录 |
| GET | `/api/admin/auth/me` | 已登录 | 当前管理员、角色与有效权限 |
| GET | `/api/admin/permissions` | `roles.manage` | 列出可用权限代码 |
| GET | `/api/admin/roles` | `roles.manage` 或 `admins.manage` | 列出角色，供角色管理或账号分配使用 |
| POST | `/api/admin/roles` | `roles.manage` | 创建角色 |
| PATCH | `/api/admin/roles/:id` | `roles.manage` | 更新非系统角色及权限 |
| GET / POST | `/api/admin/admins` | `admins.manage` | 列出 / 创建管理员 |
| PATCH | `/api/admin/admins/:id/roles` | `admins.manage` | 替换管理员角色 |
| PATCH | `/api/admin/admins/:id/status` | `admins.manage` | 停用或启用管理员 |
| GET | `/api/admin/audit?limit=50` | `audit.read` | 最近操作记录，最多 100 条 |

创建角色请求示例：`{"code":"knowledge_editor","name":"资料编辑","permissionCodes":["documents.read","documents.upload"]}`。创建管理员请求示例：`{"email":"editor@example.com","displayName":"编辑员","password":"至少十二位密码","roleIds":[2]}`；实际角色 ID 请先查询角色列表。角色分配使用 `{"roleIds":[2]}`，停用账号使用 `{"disabled":true}`。

关键约束：管理员不能授予自己没有的权限；只有超级管理员可分配系统角色；系统角色不能通过 API 改写；不能停用自己或移除最后一位可用超级管理员。变更与审计记录在同一数据库事务内提交。当前没有刷新 Token、忘记密码和登录限流，公网部署前应补齐这些能力及 HTTPS、自动化安全测试。

## 资料处理

一份上传文件对应一条 `documents` 记录，不维护版本。支持 2 MB 以内的 UTF-8 `.md` / `.markdown`、Word `.docx`、可复制文字的 `.pdf`。扫描版或纯图片 PDF 暂不支持 OCR；若没有可选中文字，状态变为 `failed`，详情会提示原因。旧式 `.doc` 不支持。原文件保存在 Docker `uploads` 卷中，数据库保存标题、原文件名、哈希、存储键、上传人、处理状态及提取后的纯文本。文件名不用于生成磁盘路径。

| 方法 | 路径 | 所需权限 | 作用 |
| --- | --- | --- | --- |
| POST | `/api/admin/documents` | `documents.upload` | multipart 表单，字段 `file`，可选 `title`；返回 202 与资料 ID |
| GET | `/api/admin/documents?limit=50&offset=0` | `documents.read` | 列表与处理状态 |
| GET | `/api/admin/documents/:id` | `documents.read` | 详情与提取结果 |
| GET | `/api/admin/documents/:id/chunks` | `documents.read` | 查看片段及出处位置 |
| PATCH | `/api/admin/documents/:id/archive` | `documents.archive` | 下架，原文件与审计记录保留 |
| POST | `/api/admin/documents/:id/retry` | `documents.reprocess` | 对处理失败且未下架的资料重新入队 |
| POST | `/api/admin/documents/:id/reprocess` | `documents.reprocess` | 对失败或已处理资料重建片段 |
| GET | `/api/admin/search?q=发货时间&limit=5` | `documents.read` | 检索诊断：返回片段、出处和匹配分数 |

上传示例（将 Token 与路径换成自己的）：

```bash
curl -X POST http://localhost:8081/api/admin/documents \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F 'title=售后政策' \
  -F 'file=@./samples/knowledge/02-shipping-and-delivery.md'
```

资料状态为 `queued → processing → ready`，失败为 `failed`；`ready` 表示正文和片段已生成，可以进入检索，但不代表 AI 已回答。旧版 `extracted` 资料可以调用 `/reprocess` 补建片段。Worker 对 Markdown 按标题、小节和段落切片；DOCX 由 Mammoth 提取段落，PDF 由 PDF.js 提取每页可选中的文字，再切片。`document_chunks` 保存标题路径、顺序和出处位置：Markdown 为原文行号，DOCX 为提取后的段落序号，PDF 为页码。正文最多 10 万字符、200 个片段，PDF 最多 100 页；超限时处理失败。正文、片段替换和状态更新在一个事务内提交，重试不会累积重复片段。

可在本地给 `EVAL_ADMIN_EMAIL` 与 `EVAL_ADMIN_PASSWORD` 提供管理员账号后，从 `server/` 运行 `npm run smoke:formats`。脚本会实际上传测试用 DOCX、文字 PDF、无文字 PDF，检查 Worker 结果并下架三份测试资料；数据库仍保留资料和审计记录。请勿把密码写进脚本或提交到仓库。若已配置 embedding，此验收会调用向量服务。

检索诊断保留 PostgreSQL `pg_trgm` 字符相似度作为基线。`minScore` 默认 `0.15`，只过滤字符检索结果；`limit` 最大 20。返回结果仅含未下架且状态为 `ready` 的资料；分数只用于比较候选片段，不是 AI 回答的置信度。

### 向量与融合检索

在 `.env` 中填写 `EMBEDDING_API_KEY` 后，API 和 Worker 使用同一个 embedding 服务。默认调用火山方舟 `doubao-embedding-vision-251215` 的 `/embeddings/multimodal` 接口，并使用 2048 维向量。一次请求只返回整个输入的一个向量，所以每个资料片段单独请求；用户问题也单独生成向量。`EMBEDDING_BASE_URL`、`EMBEDDING_MODEL` 可以配置，但更换模型时必须先确认接口格式和向量维度，并重建全部资料向量。资料片段及用户查询会发送给火山方舟；不要上传不允许交给该服务处理的资料。密钥只放在本机 `.env`，不要提交，也不要在共享日志中展示 `docker compose config` 的完整输出。

Worker 在切片后逐片段生成向量，并将片段、向量和 `ready` 状态一起提交。向量服务失败时资料变为 `failed`，可在恢复后重试；不配置密钥时仍可正常处理资料，但只做字符检索。启用密钥前已经处理的资料需要调用 `/api/admin/documents/:id/reprocess` 补建向量。更换 embedding 模型时，也要重处理旧资料；查询只匹配当前模型的向量，不会混用不同模型。

`GET /api/admin/search` 现在返回 `lexicalResults`、`vectorResults` 和 `fusionResults`，兼容字段 `results` 等于融合结果。`vectorIndexedChunks` 显示当前模型可检索的片段数；它为零时不调用 embedding 服务，并标记为 `lexical-only`。融合使用 Reciprocal Rank Fusion (RRF)，对两路排名分别计分，同一片段在两路都靠前会得到更高名次。当前知识库较小，pgvector 使用精确余弦距离扫描；没有为了“使用向量”而提前加近似索引。查询失败会明确返回错误，不会把向量服务故障伪装成零命中。

上传虚构资料时可运行 `cd server && npm run samples:prepare`；脚本按文件名跳过已存在的活动资料，并等待处理完成。脚本读取终端环境中的 `EVAL_ADMIN_EMAIL`、`EVAL_ADMIN_PASSWORD`，也可用 `EVAL_ACCESS_TOKEN` 代替。不要把真实密码写进命令历史或仓库。随后运行 `npm run eval:retrieval`，脚本读取 `samples/eval/questions.md` 中 Q001–Q009，逐题列出字符、向量、融合三路的 Top-1/Top-5 命中情况。连续追问、拒答和安全问题不属于这一轮单句检索指标。

2026-09-17 首次基线：10 份虚构资料生成 56 个片段；未配置 embedding 时，字符检索在 Q001–Q009 的 Top-1 和 Top-5 均为 5/9。五道直接问题全部命中，四道换说法的问题全部未命中。向量列为 0/9 是因为当时尚未生成向量，**不是模型效果**。配置真实 embedding 服务并重处理资料后，再用同一问题集比较。

2026-09-17 火山方舟重建后：10 份资料、56 个片段全部生成 `doubao-embedding-vision-251215` 的 2048 维向量。同一问题集的 Top-1/Top-5：字符 5/9、向量 9/9、融合 8/9 和 9/9。这是九道样例问题的检索结果，不代表生产场景准确率；融合 Top-1 低于单路向量，需要继续分析权重和排序。

配置好本机 `.env` 的 `EMBEDDING_API_KEY` 后，运行 `docker compose up -d --build migrate api worker` 应用迁移并重建服务。随后在 `server/` 目录运行 `node --env-file=../.env scripts/reindex-all-documents.mjs`，把全部活动的 `ready` 资料重新入队，等待 Worker 生成当前模型的向量。再运行 `npm run eval:retrieval` 对比检索结果。`samples:reprocess` 仍可只重处理样例资料。未配置真实密钥时不要运行重建命令，否则只会再次生成无向量片段。

## 访客问答 API

在本机 `.env` 设置 `LLM_API_KEY` 后，回答模型由 `LlmService` 通过 OpenAI-compatible `/chat/completions` 接口调用火山方舟。配置先由 `AppConfigService` 校验，再由 `ProviderRegistry` 创建 `OpenAICompatibleProvider`；Provider 本身不读取环境变量。可配置 `LLM_PROVIDER`（当前仅支持 `openai-compatible`）、`LLM_BASE_URL`、`LLM_MODEL`、`LLM_TIMEOUT_MS`、`LLM_CONTEXT_WINDOW_TOKENS` 和 `LLM_MAX_OUTPUT_TOKENS`。默认上下文窗口为 32,000 tokens，最大输出为 1,200 tokens；模型密钥只传给 API 容器，前端和 Worker 不持有。修改配置后重建 API：`docker compose up -d --build api`。

访客可直接打开 `http://localhost:8081` 使用 Vue 页面。页面可新建、切换和删除多段对话；同一浏览器刷新后可恢复。后端用 180 天有效的 `HttpOnly` 匿名 Cookie 将会话归属到当前浏览器，不提供登录或跨设备找回；清除 Cookie 后旧记录无法找回。删除对话会级联删除消息与调用轨迹。每段对话的摘要和历史严格独立，新会话从空上下文开始。

完整原始消息保存在 PostgreSQL；回答时会传当前会话的摘要、最近最多三轮已回答问答、结构化 Agent Transcript 和当前问题。当前 Transcript 第一阶段复用 `chat_traces.context_snapshot.agentTranscript` 保存，不新增表；每轮包含用户消息、assistant 工具调用、tool 结果和最终 assistant 回答，并带有会话 ID、轨迹 ID、序号和时间。摘要更新本身也是一次模型调用，另记一条轨迹。摘要和 Transcript 都只帮助模型理解会话，不能替代本轮引用校验；后续 Context Governor 会再负责 token 预算和压缩。

记忆边界由 `conversation_id` 决定：匿名浏览器 Cookie 只负责归属校验，不是跨会话记忆。`ConversationService.snapshot()` 会先校验当前浏览器是否拥有该会话，再加载该会话的摘要、最近消息和历史 Transcript；`ContextBuilder` 将它们与当前轮工具结果和预检索资料组装为模型上下文。新会话不会读取旧会话内容，删除会话会级联删除消息和轨迹。当前不建立用户级或跨会话 Memory 表。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET / POST | `/api/chat/conversations` | 列出 / 新建当前浏览器的会话 |
| GET | `/api/chat/conversations/:id/messages` | 查看本会话完整消息 |
| POST | `/api/chat/conversations/:id/messages` | 在本会话提问，返回 JSON |
| POST | `/api/chat/conversations/:id/messages/stream` | 在本会话提问，返回已校验答案的 SSE 分段 |
| GET | `/api/chat/conversations/:id/runs` | 查看本会话最近的请求运行状态 |
| DELETE | `/api/chat/conversations/:id` | 删除本会话、消息与轨迹 |

以上接口均用匿名 Cookie 校验会话归属；其他浏览器请求该会话 ID 返回 404。一次会话同时只允许一个未完成回答。

页面会在 `localStorage` 保存当前会话 ID，以及尚未完成请求的本地 request ID。刷新或重新打开同一浏览器后，前端会重新加载会话、完整消息和运行记录；已完成运行直接从持久化消息恢复，仍处于 `queued`/`running` 的运行会显示为待恢复状态。每次带 `Idempotency-Key` 的请求都会写入 `conversation_runs`，相同请求键重试不会重复写入消息；同一请求键提交不同问题会返回 409。运行超过 5 分钟后由查询接口惰性标记为 `expired`，之后允许使用同一请求键重新执行；当前没有后台清理任务。旧请求若在过期后才完成，不会再写入消息。

```bash
curl -X POST http://localhost:8081/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"question":"暖风机保修多久？"}'
```

请求问题限 2–200 个字符；回答返回 `answer`、`refused`、`citations`。后端自己的编排器最多执行六次工具调用，每次都校验工具名和参数；模型若拒答、没有有效来源 ID 或输出格式不合约定，API 返回“无法确定，建议联系人工。”。模型给出的引用 ID 必须属于本轮工具结果，但这只能验证引用来源，**不能自动证明回答的每一句都受资料支持**，重要政策仍需人工验收。模型无法查询真实订单或执行退款。

当前普通 JSON 接口是核心实现；第六阶段增加了独立 SSE 传输层。后端先完成工具调用、最终答案和来源校验，再把已校验正文分段发送，因此这是答案传输流式化，不是模型私有思考过程，也不会公开工具过程。模型调用遇到网络错误、限流、5xx 或空响应最多重试一次；容器日志不记密钥、请求正文或供应商原始响应。

### ToolRegistry 与本地工具

当前不引入 LangChain Agent，也暂不启用 MCP。`ChatOrchestratorService` 自己实现“模型规划 JSON → 后端校验 → `ToolRegistry` 查找工具 → 执行工具 → 把结果交回模型”的循环，最多六次调用。

`server/src/ai/tools/` 提供统一的 `AgentTool`、`ToolContext`、`ToolResult` 和 `ToolRegistry`。当前注册的工具包括 `search_knowledge`、`list_product_categories`、`list_products`、`get_product_detail`。产品目录由进程内的 `ProductCatalogService` 读取虚构数据，不对应真实库存、售价或购买服务。

工具调用会经过 `ToolPolicy` 和 `ToolExecutionService`：参数先按工具 Schema 校验，单轮最多六次调用，相同名称和参数不会重复执行；工具有 30 秒超时，面向模型的结果最多 12,000 字符，异常会转换为安全错误码并记录耗时。工具结果中的结构化 `data` 仍由后端用于引用和产品校验。

工具负责执行能力，不负责决定是否调用、生成最终答案或绕过引用校验。模型和工具返回值都被视为不可信数据，最终回答仍必须通过来源 ID 或已取得的产品 ID 校验。本阶段移除了 MCP 子进程、MCP 客户端和后台 MCP 管理页面；未来若重新接入 MCP，可通过 `McpToolAdapter implements AgentTool` 接入同一个 Registry，而不修改 Agent 主流程。

### Agent Runtime

当前 Agent 执行边界位于 `server/src/ai/agent/`：`AgentLoop` 处理一次“模型规划 → 工具执行或最终答案”的步骤，`AgentRunner` 创建单次运行状态并执行最多六轮循环。它们只依赖 `LlmService`、`ContextBuilder` 和 `ToolExecutionService`，不访问 HTTP、数据库、Cookie 或会话持久化。

`ChatOrchestratorService` 现在只负责把会话问题、摘要和最近历史转换为 `AgentInput`，再把 `AgentResult` 转成现有 `ChatRun`。因此，Agent Runtime 可以使用 fake provider 和 fake tools 独立测试，后续增加其他传输方式时不需要复制 Agent 循环。一次运行的工具轨迹、资料命中、产品结果和 Token 用量仍通过现有 `contextSnapshot` 与 `chat_traces` 保存。

旧迁移 `0009_mcp_capability_policy.sql` 保留在迁移历史中，但当前 Drizzle schema 和运行时代码不再使用这些表；暂不执行删除表迁移，避免破坏已有数据库的回滚和后续学习记录。

本地验证：在 `server/` 运行 `npm test`，然后启动服务后分别询问资料政策和产品目录，再在同一会话追问规格。不要将 mock 产品目录当作真实商品信息。

单 API 实例目前按访客 IP 每分钟最多 10 次问答、全局最多 5 个并发请求；经本项目 Nginx 转发时使用代理传来的真实 IP。限流保存在进程内，多实例部署需换成 Redis 等共享限流。不要把真实客户隐私或生产资料上传到此学习项目；问题、有限历史和检索片段会发送到所配置的火山方舟服务。

### 管理员对话轨迹

具备 `conversations.read` 权限的管理员可在“对话轨迹”页查看最近 50 次回答或摘要调用。`GET /api/admin/chat-traces` 返回列表，`GET /api/admin/chat-traces/:id` 返回详情。轨迹记录提问、检索查询、当轮资料片段、当前会话上下文、模型原始输出、最终回答、拒答状态、耗时与供应商返回的输入/输出 Token；未提供用量时显示“未提供”，不伪造估算值。模型失败也记录脱敏失败类别。轨迹会存储 Demo 对话和资料内容，**不要输入真实客户隐私**。密钥和 Authorization 头不入库；没有启用向外部发送轨迹的 LangSmith。

数据库资料记录、队列任务和审计记录在同一 PostgreSQL 事务中提交；文件写入在事务之前，事务失败时会尝试删除文件。极端情况下进程崩溃可能留下无数据库记录的孤儿文件，后续应加入定期清理。下架旧资料后可上传新资料，无需维护版本。

## 通用知识库 V1

管理后台新增「知识库」入口，支持多知识库、结构化 Block、通用／父子分段、经济／高质量索引、Embedding Profile、版本发布和回退、FAQ 与检索诊断。旧默认知识库在首次发布新版本前继续使用原索引。

完整操作说明、接口、配置和限制见 [知识库 V1](docs/knowledge-base-v1.md)。真实 PostgreSQL 检索回归：在 `server/` 运行 `npm run eval:knowledge`，使用隔离 schema 和事务回滚，不修改已有资料。

## 后续优化

后续扩大问答评测集并改进证据判定；如需更低首字延迟，再研究可安全校验的真正模型 token 流。公网部署前还需完善登录限流、刷新会话、共享限流、文件安全扫描、滥用防护和安全验收。

Agent 上下文治理正在分阶段推进：第一阶段已经建立标准 Agent Transcript，让下一轮能够看到上一轮的 `assistant.tool_calls` 和 `tool` 结果；第二阶段增加 `ContextGovernor` 和 token budget，按上下文窗口、最大输出和 5% 安全缓冲计算输入预算，并将 `normal/elevated/high/overflow` 压力写入轨迹。下一阶段再实现旧上下文压缩、summary checkpoint 和结构化证据复用。即使历史工具结果被带入上下文，也不能直接绕过本轮 `AnswerGuard`；价格、库存等易变信息仍应重新查询。

工具调用策略也需要逐步增强：保留当前 ToolRegistry 和权限边界，为工具声明只读／有依赖／有副作用等执行属性；同一模型响应中的独立只读工具可以并行，存在参数依赖或潜在副作用的工具必须按顺序执行，并记录调度原因、依赖关系和每个工具的耗时。该策略应在统一 ToolCall 解析和原生 `tool_calls` 兼容稳定后再扩展。
