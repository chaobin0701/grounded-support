# 通用知识库 V1

## 实现范围

| 阶段 | 实现 |
| --- | --- |
| V1.1 | 多知识库、默认库兼容迁移、管理权限、资料归属与隔离 |
| V1.2 | Markdown / DOCX / 文字 PDF 解析、持久化 Block、解析器版本和警告、来源定位 |
| V1.3 | 字符分段、段落合并、优先标点断开、分段预览、经济索引、版本构建与发布／回退 |
| V1.4 | Embedding Profile、OpenAI-compatible / 火山多模态协议、凭据连接、全文／向量／混合检索 |
| V1.5 | 章节父块、子块检索、父块去重与完整父块证据 |
| V1.6 | Vue 后台、原文件下载、Block/Chunk 预览、版本发布前检索诊断、模型配置管理 |
| V1.7 | 人工 FAQ 创建／修改／下架、CSV 原子导入、真实 PostgreSQL 检索评测 |

不包含 OCR、图片理解、复杂 PDF 表格恢复、Reranker、自动生成 FAQ 或可视化流水线。没有重新引入 LangChain，没有修改 Agent Loop/Runner。

## 数据流程

```text
文件上传 → 原始文件 + documents + pg-boss 任务（记录和任务同一事务）
                      ↓ Worker
               document_blocks + parser_version + parser_warnings
                      ↓ 管理员请求构建
       knowledge_index_versions：冻结配置、Profile、Block 和资料标题
                      ↓ Worker，不重新解析文件
        index_chunks → FTS / trigram；高质量模式另写 chunk_embeddings
                      ↓ ready，管理员检索验证后启用
           knowledge_bases.active_index_version_id
                      ↓
Agent → search_knowledge → SearchService → VersionSearchService → 引用校验
```

FAQ 复用 documents 的归属、下架和引用边界，`source_type=faq`，问答维护在 `faq_entries`。FAQ 不需要文件、不执行文件 Worker、不按普通段落切分：问题用于索引，答案作为证据。

主要代码位于 `server/src/documents/`：

- `document-block.ts`：统一 Block 和来源类型。
- `knowledge-config.ts`：配置和动态边界的 Zod 校验。
- `build-chunks.ts`：分段纯函数、中文 ICU 分词。
- `knowledge-index.service.ts`：草稿、预览、快照、入队和发布。
- `build-knowledge-index.ts`：Worker 构建、向量生成和事务提交。
- `profile-embedding.ts`：向量协议、批处理、维度和端点校验。
- `embedding-profile.service.ts`：Profile 创建、列出、启停和审计。
- `version-search.service.ts`：固定查询版本、检索、父块证据展开。
- `faq.service.ts`：FAQ / CSV 验证和事务写入。
- `web/src/KnowledgeBaseAdmin.vue`：知识库操作界面。

## 关键不变量

1. 新库默认不参与问答，必须发布 ready 版本；仅开启参与问答不够。
2. 默认旧库首次发布前继续使用原索引。保存草稿不改变活动配置。
3. 构建输入在一条 SQL 的 MVCC 快照中取得；后续编辑 FAQ、重新解析文件不会改变冻结版本。
4. 同库最多一条 building 记录。Worker 使用事务锁防止同任务并行重试；失败整体回滚，标记 failed，不替换活动版本。失败后可请求新版本。
5. ready 不等于 active。原子更新活动指针即发布；启用旧 ready 版本即回退。
6. 资料／知识库下架后，旧版本也不能召回它们。重解析期间，已发布版本仍能检索原快照。
7. 查询开始固定版本 ID；Profile 快照确保文档／查询向量使用相同模型、维度。
8. 新旧 Chunk 共用 ID 序列，避免引用冲突；父子模式返回父块 ID 和父块内容，不把子块引用冒充父块证据。
9. 引用校验验证 ID 来自检索证据，不是逐句事实正确性证明。对话保留原引用快照。
10. 经济版本构建／查询不调用 Embedding；旧默认库兼容索引保留原先行为。

构建当前将整版写入放在一个事务中，适合本项目小规模数据，不适合超大批次。没有版本自动清理或精确进度百分比；后续再扩展批量提交、租约和保留策略。

## 检索与解析

- 全文：Node ICU 中文分词 + PostgreSQL simple FTS、pg_trgm 和精确子串。构建／查询须保持相同 Node/ICU 版本，升级分词运行时后重建索引。
- 文本阈值作用于模糊匹配，完整 FTS 词项命中独立进入候选。
- 向量：pgvector 精确余弦检索，暂未使用 HNSW/IVFFlat。
- 混合：词法和向量候选分别排序，再 RRF 融合。RRF 不是事实可信度，不能作为统一拒答阈值。
- 父子：仅子块可召回，父块作为完整证据；同一父块去重。
- 诊断返回候选、分数、融合排名、版本 ID、耗时及 Embedding 次数；不伪造 Token／费用。

Word 保留标题层级，位置是解析后的段落序号；PDF 以页为结构边界，不保证恢复章节布局或复杂表格。纯扫描 PDF 拒绝；混合 PDF 对无文本页面给出警告。来源范围可能覆盖完整原段落，不是精确字符偏移。

