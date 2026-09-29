# CodeAgentPlugin architecture v0.2

Updated: 2026-09-29

## Ownership

`agent-kernel/` is the unmodified upstream baseline. `external-plugins/` owns public hook and SDK extensions. `agent-kernel-extension/` is a reserved internal layer, gated on proof of a working extension point. The one-shot skill is a project-level workflow entry, while a future runner will own durable state and schedules.

## Intended flow

Release source -> normalized change with URL/version -> impact assessment -> candidate issue -> selected one-shot run -> design/review -> isolated implementation -> verification -> PR.

## Known gap

The pinned kernel has a plugin loader and skill discovery, but does not contain the `custom-hw/extension/bundled-global-extensions.ts` bootstrap described in the prior AGENTS.md. `agent-kernel-extension/src/custom-hw/extension/` now holds the registry; the merge script puts it at the requested kernel path. The native kernel does not invoke it. `.opencode/opencode.json` loads `external-plugins/src/index.ts`, whose public plugin entry invokes that same registry and exposes its tools. This supports public hooks and tools, not private server route transforms.

The first registered module is `codeagent/capability-watch`. Its tool polls the official GitHub release APIs, filters draft/prerelease entries, and persists per-source version cursors only after both requests succeed. The first scan establishes a baseline. Subsequent scans return new release notes and a gap warning if the last cursor falls outside the latest 30 entries.

## Repository choice

The `dev` branch of `phao1/opencode-1.0old-branch` is the wrapper; its `agent-kernel` submodule points back to the same repository at a fixed historical commit. This allows one GitHub repository while keeping wrapper files separate from the original kernel tree by branch.

Change log: v0.2 adds a public plugin bridge, fixed registry, safe merge and capability-watch tool; the native bootstrap limitation remains.
