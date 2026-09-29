# Kernel extension layer

The target design places CodeAgent-only implementation in `src/codeagent/` and merges it into `agent-kernel/packages/opencode/src/codeagent/` for a build. The original v1.3.17 commit does **not** contain the described `custom-hw` global extension bootstrap. Copying files alone would not register them.

No automatic merge or internal plugin registration is supplied yet. Prefer `external-plugins/` and the public SDK. Before adding an internal extension, document the missing public API, the actual bootstrap path, and how to avoid changes to original OpenCode files.
