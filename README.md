# grounded-support

一个用于学习知识库检索与有据回答的虚构小家电客服项目。

## 当前阶段

这是第一阶段的可运行骨架：Vue 页面、NestJS API、独立 Worker 和 PostgreSQL + pgvector。文件上传、检索、管理员权限与 AI 回答会在后续阶段逐步实现。

## 目录

- `web/`：Vue 访客页与管理页（当前仅有连通性页面）
- `server/`：NestJS API 与同一代码库中的 Worker
- `infra/`：数据库初始化脚本
- `samples/`：后续放入虚构政策与验收问题

## 本地服务边界

| 服务 | 启动内容 | 当前职责 |
| --- | --- | --- |
| `web` | Nginx 托管 Vue 构建结果 | 展示页面，并将 `/api/` 转发给 API |
| `api` | `node dist/main.js` | 提供 NestJS HTTP API 与数据库健康检查 |
| `worker` | `node dist/worker.js` | 连接 PostgreSQL 任务队列；文档处理逻辑后续加入 |
| `postgres` | PostgreSQL + pgvector | 保存应用数据和任务，启用 `vector` 扩展 |

API 与 Worker 使用同一份 `server/` 代码和镜像，分别运行；两者共享 `uploads` 命名卷。数据库健康后 API 启动，API 健康后 Web 与 Worker 启动。

## 本地启动

1. 将 `.env.example` 复制为 `.env`，并修改本地数据库密码。`.env` 不会提交到 Git。
2. 运行 `docker compose up --build -d`。
3. 访问 `http://localhost:8081`（端口可在 `.env` 中修改）。页面会请求 `/api/health`。
4. 运行 `docker compose ps`，确认 `postgres`、`api`、`worker`、`web` 均在运行。
5. 需要查看后台进程时运行 `docker compose logs -f worker`。

本机数据库映射到 `localhost:5433`，供数据库客户端连接；容器之间通过服务名 `postgres:5432` 通信。API 不直接暴露到主机，由 Web 容器代理 `/api/`。

停止服务：`docker compose down`。数据库使用命名卷保存；不要使用 `down -v`，除非明确要清空本地数据。

## 后续阶段

管理员上传 `.md`、`.docx`、文字版 PDF；Worker 异步提取、切片并建立索引；访客通过关键词与向量混合检索获得带出处的流式回答。当前骨架尚未实现这些功能。
