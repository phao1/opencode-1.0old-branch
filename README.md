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
- `agent-kernel-extension/`: registered CodeAgent tools, durable one-shot runner and monitoring modules.
- `external-plugins/`: public plugin and SDK integration code.
- `.opencode/skills/one-shot/`: one-shot workflow entry using the durable runner.
- `.opencode/command/one-shot.md`: command entry for that workflow.
- `docs/baseline/`: target behavior and architecture decisions.
- `sdk/js-agentkernel/`, `codecov/`, `test/`, `agents/`, `scripts/`: SDK, coverage support, tests, agent roles and scripts.

## Current state

The registered `capability_watch` tool checks stable Claude Code and Codex GitHub releases. Its first call records the current versions as a baseline; later calls return new releases with source links and notes. The cursor is stored locally in `.codeagent/capability-watch.json` and is not committed. Use `/watch-capabilities` to ask OpenCode for an issue-oriented summary.

Run `npm test` and `npm run typecheck` for the extension and monitoring code. From `external-plugins/`, `bun run build` produces a standalone plugin bundle in `dist/`. From `agent-kernel-extension/`, `bun run merge` copies CodeAgent-owned files into the submodule, `bun run serve` starts the development server with the workspace plugin configuration, and `bun run kernel:build` builds the kernel package. Install Bun and the kernel's dependencies for the latter two commands. The development server runs from the kernel package directory; attach a client with the workspace directory when editing the wrapper.

## One-shot automation

The framework now supports scheduled release/file/command/GitHub intake, deduplicated candidate issues, trusted todo execution, saved design, parallel design reviews, isolated Git worktrees, independent command-backed evaluation, bounded repairs and optional draft PR publication. Each stage persists its result; operator acceptance is explicit.

Start with [one-shot.config.example.json](one-shot.config.example.json) and the [setup and adapter guide](docs/plugin-guide.md#one-shot-framework). Copy the example to one-shot.config.json, select available OpenCode models, set task-appropriate verification commands, then run:

```bash
npm run one-shot -- worker
```

Use /create-issue and /one-shot in OpenCode, or npm run one-shot -- help for CLI control. Runtime requires Node 24+, Git, an authenticated OpenCode server or a protocol-compatible command adapter, and task dependencies. Optional PR publication also requires authenticated git and gh. Example roles use the server's default model unless you configure distinct models.

The [Spec v0.5](docs/baseline/SPEC.md) and [design](docs/baseline/DESIGN.md) define the framework scope. Cross-session messaging is a sample product feature from the source material and is outside this implementation. Tests use deterministic agent responses and real Git/command execution; they do not certify a real model's quality. Configure and exercise an actual provider before unattended production use.

## Source monitoring and macOS test packages

The one-shot example configuration now also scans Codex, Pi and upstream OpenCode source commits. Evidence contains actual diff/file contents with bounded omissions, and analysis creates candidate issues without upgrading the pinned kernel. See `docs/plugin-guide.md`.

macOS CLI portable packages (native opencode + external plugin + worker, Apple Silicon arm64 and Intel x64) are built by `.github/workflows/macos-test-package.yml` for dev/PR/manual runs and retained as Actions artifacts for 30 days after successful smoke verification. Download/setup instructions: `docs/test-package.md`. Local native build: `npm run package:test`. A standalone binary does not contain the external workflow plugin; keep the package together and use the launcher. Release archival is manual.
