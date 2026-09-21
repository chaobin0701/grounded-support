# MessageBus 与 Channel Adapter

第六阶段引入了一个进程内的消息边界：浏览器请求先由 Channel 转换为 `InboundMessage`，再进入 `ChatApplicationService`。应用层调用已有 `ConversationService`，因此会话归属、幂等键、恢复和数据库事务仍由原有服务负责。

`InMemoryMessageBus` 只负责运行时事件传播，不替代数据库，也不保证跨进程投递。它按注册顺序等待本地订阅者；单个订阅者失败会被记录并隔离。`publishEvent` 用于不阻塞主流程的通知。

公开事件目前包括 `message.received`、`run.started`、`message.completed` 和 `run.failed`。事件只携带回答结果和引用等必要数据，不携带 Token、密码、完整 Prompt、Provider 原始响应或内部堆栈。

未来增加 SSE、飞书或其他入口时，只需增加对应 Channel Adapter，并复用 `ChatApplicationService`。需要跨实例投递时，再将 `MessageBus` 接口替换为 Redis、NATS 等实现。
