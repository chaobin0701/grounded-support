# 本地开发启动

本地开发使用热更新，不需要启动 API、Worker 或前端 Docker 容器；Docker 只保留 PostgreSQL 数据库。

## 一键启动后台与 API

在仓库根目录执行：

```bash
node scripts/dev-supervisor.mjs
```

它会启动或检查：

| 服务 | 地址 | 说明 |
| --- | --- | --- |
| API | `http://localhost:3000` | Nest API、SSE 和后台数据接口 |
| 管理后台/独立助手 | `http://localhost:8848` | Vite 热更新，`/api` 代理到 3000 |
| PostgreSQL | `localhost:5433` | Docker 数据库 |
| Worker | 无浏览器地址 | 文档解析和向量任务 |

## 启动官网

官网是独立 Vite 项目，需要另开一个终端：

```bash
cd website
npm ci                 # 首次运行
npm run dev
```

官网地址为 `http://localhost:8849`，`/api/*` 默认代理到 `http://127.0.0.1:3000`。例如：

```text
http://localhost:8849/api/chat/quota
```

该地址会先经过官网的访客授权和 Cookie 校验；直接用没有 Origin、访客令牌或会话的 `curl` 请求返回 403/401 是正常的。浏览器从官网页面发起请求时会自动携带所需凭证。

如果 API 不在 3000 端口，可在 `website/.env.local` 中配置：

```ini
API_PROXY_TARGET=http://127.0.0.1:3000
```

修改代理地址后需要重启官网 Vite 进程。`8081` 是 Docker Web 映射端口，不是当前本地热更新 API 地址。

## 常用检查

```bash
curl http://localhost:3000/api/health
curl -I http://localhost:8848/
curl -I http://localhost:8849/assistant
```

退出监督器或官网终端使用 `Ctrl+C`。重新编辑 `server/src`、`web/src` 或 `website/src` 后，分别由对应的 watch/Vite 进程自动重载。
