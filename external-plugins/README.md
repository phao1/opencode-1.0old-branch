# External plugins

Implement hooks and tools through the public `@opencode-ai/plugin` API. Use the SDK client supplied to a plugin; never import `agent-kernel/packages/opencode/src` internals. This package is reserved for the first concrete plugin and currently has no publishable entry point.

The one-shot command and skill live under the workspace's `.opencode/` directory because they can work without a plugin. The scheduled release monitor and durable issue runner will be separate processes, rather than timers hidden in a plugin session.
