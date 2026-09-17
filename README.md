# grounded-support

一个用于学习知识库检索与有据回答的虚构小家电客服项目。

## 当前阶段

目前有可运行的 Vue 占位页、NestJS API、独立 Worker、PostgreSQL + pgvector、管理员权限管理，以及 Markdown 上传、异步切片和管理员检索诊断。向量检索与 AI 回答尚未实现。

## 目录

- `web/`：Vue 访客页与管理页（当前仅有连通性页面）
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

| 方法 | 路径 | 所需权限 | 作用 |
| --- | --- | --- | --- |
| POST | `/api/admin/auth/login` | 无 | 登录 |
| GET | `/api/admin/auth/me` | 已登录 | 当前管理员 |
| GET | `/api/admin/permissions` | `roles.manage` | 列出可用权限代码 |
| GET / POST | `/api/admin/roles` | `roles.manage` | 列出 / 创建角色 |
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

检索诊断使用 PostgreSQL `pg_trgm` 的字符相似度作为小规模资料库的基线，不调用大模型，也不生成向量。`minScore` 默认 `0.15`，可在查询参数中设为 `0` 到 `1`，`limit` 最大 20。返回结果仅含未下架且状态为 `ready` 的资料；分数只用于比较当前查询的候选片段，不是 AI 回答的置信度。中文同义表达的效果需要用 `samples/eval/` 的问题继续评估。

数据库资料记录、队列任务和审计记录在同一 PostgreSQL 事务中提交；文件写入在事务之前，事务失败时会尝试删除文件。极端情况下进程崩溃可能留下无数据库记录的孤儿文件，后续应加入定期清理。下架旧资料后可上传新资料，无需维护版本。

## 后续阶段

后续支持 `.docx` 与文字版 PDF；增加向量检索并与当前字符相似度结果融合；访客通过检索获得带出处的流式 AI 回答。当前还没有向量检索或 AI 问答。
