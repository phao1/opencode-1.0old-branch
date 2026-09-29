# Kernel extension layer

The target design places CodeAgent-only implementation in `src/codeagent/` and the fixed registry in `src/custom-hw/extension/`. `bun run merge` copies these files into the matching paths in `agent-kernel/packages/opencode/src/`, refusing to overwrite original OpenCode files. The original v1.3.17 commit does **not** contain the described `custom-hw` global extension bootstrap. Copying files alone would not register them.

The public plugin loader instead loads `external-plugins/src/index.ts` via `.opencode/opencode.json`. That bridge imports and executes `bundledGlobalExtensions`, so the registry works on this exact baseline without editing native source. Extensions in this registry must stay within the public plugin hooks exposed by the bridge. Server route transforms and other private kernel capabilities are not available through it.
