# AI Provider 层说明

本目录是模型服务适配层，负责把业务系统的统一模型请求转换为具体供应商的 API 请求，并把供应商响应转换为项目内部格式。

## 目录职责

Provider 只负责：

- 发送模型请求；
- 转换消息、工具定义和模型参数；
- 解析文本、Tool Call、完成原因和 Token 用量；
- 记录请求耗时；
- 将供应商错误转换为项目统一错误。

Provider 不负责：

- 判断是否需要检索；
- 选择或执行业务工具；
- 拼接完整业务 Prompt；
- 管理会话、上下文或聊天记录；
- 校验客服答案是否有资料依据。

## 文件说明

### `llm-provider.ts`

定义 `LlmProvider` 接口和依赖注入令牌 `LLM_PROVIDER`。

上层只依赖这个接口，不应该依赖具体厂商实现。

### `provider.types.ts`

定义 Provider 层的统一数据结构：

- `LlmMessage`：模型消息；
- `LlmRequest`：模型请求；
- `LlmResponse`：模型响应；
- `LlmStreamEvent`：原生 SSE 流中的文本增量和完成事件；
- `LlmToolDefinition`：工具定义；
- `LlmToolCall`：模型返回的工具调用；
- `LlmResponseFormat`：结构化输出契约，由 Provider 映射为供应商的 `response_format`；
- `LlmUsage`：输入、输出和总 Token。

如果不同模型供应商的字段不同，应在 Provider 内部转换，不要把供应商字段泄露到这些公共类型中。

### `openai-compatible.provider.ts`

当前的 OpenAI-compatible Provider 实现。

它用于连接火山方舟等兼容 `/chat/completions` 协议的服务，负责：

- 接收配置层传入的 API Key、Base URL、模型和超时；
- 转换消息和工具定义；
- 映射结构化 JSON 输出请求，并按兼容模式处理不支持该参数的端点；
- 解析文本与标准 Tool Call；
- 解析 Token 用量和完成原因；
- 将模型原生 SSE 转换为统一的文本增量事件；
- 计算请求耗时；
- 处理超时、限流、认证失败和无效响应。

当前支持的模型由 `SUPPORTED_LLM_MODELS` 限制。增加模型前，应先确认接口协议、响应结构和安全限制。

Provider 不直接读取 `process.env`。环境变量由 `config/` 中的 `AppConfigService` 校验，Provider 实例由 `provider-registry.ts` 创建。

### `provider-registry.ts`

根据 `LLM_PROVIDER` 创建统一的 `LlmProvider`。当前只注册 `openai-compatible`，未来增加 Provider 时应在 Registry 中增加清晰的工厂映射，不把选择逻辑散落到业务服务中。

### `provider-errors.ts`

定义统一 Provider 错误：

- `ProviderAuthenticationError`：密钥无效或无权限；
- `ProviderRateLimitError`：请求频率或额度受限；
- `ProviderTimeoutError`：请求超时；
- `ProviderContextLengthError`：上下文长度超限；
- `ProviderModelNotFoundError`：模型不存在或未开通；
- `ProviderUnavailableError`：服务暂时不可用；
- `ProviderInvalidResponseError`：响应格式不符合预期。
- `ProviderUnsupportedResponseFormatError`：端点不支持请求的结构化输出格式。

上层应根据错误类型决定是否重试或向用户返回统一提示，不要解析供应商的原始错误 JSON。

## 扩展规则

新增 Provider 时：

1. 实现 `LlmProvider` 接口；
2. 复用 `provider.types.ts` 的统一类型；
3. 将供应商原始错误转换为 `provider-errors.ts` 中的错误；
4. 不记录 API Key、Authorization、完整请求体或供应商原始响应；
5. 为正常响应、Tool Call、Token 用量、超时和错误映射添加测试；
6. 在 `ai.module.ts` 中注册实现，或者通过配置选择实现。

不要在 Provider 中加入 Agent 循环、知识库检索、MCP 执行或答案校验。这些属于上层应用模块。
