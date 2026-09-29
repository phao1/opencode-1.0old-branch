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

The registered `capability_watch` tool checks stable Claude Code and Codex GitHub releases. Its first call records the current versions as a baseline; later calls return new releases with source links and notes. The cursor is stored locally in `.codeagent/capability-watch.json` and is not committed. Use `/watch-capabilities` to ask OpenCode for an issue-oriented summary.

Run `npm test` and `npm run typecheck` for the extension and monitoring code. From `external-plugins/`, `bun run build` produces a standalone plugin bundle in `dist/`. From `agent-kernel-extension/`, `bun run merge` copies CodeAgent-owned files into the submodule, `bun run serve` starts the development server with the workspace plugin configuration, and `bun run kernel:build` builds the kernel package. Install Bun and the kernel's dependencies for the latter two commands. The development server runs from the kernel package directory; attach a client with the workspace directory when editing the wrapper.

This is not yet a scheduled watcher or an autonomous issue-to-PR runner. The existing CodeAgent subsystems in the proposed architecture have not been imported into this repository.
