# AGENT.MD

This file provides guidance to CodeAgent when working with code in this repository.

## Overview

This is CodeAgentPlugin - an extension project that builds on top of OpenCode (agent-kernel) to provide CodeAgent functionality. The repository consists of three main components:

agent-kernel - Git submodule containing the OpenCode AI coding agent (core kernel)
agent-kernel-extension - Global extensions and built-in plugins that merge into agent-kernel
external-plugins - External plugin system using the @opencode-ai/plugin API

## 本仓库当前实际状态（2026-11-04 核实）

以下是当前执行依据；后文逐字保留的原始说明（仅修正 Markdown 格式）包含尚未复刻的目标架构与历史命令，不能据此认定能力已存在或直接执行旧命令。

- **底座与来源**：原文描述的三层目录在用户最初的仓库中并不存在；已决定以 OpenCode 1.3.17 源码为底座，缺的部分按需复刻补齐。`agent-kernel/` 是只读 submodule，固定在 `517e6c9aa4c61dbc125e7654fc596f1d529f20d9`（`517e6c9aa`，官方 v1.3.17 发布提交）。submodule URL 与本仓库 origin 相同，属于自引用；初始化只用 `git submodule update --init`，**不要用 `--remote`**，不要执行下方历史命令中的远端更新。
- **现有扩展**：`agent-kernel-extension/` 包含 capability-watch、遗留 one-shot worker 两个扩展及 registry，经外置插件公开 loader 的桥接加载。没有原文中的 Init/Server/InternalPlugins/Permission/Tool 五扩展，没有 `kernel/` ACL 层，也没有 GlobalConfig。当前 merge 脚本仅在 `src/custom-hw/`、`src/codeagent/` 下新增带 generated marker 的文件或更新已有同标记文件，不覆盖内核原文件；复制本身不构成 bootstrap。
- **外置与占位目录**：`external-plugins/` 包含 steering 等外置插件；`external-plugins/src/index.ts` 是聚合桥接入口，也是唯一允许 import `agent-kernel-extension` 的外置文件。`sdk/`、`codecov/`、`agents/` 仅占位，不代表原文所述 SDK、Jest mocks 或 agent 能力已经存在。
- **实际可用命令**：测试使用 `node --test …`（完整参数以 `package.json` 的 `test` 脚本为准）；类型检查为 `node_modules/.bin/tsc --noEmit -p .`；内核边界检查为 `node scripts/check-kernel.mjs`。Bun 1.3.11 在 `~/.bun/bin`。原文中的 Jest、`bun run serve` 和 merge preinstall 尚未复刻，**不要执行**。
- **one-shot 入口**：主流程是 Codex skill `.agents/skills/one-shot/`，设计见 `docs/oneshot/ONE-SHOT-SKILL-DESIGN.md`。`.opencode/skills/one-shot` 与 `agent-kernel-extension/src/codeagent/one-shot` 是遗留的 OpenCode 托管 issue 队列 worker，对应参考流程的“编排层扩展方向”，可选使用。one-shot 不自动合并或发布；PR 与验证证据交由人工评审。
- **硬边界**：不修改 `agent-kernel/` tracked 源码，尤其是 `agent-kernel/packages/` 原文件；不从外置插件 import 内核私有模块。需要内部扩展点时，先证明固定版本确实暴露该入口，否则记录缺口并停止该实现路径。未验证实际 bootstrap，不得声称复制的代码已激活。
- **当前工作流**：编码前写验收标准并核对 v1.3.17 的精确 API；优先在 `external-plugins/` 或项目 skill/command 中做最小实现；运行相关测试与真实 OpenCode smoke test；设计和验证证据保存在 `docs/baseline/`。

## 编码准则

请参考如下准则，引自：https://github.com/forrestchang/andrej-karpathy-skills/blob/main/CLAUDE.md?plain=1


Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
[Step] → verify: [check]
[Step] → verify: [check]
[Step] → verify: [check]

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Development Commands

```sh
# Initial setup - sync agent-kernel submodule (required before any development)
git submodule sync && git submodule init && git submodule update --remote

# Install dependencies
bun install                          # root level
cd agent-kernel-extension && bun install   # also runs merge via preinstall
cd external-plugins && bun install

# Run the server (merges code, then starts opencode)
cd agent-kernel-extension && bun run serve

# Run tests — two runners exist in this repo (see Testing below)
bun test                                                       # bun:test, from repo root
bun test test/path/to/test.test.ts                             # single test file, from repo root
bun run jtest                                                  # Jest with coverage (see jest.config.ts)

# Type check
cd external-plugins && bun run typecheck                    # external-plugins (standalone)
cd agent-kernel-extension && bun tsc --noEmit               # extension only (no merge needed)
cd agent-kernel-extension && bun run merge && cd ../agent-kernel && bun run typecheck  # full type check after merge
```

## Testing

Test files are *.test.ts in each package's test/ dir, written with bun:test imports. The repo has two runners — know which you are using:

