# Plugin integration guide v0.2

Updated: 2026-09-29

For this baseline, inspect `agent-kernel/packages/plugin/src/index.ts` for supported hooks and `agent-kernel/packages/opencode/src/plugin/index.ts` for loading behavior. Place the fixed registry in `agent-kernel-extension/src/custom-hw/extension/bundled-global-extensions.ts` and extension business logic under `agent-kernel-extension/src/codeagent/<module>/`. The public plugin bridge at `external-plugins/src/index.ts` invokes the registry. The project's one-shot skill is under `.opencode/skills/one-shot/` and is invoked by `.opencode/command/one-shot.md`.

Do not depend on `Bus`, `Session` or private `@/` aliases from an external plugin. Pin and validate the external plugin package against this exact kernel before publishing.

Change log: v0.1 establishes public API boundaries.
