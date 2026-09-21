# Agent Runtime

This directory owns one bounded Agent execution. `AgentLoop` performs one model decision and optional tool execution; `AgentRunner` creates per-run state, enforces the loop limit, and returns a normalized `AgentResult`.

The runtime must not access HTTP, PostgreSQL, cookies, conversations, or controllers. It communicates with models through `LlmService` and executes capabilities through `ToolExecutionService`. Chat services adapt its result to persistence and transport concerns.
