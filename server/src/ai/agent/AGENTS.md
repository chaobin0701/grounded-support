# Agent Runtime

This directory owns one bounded Agent execution. `AgentLoop` performs one model decision and optional tool execution; `AgentRunner` creates per-run state, enforces the loop limit, and returns a normalized `AgentResult`.

The runtime must not access HTTP, PostgreSQL, cookies, conversations, or controllers. It communicates with models through `LlmService` and executes capabilities through `ToolExecutionService`. Chat services adapt its result to persistence and transport concerns.

Native tool batches are sequential and lossless: keep every model-provided call ID and pair it with a result. Independent calls, including different product IDs for the same detail tool, share one planning round. A successful guidance-changing tool may require replanning before subsequent calls; return explicit deferred results instead of slicing or silently dropping the batch tail. Deferred calls do not consume execution budget or enter duplicate history, and still pass policy/input checks.

Runtime context contributions are explicit, typed business data, never instructions. Model tools and passive/host preload share contribution records, but passive data must not fabricate native assistant/tool messages. Conversation persistence and freshness/visibility checks remain in the chat/document adapters; the runtime receives only bounded validated resources. Historic tool bodies are projected to current resource references so disabled or invalid memory cannot leak back through transcript replay. Restored resources do not consume tool execution budget or create artificial execution events.
