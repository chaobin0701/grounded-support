# grounded-support

一个用于学习知识库检索与有据回答的虚构小家电客服项目。

## 当前阶段

目前有可运行的 Vue 访客问答页、NestJS API、独立 Worker、PostgreSQL + pgvector、管理员权限管理，以及 Markdown 上传、异步切片和管理员检索诊断。配置 embedding 服务后可对比字符、向量和融合检索；访客可通过页面使用 JSON 问答 API。

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
| `worker` | `node dist/worker.js` | 消费 `document-ingest` 任务，提取 Markdown 正文并生成片段 |
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

也可打开 `http://localhost:8081/admin` 使用 Vue 管理后台。登录后按当前有效权限显示资料库、管理员、角色权限和操作记录。后台支持 Markdown 上传、查看处理状态及片段、失败重试、重新处理、下架，以及创建管理员、分配角色、启停账号、创建/编辑角色。前端隐藏按钮并不构成授权；每个请求仍由后端守卫校验。Token 仅保存在页面内存中，刷新或关闭页面需重新登录，不存入 localStorage。当前没有刷新 Token，15 分钟到期后重新登录。

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

## Markdown 资料处理

一份上传文件对应一条 `documents` 记录，不维护版本。上传仅支持 2 MB 以内的 UTF-8 `.md` / `.markdown` 文件；原文件保存在 Docker `uploads` 卷中，数据库保存标题、原文件名、哈希、存储键、上传人、处理状态及提取后的纯文本。文件名不用于生成磁盘路径。

| 方法 | 路径 | 所需权限 | 作用 |
| --- | --- | --- | --- |
| POST | `/api/admin/documents` | `documents.upload` | multipart 表单，字段 `file`，可选 `title`；返回 202 与资料 ID |
| GET | `/api/admin/documents?limit=50&offset=0` | `documents.read` | 列表与处理状态 |
| GET | `/api/admin/documents/:id` | `documents.read` | 详情与提取结果 |
| GET | `/api/admin/documents/:id/chunks` | `documents.read` | 查看该资料的片段及原文行号 |
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

资料状态为 `queued → processing → ready`，失败为 `failed`；`ready` 表示正文和片段已生成，可以进入检索，但不代表 AI 已回答。旧版 `extracted` 资料可以调用 `/reprocess` 补建片段。Worker 从原始 Markdown 按标题、小节和段落切片，过长段落才按长度拆分；`document_chunks` 保存标题路径、顺序和原文行号。正文、片段替换和状态更新在一个事务内提交，重试不会累积重复片段。

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

在本机 `.env` 设置 `LLM_API_KEY` 后，`POST /api/chat` 无需登录即可提问。`LLM_MODEL` 默认 `deepseek-v4-1-flash-260910`，也可设置为 `glm-5-3-flash-260828`；模型密钥只传给 API 容器，前端和 Worker 不持有。修改配置后重建 API：`docker compose up -d --build api`。

访客也可以直接打开 `http://localhost:8081` 使用 Vue 页面。页面提供示例问题、输入校验、等待与错误反馈，并可展开回答所引用的资料名称和原文行号；使用现有 Nginx 的同源 `/api/` 代理，不需要把密钥或后端地址写进浏览器代码。页面中的消息只保留在当前浏览器会话内存，刷新即消失；每次提问独立检索，当前不支持上下文追问。

```bash
curl -X POST http://localhost:8081/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"question":"暖风机保修多久？"}'
```

请求问题限 2–200 个字符；回答返回 `answer`、`refused` 和 `citations`。每条引用含资料 ID、片段 ID、资料名与原文行号。后端只检索未下架且已处理好的资料，最多传五个片段给回答模型；模型若拒答、没有有效引用或输出格式不合约定，API 返回“无法确定，建议联系人工。”。模型给出的引用 ID 必须属于本次检索结果，但这只能验证引用来源，**不能自动证明回答的每一句都受资料支持**，重要政策仍需人工验收。模型无法查询真实订单或执行退款。

单 API 实例目前按访客 IP 每分钟最多 10 次问答、全局最多 5 个并发请求；经本项目 Nginx 转发时使用代理传来的真实 IP。限流保存在进程内，多实例部署需换成 Redis 等共享限流。不要把真实客户隐私或生产资料上传到此学习项目；问题与检索片段都会发送到所配置的火山方舟服务。当前不存储对话，不支持连续追问，也不提供流式输出。

数据库资料记录、队列任务和审计记录在同一 PostgreSQL 事务中提交；文件写入在事务之前，事务失败时会尝试删除文件。极端情况下进程崩溃可能留下无数据库记录的孤儿文件，后续应加入定期清理。下架旧资料后可上传新资料，无需维护版本。

## 后续阶段

后续支持 `.docx` 与文字版 PDF；扩大问答评测集并改进证据判定；实现连续追问和流式回答。公网部署前还需完善登录限流、刷新会话、共享限流、滥用防护和安全验收。
