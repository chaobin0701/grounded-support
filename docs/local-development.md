# 本地运行与开发指南

本项目支持两种本地启动方式：
1. **长期稳定运行（推荐 · PM2 守护模式）**：原生构建，内存占用低，后台静默常驻，关闭终端不中断，支持开机自启。无需繁重的全量 Docker 构建。
2. **热更新开发（实时编码模式）**：适合日常修改代码、需要即时热重载（Watch / HMR）的开发阶段。

---

## 方式一：长期稳定运行（PM2 守护模式，推荐）

### 为什么采用此模式？
- **极速构建**：相比 Docker 镜像在虚拟机内漫长的打包过程，本地宿主机构建仅需 5~8 秒。
- **资源极轻**：NestJS 生产模式常驻内存约几十兆，前端以静态服务托管，摆脱 Vite 热更新的大量文件监视器开销。
- **稳定常驻**：进程在后台静默运行，终端关闭、电脑息屏唤醒均不受影响；若遇异常崩溃，PM2 自动毫秒级拉起。

### 一键构建并启动

在项目根目录运行：

```bash
npm run prod:start
```

该命令会自动：
1. 检查数据库连通性（未启动时尝试拉起轻量数据库容器）；
2. 编译 `server`、执行数据库迁移（`db:migrate`）；
3. 编译 `web` 与 `website` 前端静态资源；
4. 通过 PM2 在后台启动全部 4 个服务：
   - `hexu-api`：`http://localhost:3000`（API 接口与 SSE 流式通道）
   - `hexu-worker`：后台异步文档切片与向量处理 Worker
   - `hexu-admin`：`http://localhost:8848/admin`（管理后台）
   - `hexu-website`：`http://localhost:8849`（企业官网）

### 常用管理命令

```bash
npm run prod:status    # 查看 4 个服务运行状态、内存与重启次数
npm run prod:logs      # 查看聚合实时运行日志
npm run prod:reload    # 重新构建后零停机平滑更新服务
npm run prod:restart   # 重启所有后台服务
npm run prod:stop      # 停止所有服务
```

### 设置开机自启（可选）

如果希望 Mac/服务器开机或登录后自动在后台拉起客服服务：

```bash
npx pm2 save
npx pm2 startup
```

按照提示执行输出的系统命令即可注册开机常驻服务。

---

## 数据库运行建议（摆脱笨重 Docker 构建）

项目依赖 PostgreSQL 与 `pgvector` 插件。摆脱 Docker 镜像构建后，数据库有以下轻量运行方案：

### 方案 A：轻量纯净数据库容器（默认推荐）
不需要在 Docker 中编译任何业务代码，只利用官方预编译镜像常驻一个轻量数据库容器（内存开销仅 ~50MB）：

```bash
docker compose up -d postgres
```

### 方案 B：使用 OrbStack 代替 Docker Desktop（Mac 极佳体验）
如果使用的是 macOS，推荐使用 [OrbStack](https://orbstack.dev/) 替代官方 Docker Desktop。其启动只需 2 秒，能耗与内存仅为 Docker Desktop 的十分之一，对轻薄本（如 MacBook Air）极其友好。

### 方案 C：免费云端 Serverless PostgreSQL（完全 0 本地负担）
若本地完全不想运行任何数据库进程：
1. 在 [Supabase](https://supabase.com/) 或 [Neon](https://neon.tech/) 创建免费项目（原生自带 `pgvector` 扩展）。
2. 将项目根目录 `.env` 中的 `DATABASE_URL` 替换为云端连接串：
   ```env
   DATABASE_URL="postgres://username:password@ep-xyz.neon.tech/grounded_support?sslmode=require"
   ```
3. 运行 `cd server && npm run db:migrate` 迁移表结构。
4. 本地即可实现 **完全 0 容器、0 数据库进程** 的纯净极速运行。

---

## 方式二：本地热更新开发（实时编码模式）

若正在对前端页面或后端逻辑进行频繁编码调试，可使用开发监督器：

### 1. 启动后台服务与 API 监听

在仓库根目录执行：

```bash
node scripts/dev-supervisor.mjs
```

监督器使用 Docker 数据库，启动 TypeScript 监听编译及 Vite 开发服务：
- API 服务：`http://localhost:3000`
- 管理后台：`http://localhost:8848`（`/api` 自动代理到 3000）
- 后台 Worker 进程

### 2. 启动官网前端

官网为独立 Vite 项目，需另开终端：

```bash
cd website
npm run dev
```

官网访问地址为 `http://localhost:8849`。

---

## 常用服务检查

```bash
# 检查 API 健康度
curl http://localhost:3000/api/health

# 检查管理后台入口
curl -I http://localhost:8848/

# 检查企业官网入口
curl -I http://localhost:8849/
```
