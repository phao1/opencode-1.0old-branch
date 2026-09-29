# CodeAgentPlugin

A wrapper workspace for developing CodeAgent behavior against a **fixed, unmodified OpenCode v1.3.17 kernel**. Development happens on this repository's `dev` branch. The kernel lives in a submodule that points to commit [517e6c9aa4c61dbc125e7654fc596f1d529f20d9](https://github.com/phao1/opencode-1.0old-branch/commit/517e6c9aa4c61dbc125e7654fc596f1d529f20d9).

## Get started

```bash
git clone --branch dev https://github.com/phao1/opencode-1.0old-branch.git CodeAgentPlugin
cd CodeAgentPlugin
git submodule update --init
node scripts/check-kernel.mjs
```

The submodule URL intentionally refers to this same repository: the pinned commit contains the historical OpenCode source tree, while `dev` contains this wrapper. Do not run `git submodule update --remote`, which would move away from the fixed baseline.

## Structure

- `agent-kernel/`: source baseline, Git submodule, read-only.
- `agent-kernel-extension/`: reserved CodeAgent extension layer; internal wiring needs a separately verified kernel extension point.
- `external-plugins/`: public plugin and SDK integration code.
- `.opencode/skills/one-shot/`: interactive one-shot workflow specification.
- `.opencode/command/one-shot.md`: command entry for that workflow.
- `docs/baseline/`: target behavior and architecture decisions.
- `sdk/js-agentkernel/`, `codecov/`, `test/`, `agents/`, `scripts/`: SDK, coverage support, tests, agent roles and scripts.

## Current state

This commit establishes the workspace and a reviewable one-shot workflow. It does **not** yet implement the scheduled Claude Code/Codex release monitor, autonomous issue runner, internal extension bootstrap, or the existing CodeAgent subsystems listed in the proposed architecture. Those require separate implementation and verification.
