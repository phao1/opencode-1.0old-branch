# CodeAgentPlugin development rules

## Repository layout

- `agent-kernel/` is a Git submodule pinned to OpenCode v1.3.17 (517e6c9aa4c61dbc125e7654fc596f1d529f20d9). Never edit its tracked source.
- `external-plugins/` is the first choice for behavior added through the public `@opencode-ai/plugin` API, SDK, skills and commands.
- `agent-kernel-extension/src/custom-hw/extension/` holds the fixed extension registry; business modules belong under `src/codeagent/`. The public plugin bridge loads that registry on this baseline.
- `sdk/js-agentkernel/`, `codecov/`, `agents/` and `test/` are reserved for their named responsibilities.

## Hard boundary

Do not edit original files under `agent-kernel/packages/`. The merge script may only add or update files bearing its generated marker under `src/custom-hw/` and `src/codeagent/`. Do not import the kernel's private modules from external plugins. If an idea requires an internal extension point, first prove that the pinned kernel exposes one; otherwise document the gap and stop that implementation path. Do not claim a copied file is activated unless an actual bootstrap path has been verified.

## Workflow

1. Write acceptance criteria and inspect the exact v1.3.17 API before coding.
2. Implement the smallest change in `external-plugins/` or a project skill/command.
3. Run the relevant tests and a real OpenCode smoke test.
4. Keep design and verification evidence in `docs/baseline/`.

Do not auto-merge or publish a release from a one-shot run. A PR and its evidence are the handoff for review.
