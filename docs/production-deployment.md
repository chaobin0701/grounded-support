# 禾序生产部署与迁移

## 当前部署

- SSH：`hexu-prod`，服务器 `8.163.83.250`（Ubuntu 22.04 / amd64）。
- 官网：`https://hexu.7410000.xyz`。
- 聊天：`https://hexu-admin.7410000.xyz/`。
- 后台：`https://hexu-admin.7410000.xyz/admin`。
- 接入文档：`https://hexu-admin.7410000.xyz/docs/integration`。
- 服务器目录：`/opt/hexu-support`；Compose 项目名 `hexu-support`。
- 独立 PostgreSQL、API、Worker 和 Caddy 容器。Caddy 服务两套正式静态构建，并代理各自的 `/api/`；仅入口发布 80/443，数据库和 API 无宿主机端口。
- Caddy 自动签发/续期 HTTPS；原始客户端 IP 和协议由单层入口传递，SSE 禁用代理缓冲。

生产配置与本地 `docker-compose.yml` 分开；不使用 Vite、源码挂载或开发监督进程。本地 8848/8849 热更新保持原状。数据库镜像固定为迁移时加载的 `hexu-postgres:20261009-0.8.7`，不自动跟随 `pg17` 浮动标签。

## 首次迁移

在 `server` 目录执行：

```bash
DEPLOY_RELEASE=20261009-ba86f71 PAUSE_DEV_SUPERVISOR_PID=实际监督进程PID \
  node --env-file=../.env scripts/prepare-production-migration.mjs
```

脚本先检查活跃任务，只短暂暂停已验证的本地监督进程及 API/Worker 组，并在 `finally` 中恢复。输出到被 Git 忽略的 `.data/migrations/` 私有目录；不输出凭证或文档内容。

迁移包含管理员/权限、产品、知识库/文档/索引、模型与 Agent 配置、接入应用/API Key 哈希、会话/轨迹/审计和任务队列。原文件必须同时检查当前 `.data/uploads/documents` 和旧 `grounded-support_uploads` 卷，并逐份核对存储键、大小和 SHA-256；发现缺失或冲突直接停止，不假装迁移成功。

首次迁移导入 43 张表、45 份原文件，其中当前目录 5 份、旧卷 40 份。源 PostgreSQL 17.11 / pgvector 0.8.6；目标 PostgreSQL 17.11 / pgvector 0.8.7。只接受相同 PostgreSQL 主版本及同一 pgvector 次版本中不低于源的补丁版本，并验证恢复数据和实际检索。

新生产数据库密码与 JWT 登录密钥随机生成。模型加密密钥保持原有效来源：若旧配置没有独立 `MODEL_CONFIG_ENCRYPTION_KEY`，使用旧 JWT 密钥作为新独立模型加密密钥，而不是用新 JWT 解密旧数据。API/Worker 共用生产配置。`.env.production` 和备份目录限制权限，禁止放入 Git、镜像或公开页面。

顺序：创建空目标数据库 → 单事务 `pg_restore --exit-on-error --no-owner --no-acl` → `verify-migration.cjs` 核对所有表计数/原文件/密钥解密 → 运行已有 migrations → `configure-origins.cjs` 只调整内置应用生产 Origin 并记录审计 → 启动 API/Worker → 开放入口并验证证书。

外部接入应用及 API Key 不会被自动撤销或改写。新域名不继承旧浏览器 Cookie/本地草稿，也不自动登录；后台完整历史记录仍保留，管理员使用原账号密码重新登录。

## 构建与更新

### 2026-10-09 增量发布

- 版本：`20261009-f33e542-r1`；API/Worker 使用 `hexu-server` 同版本，入口使用 `hexu-edge` 同版本；平台均为 `linux/amd64`。
- 本次基于 `f33e542` 和当前已验证工作区构建，包含尚未提交的官网/部署改动，不应将版本号理解为仅该 Git 提交的快照。
- 更新内容包括管理员邮箱/账号登录及体验凭据预填、“向量服务”命名、已有平台配置展示简化，以及本地已验证的官网输入与历史菜单调整。
- 本地 server 测试 218 通过、4 项条件测试跳过；web 66 通过；website 测试及三端构建通过。
- 更新前一致性备份：`/opt/hexu-support/backups/20261009T041750Z/`。SQL 和上传压缩包 SHA-256 校验通过；恢复到独立临时数据库后，43 张表、45 份原文件、2 份加密模型凭据解密验证通过。
- 在备份恢复数据库先演练 `0033_admin_username`，再在生产执行同一 migration。原数据库、上传目录和 15 款小米产品保留，未重新导入。
- 更新前镜像配置另保存在 `backups/release-20261009-f33e542-r1/.env.before-update`（受限权限）；旧镜像 `20261009-ba86f71` 保留。账号字段变化是增量扩展；若后续已有用户名专用账号，不可盲目回退旧登录代码或删除用户名列。
- 验证：两个站点 HTTPS/HTTP 跳转、深链接、后台鉴权、概览/知识库/Agent 配置、产品目录、发布资源中的界面文案通过；真实 SSE 问答产生 140 个事件，第二轮恢复 3 条上下文，测试会话已删除。未重复进行模型/向量连接探测；真实问答产生正常模型用量。
- 镜像 ID：server `sha256:5f8902c3020db311baec2a0c48ec7d6be0b711dd783bf96e99856f011549ebee`；edge `sha256:d641389a717540e8b28d96159b36a9fb20803217dd1a4f9e5683188702512948`；上传后服务器 ID 与本地一致。

