# External plugins

Implement hooks and tools through the public `@opencode-ai/plugin` API. Use the SDK client supplied to a plugin; never import `agent-kernel/packages/opencode/src` internals. `src/index.ts` is the plugin bridge that executes the fixed global extension registry. `bun run build` bundles the registry and business code into `dist/index.js`; the public plugin package remains a peer dependency.

The one-shot command and skill live under the workspace's `.opencode/` directory. The release check is an on-demand tool; a scheduled release monitor and durable issue runner will be separate processes, rather than timers hidden in a plugin session.
