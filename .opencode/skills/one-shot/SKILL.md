---
name: one-shot
description: Take one bounded development request through design, implementation, independent review and verification, producing a reviewable PR handoff.
---

# One-shot development

Use this workflow for one issue or one tightly bounded request. Start by reading the repository's AGENTS.md and the current baseline documents.

1. **Scope and evidence.** Record the requested behavior, source issue or release note, affected users, constraints and what is explicitly out of scope. Inspect the exact code paths and public API on the pinned kernel. If a requirement cannot be implemented without changing original kernel code, report the gap before implementation.
2. **Design.** Write the intended behavior, integration points, data flow, failure modes and concrete acceptance checks. Spend enough time on design to remove ambiguity; do not enforce a fixed time ratio.
3. **Independent design review.** Ask a separate reviewer or model when one is actually available. Deduplicate findings, resolve blocking concerns and record decisions. If no independent reviewer is available, say so; do not invent its verdict.
4. **Implementation.** Work on a task branch. Prefer external plugins, public SDK, commands and skills. Keep the patch scoped to the issue and record meaningful progress so an interrupted run can resume.
5. **Verification.** Run relevant automated checks and exercise the actual user flow. A reviewer separate from the implementer should check the diff against the acceptance criteria when available. Log failing checks and remaining limitations.
6. **Handoff.** Prepare a PR with design, evidence, test results, unresolved issues and source links. Leave merge and release decisions to the maintainer.

The command is an interactive workflow entry, not a scheduled runner. Do not mark a requirement as verified without actual evidence.