先运行 server/web/website 的测试与构建。镜像在构建机产出，目标平台必须为 `linux/amd64`；不要在 2 GiB 服务器上并行编译全部项目。

```bash
docker buildx build --platform linux/amd64 --load -t hexu-server:新版本 server
docker buildx build --platform linux/amd64 --load -t hexu-edge:新版本 -f deploy/edge.Dockerfile .
```

`edge.Dockerfile.dockerignore` 只允许两套 dist 和 Caddyfile 进入上下文。通过 SSH 传输镜像，不开放 Docker 守护进程的远程端口。更新前做备份，然后在受限 `.env.production` 更新固定镜像版本。

服务器操作：

```bash
cd /opt/hexu-support
docker compose --env-file .env.production -f compose.production.yml config --quiet
docker compose --env-file .env.production -f compose.production.yml run --rm migrate
docker compose --env-file .env.production -f compose.production.yml up -d --wait
docker compose --env-file .env.production -f compose.production.yml ps
```

不要输出展开后的 Compose 配置（包含密钥），不要使用 `down -v`、删除数据目录或无目标的 `docker system prune`。首次初始化配置已经恢复，重启不重新导入或覆盖数据库。

## 验证

不使用浏览器自动化。检查两套页面及深链接、HTTPS 与 HTTP 跳转、产品 API、未授权后台 401、未授权 Origin 403、管理员鉴权、知识库、模型 JSON/原生工具能力、Embedding 维度、SSE 和无 productIds 的第二轮上下文恢复。

`check-production.cjs` 使用仅在内存中的短期管理员测试凭证，不打印 Token、不更改密码；它不能代替用户实际密码登录验证。真实连接测试正常产生模型用量。测试会话只创建隔离记录，结束后删除；已计费调用不回滚。可以设置 `SKIP_PROVIDER_PROBES=1` 避免重复连接探测。

## 备份与恢复

`hexu-backup.timer` 每天北京时间 03:30 后随机延迟最多 5 分钟执行，错过执行会补跑。备份会短暂停止入口/API/Worker，保证 SQL 与文件一致，退出时自动恢复。数据库、文件、配置、核对清单保存在 `/opt/hexu-support/backups/时间戳/`，权限受限；首次迁移备份单独保存在 `backups/initial`，并有本地离机副本。

```bash
systemctl start hexu-backup.service
systemctl show hexu-backup.service --property=Result,ExecMainStatus
systemctl list-timers hexu-backup.timer
```

备份不自动删除。定期检查磁盘并复制到独立主机或受限对象存储；仅有同盘备份不足以抵御整机故障。不得将含模型加密密钥的备份公开分享。

首次恢复演练使用 `20261009T030456Z` 备份，在独立数据库 `hexu_restore_check_20261009` 中恢复 SQL，并从备份压缩包解出原文件。43 张表、45 份文件及模型凭证解密核对通过后，仅删除临时测试数据库，未覆盖生产数据。该次完整备份另复制到构建机被 Git 忽略的私有迁移目录；后续每日备份目前不会自动同步到离机存储。

回滚代码使用旧固定镜像。涉及数据结构变化时先保留当前数据，再把备份恢复到新的数据库和文件目录进行验证，确认后切换；不要直接覆盖唯一生产数据。恢复原文件目录需保证应用 UID 1000 可读写。

## 运维与已知事项

- API、Worker、数据库和入口有内存/CPU 限制及日志轮转；初期问答并发 2、上传并发 1，不提供高可用保证。
- 之前的 Pencil、1Panel 只停止，未卸载或删除。1Panel 的原开机启动设置仍在，重启后可能再次启动；如需禁用应明确授权。
- 上线前 MCP SDK 已更新到 1.32.1，消除 npm 审计中的高危条目。仍有 3 个中危审计条目来自 Mammoth → argparse → sprintf-js 同一依赖链。没有通过 `npm audit fix --force` 降级文档能力；需要持续跟踪修复，不能把测试通过当成全面安全保证。
- 公开前应确认域名已备案并完成对应接入，安全组只开放必要入口，SSH 限制可信 IP。域名 A 记录需有默认线路，不能仅配置中国地区，否则外部证书验证可能失败。
