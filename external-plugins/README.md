# External plugins

Implement hooks and tools through the public `@opencode-ai/plugin` API. Use the SDK client supplied to a plugin; never import `agent-kernel/packages/opencode/src` internals. `src/index.ts` is the plugin bridge that executes the fixed global extension registry. `bun run build` bundles the registry and business code into `dist/index.js`; the public plugin package remains a peer dependency.

The one-shot command and skill live under the workspace's `.opencode/` directory. The release check is an on-demand tool; a scheduled release monitor and durable issue runner will be separate processes, rather than timers hidden in a plugin session.

Steering v2 lives in the independent [`steering/`](steering/README.md) package. The aggregate entry imports its source and composes tools/events with the extension registry. Install the aggregate or standalone package once. The old disk ledger and its default tests are retired; run `node scripts/verify-steering.mjs` for installed-artifact deterministic verification and `scripts/steering-v2-demo.mjs` for real model/TUI controls.

The aggregate plugin forwards its second options argument to Steering (including `autoResume:false`); extension/worker configuration remains independent. Round 2 fixes preserve slow-save candidates, await shared gate queries, track successful compaction coverage, and clear settled state at successful idle boundaries.
