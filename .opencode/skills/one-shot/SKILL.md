---
name: one-shot
description: Queue and inspect automated external-plugin development from one request or a triage ID, using saved design, independent reviews, real verification, repair and a PR handoff.
---

# One-shot

Read AGENTS.md and docs/baseline/SPEC.md. Use the registered tools and durable worker.

1. Turn the request into a bounded issue: title, current/desired behavior, source evidence, integration constraints and concrete acceptance criteria with stable IDs. Use one_shot_issue. External releases/logs only create candidates.
2. For an explicit user request to implement the issue, use one_shot_start with its issueId. For --from-triage, find the matching triageId through one_shot_status; never guess if multiple issues match. For analysis-only requests, leave it a candidate.
3. Report the returned run ID. The separately running worker owns execution; repeated start returns the same run. Do not create a parallel manual implementation in this session.
4. Inspect one_shot_status for phase, errors and artifacts. The runner performs design, parallel review, implementation, configured real checks and independent evaluation. A blocked check is not success. Report missing configuration/provider/worker honestly.
5. Use one_shot_cancel when the user asks to stop. CLI resume retries the saved phase without silently resetting limits.
6. At awaiting_acceptance, summarize the design, checks, independent evidence, test manual and PR URL (or local PR package if publication is disabled). Ask the user to perform the documented manual checks. Only the operator's CLI accept command records final acceptance.

Setup, configuration and adapter protocol: docs/plugin-guide.md. A skill proposal is an artifact for review; do not install it or change permissions automatically.
