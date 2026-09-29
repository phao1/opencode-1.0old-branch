# Plugin source

`index.ts` bridges the fixed global extension registry to the public OpenCode plugin loader. Keep plugin-specific integrations here; the registered capability-watch business logic lives in `agent-kernel-extension/src/codeagent/capability-watch/`.
