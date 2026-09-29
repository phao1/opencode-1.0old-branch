# CodeAgentPlugin architecture v0.1

Updated: 2026-09-29

## Ownership

`agent-kernel/` is the unmodified upstream baseline. `external-plugins/` owns public hook and SDK extensions. `agent-kernel-extension/` is a reserved internal layer, gated on proof of a working extension point. The one-shot skill is a project-level workflow entry, while a future runner will own durable state and schedules.

## Intended flow

Release source -> normalized change with URL/version -> impact assessment -> candidate issue -> selected one-shot run -> design/review -> isolated implementation -> verification -> PR.

## Known gap

The pinned kernel has a plugin loader and skill discovery, but does not contain the `custom-hw/extension/bundled-global-extensions.ts` path described in the prior AGENTS.md. A file merge into `src/codeagent/` cannot by itself activate an internal plugin. No merge script is enabled until the bootstrap is verified without altering original source.

## Repository choice

The `dev` branch of `phao1/opencode-1.0old-branch` is the wrapper; its `agent-kernel` submodule points back to the same repository at a fixed historical commit. This allows one GitHub repository while keeping wrapper files separate from the original kernel tree by branch.

Change log: v0.1 records the actual target layout and bootstrap limitation.
