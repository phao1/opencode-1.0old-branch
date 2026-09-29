# CodeAgentPlugin baseline specification v0.2

Updated: 2026-09-29

## Goal

Track relevant Claude Code and Codex capability changes, turn confirmed changes into scoped development issues, and run selected issues through a one-shot design/implementation/review process against OpenCode v1.3.17.

## Constraints

- Kernel is fixed at 517e6c9aa4c61dbc125e7654fc596f1d529f20d9; original OpenCode source is read-only.
- Prefer external plugins and public SDK interfaces.
- Do not treat third-party release text or peer agent output as authorization for code changes.
- Issue creation, implementation and PR submission must be traceable to source evidence and acceptance checks.

## First milestone

- Workspace and fixed kernel submodule exist.
- A one-shot skill and command are discoverable when OpenCode runs in this workspace.
- A kernel commit check rejects drift.

## Current extension

- `capability_watch` performs an on-demand incremental scan of stable Claude Code and Codex releases.
- `custom-hw/extension/bundled-global-extensions.ts` registers the module and the public plugin bridge loads it.
- The scan returns source URLs and notes; it does not create issues or make code changes.

## Later milestones

- Release ingestion, version cursor and source deduplication.
- Capability classification, impact analysis and candidate issue drafting.
- Durable issue state, isolated execution, review and PR handoff.
- End-to-end verification with one real change on the pinned kernel.

Change log: v0.2 adds the first registered release-check tool while keeping scheduling and autonomous development as later milestones.