## Embedding 连接

默认使用 `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY`，Profile 填 `secretRef=default`。模型 ID、维度须与实际输出一致，不自动截断向量。

多服务商可通过部署环境注册：

```text
EMBEDDING_CONNECTIONS_JSON={"secondary":{"baseUrl":"https://your-provider.example/v1","apiKey":"<在本地填写>"}}
```

对应 Profile 填 `secretRef=secondary`，Base URL 须与连接一致。不按任意字符串读取环境变量，不把凭据发送到未批准地址，禁止 HTTP 重定向。不要提交真实密钥。

OpenAI-compatible 使用 `/embeddings`，验证批量 index 顺序；火山使用 `/embeddings/multimodal`，每个独立输入一次请求，不能将多个 Chunk 合并成一个多模态 input。

Profile 配置创建后不可变；改模型创建新 Profile 并重建。停用阻止新构建，不破坏旧版本。旧连接凭据应保留到不再使用对应版本。

## API

统一前缀 `/api/admin/knowledge-bases`，沿用 JWT 和全局 RBAC，不是逐库管理员 ACL。

| 方法 | 相对路径 | 权限 |
| --- | --- | --- |
| GET | `/`、`/:id` | documents.read 或 knowledge_bases.manage |
| POST / PATCH | `/`、`/:id` | knowledge_bases.manage |
| POST | `/:id/archive` | knowledge_bases.manage |
| PATCH | `/:id/config` | knowledge_bases.manage |
| GET | `/:id/documents`、`/:id/documents/:documentId` | documents.read |
| POST | `/:id/documents` | documents.upload |
| GET | `/:id/documents/:documentId/blocks`、`/preview`、`/file` | documents.read |
| PATCH | `/:id/documents/:documentId/archive` | documents.archive |
| POST | `/:id/documents/:documentId/reprocess`、`/retry` | documents.reprocess |
| GET / POST | `/:id/versions` | documents.read / knowledge_bases.manage |
| POST | `/:id/versions/:versionId/activate` | knowledge_bases.manage |
| GET | `/:id/search?q=...&limit=5&versionId=...` | documents.read |
| GET / POST | `/embedding-profiles` | knowledge_bases.manage |
| PATCH | `/embedding-profiles/:profileId`（enabled） | knowledge_bases.manage |
| GET / POST | `/:id/faqs` | documents.read / knowledge_bases.manage |
| PATCH | `/:id/faqs/:faqId` | knowledge_bases.manage |
| POST | `/:id/faqs/import`，body `{ "csv": "..." }` | knowledge_bases.manage |

FAQ 下架使用 documentId 对应资料下架接口，保留历史和审计。CSV 使用 csv-parse，支持引号、逗号和换行，最多 100 行／256 KB，全部通过验证后同事务写入。

## 操作顺序

创建知识库 → 上传 → 等待解析 ready → 保存分段和检索草稿 → 预览 Block/Chunk → 构建版本 → 对 ready 版本检索验证 → 启用版本 → 开启参与访客问答。

旧资料需重新解析一次生成 Block；不会自动重建旧库，也不会清空原向量。修改 FAQ／配置后重新构建和发布，不要把保存草稿当成发布。

## 验证命令

```sh
cd server
npm test
KB_INTEGRATION=1 node --env-file=../.env --test test/knowledge-base.test.mjs
npm run eval:knowledge
cd ../web
npm run build
```

集成测试／评测使用随机 schema 和事务回滚，不修改应用数据，不调用远程模型。通过本机 `.env` POSTGRES_* 连接数据库。

固定资料 `samples/eval/knowledge-v1.json` 执行真实解析、分段、PostgreSQL 建索引和检索。输出 Recall@5、MRR、证据 ID 基本校验、无证据结果和耗时。这是小规模回归基线，不评估真实 LLM 拒答／逐句引用准确率。向量协议及不同维度 SQL 由模拟向量响应加真实数据库的测试覆盖，不等于供应商模型效果评测。

### 本次验收（2026-09-22）

- npm test：68 项，67 通过，1 项数据库集成默认跳过；显式打开 KB_INTEGRATION 后该数据库测试通过。
- 通用／父子两组真实 PostgreSQL 检索评测，共 10 个小样本通过，包含无证据用例。
- 真实火山多模态 Embedding 最小请求通过，返回 2048 维；未据此声称大样本检索质量已验证。
- 前端构建和 Docker 构建通过；四项迁移已应用，本地 API 与 PostgreSQL 健康。
- 使用 Playwright 验证登录、创建知识库、上传解析、父子配置、队列构建、发布前检索、启用版本、FAQ 创建；浏览器控制台没有错误。
- 创建了独立「V1 验收 · 2026-09-22」知识库，保持关闭访客问答；原资料未修改。FAQ 是发布后新增的草稿，需再次构建才能进入索引。
- 修复了启动时发现的 ChatModule 缺少 SkillsModule 导入问题，并添加最近范围的回归测试；没有修改 Agent 核心循环。