bun test (root bunfig.toml): canonical for local dev. pathIgnorePatterns skips agent-kernel/** and sdk/js-agentkernel/**; concurrent = false, retry = 3. agent-kernel-extension/bunfig.toml is the per-package config for cd agent-kernel-extension && bun test — when editing coverage/ignore config, update both bunfig files if the change should apply in both contexts.
bun run jtest (jest.config.ts): Jest via ts-jest, used for coverage reporting. Mocks Bun/vitest/@/global via codecov/test/mocks/; @/ resolves to extension or kernel src/. Note: single-file Jest runs can break on the ESM node:path mock — prefer bun test for a single file.
Every test file sets up its own top-of-file mock.module() calls.

## Architecture

### Repository Structure

Top-level: agent-kernel/ (submodule, DO NOT EDIT DIRECTLY), agent-kernel-extension/ (CodeAgent code under src/codeagent/), external-plugins/, codecov/ (Jest-only mocks), sdk/. Use ls for the live tree — src/codeagent/ holds many self-contained subsystems (server, internal-plugins, cron, smart-router, auto-router, checkpoint, turbocontext, sdd, evolve, …) that change often, so don't enumerate them here.

### Merge Process (merge-agent-kernel.ts)

agent-kernel-extension/scripts/merge-agent-kernel.ts runs on preinstall/merge/serve. It:

Merges dependencies external-plugins/package.json → agent-kernel-extension/package.json → agent-kernel/packages/opencode/package.json.
Copies agent-kernel-extension/src/ → agent-kernel/packages/opencode/src/ (CodeAgent code lands in src/codeagent/).
Copies migration scripts → agent-kernel/packages/opencode/migration/, merges script/ → opencode/script/, and merges the js-agentkernel-luban SDK → agent-kernel/packages/sdk/js-agentkernel.
Because the merge overwrites agent-kernel/packages/opencode/src/, never edit merged output there — edit in agent-kernel-extension/src/ and type-check in place (bun tsc --noEmit) or after a merge.

### Global Extension Entry Points

Extensions register in agent-kernel/packages/opencode/src/custom-hw/extension/bundled-global-extensions.ts as bundledGlobalExtensions (this path is fixed by the build; do not rename). The array wires, in order: InitExtension, ServerExtension (HTTP routes), InternalPluginsExtension (pushes built-in plugins by priority), PermissionExtension, ToolExtension. Extension points: transformServer / transformInstanceRoutes / transformInternalPlugins / transformPermissionService / transformToolDef.

## Plugin Implementation Conventions

### 外置插件优先 (external-first)

新功能优先在 external-plugins/ 实现（@opencode-ai/plugin Hooks 模式）。外置插件通过 SDK client 与内核交互，不依赖内核内部，内核升级时几乎零成本，且可独立构建发布。

仅当功能确需 SDK 无法满足的能力时，才用内置插件（agent-kernel-extension/src/codeagent/）：进程内直接调用内核服务、注册全局路由、注册内置 plugin、性能敏感的原生调用。选用内置插件必须在对应设计文档中说明理由（为何 SDK 方案不可行）。外置插件的硬性限制：只能用 SDK client，不能访问 Bus/GlobalBus、Session/SessionStatus 等原生类或任何 agent-kernel 内部 API。

### 内置插件的内核依赖隔离 (ACL)

原则：业务代码不直接 @/ import 内核内部（agent-kernel 子模块），一切内核依赖必须经防腐层。内核是易变上游，直接 import 会让每次升级穿透到上百个业务文件；隔离的目的是把升级破坏收口到少数适配器文件。

每个内置插件模块（src/codeagent/<module>/）自建自己的 kernel/ 防腐层，业务代码只从自己的 <module>/kernel 导入;

## Key Conventions

Path aliases (@/, @opencode-ai/sdk/*, @opencode-ai/plugin, test mocks like @/global→mock) are declared in each package's tsconfig.json / package.json — read those for the authoritative list.
Business logic placement: CodeAgent-specific code goes in src/codeagent/ to avoid conflicts with the opencode base.
Configuration: GlobalConfig (src/codeagent/global/config.ts) holds global state; env vars include CODEAGENT_LANGUAGE, CODEAGENT_CURRENT_USER, CODEAGENT_ENV, SCENARIO. External-plugins config loads via loadPluginConfig(); hooks/tools can be disabled via disabled_hooks / disabled_tools.
Style: enforced by Prettier (semi: false, printWidth: 120, root package.json); see AGENTS.md for the full style guide (prefer .catch()/Effect over try/catch, avoid any, single-word var names, early returns over else, const over let).

## Design Documents

Design docs live in docs/ (e.g. docs/plugin-guide.md, docs/cron/, docs/auto-router/, docs/baseline/).
Always modify existing design documents rather than creating new ones. Use version numbers in headers (e.g. v4.0), include update date + change log at the end, and follow the existing format.
Per AGENTS.md: after new features, sync docs/baseline/SPEC.md and docs/baseline/DESIGN.md; before a release, review README.md and update CHANGELOG.md.

## Key Files to Reference

docs/plugin-guide.md - Complete OpenCode plugin development guide (hooks, events, tools)
agent-kernel-extension/CLAUDE.md - Extension-specific development guide
external-plugins/CLAUDE.md - External plugin development guide with mock module patterns
agent-kernel-extension/src/codeagent/server/index.ts - Main server extension entry
agent-kernel-extension/src/codeagent/internal-plugins/index.ts - Built-in plugins registration
agent-kernel-extension/src/codeagent/kernel/ - Kernel anti-corruption layer (see ACL convention above)
external-plugins/src/index.ts - External plugin entry point
external-plugins/src/hooks/types.ts - Hook type definitions (HookName, InternalHookName)
