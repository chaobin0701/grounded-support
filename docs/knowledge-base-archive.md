# 知识库归档

- `POST /api/admin/knowledge-bases/:id/archive` 需要 `knowledge_bases.manage`，默认库和普通库使用同样的确认、权限及归档规则。
- 归档在同一事务中设置 `archived_at`、关闭 `enabled_for_chat` 并写入审计日志；不会删除文档、原文件、分段、索引版本，也不会迁移资料或自动创建替代库。
- `is_default` 是旧文档接口的兼容标识，不是归档豁免。归档后保留该标识及唯一性；旧接口未指定知识库时不再接受上传，需在活动知识库中明确上传。
- 活动列表默认隐藏归档库，打开“显示已归档”后可查看保留的内容。访客及版本检索排除归档库。
- 需执行迁移 `0025_allow_default_knowledge_archive.sql`，仅移除旧的默认库归档限制，不改变现有知识库状态。
- 验证：`server npm test`；设置 `KB_INTEGRATION=1` 后运行 `server/test/knowledge-base.test.mjs`，可在随机 schema 的回滚事务内验证归档、数据保留和检索边界。
