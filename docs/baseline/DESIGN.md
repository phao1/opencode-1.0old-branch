# CodeAgentPlugin architecture v0.3

Updated: 2026-09-29. Requirement IDs and acceptance gates are in SPEC.md.

## Integration boundary

The dev branch is the wrapper. agent-kernel/ is pinned to 517e6c9aa4c61dbc125e7654fc596f1d529f20d9; native tracked source remains read-only. agent-kernel-extension/src/custom-hw/extension/bundled-global-extensions.ts is the fixed registry, with business modules in src/codeagent/. Merge only creates or replaces marked CodeAgent-owned paths. The native baseline has no custom-hw bootstrap: external-plugins/src/index.ts is loaded via .opencode/opencode.json and invokes the registry through the verified public plugin API. Copying files into the kernel does not activate private routes.

| Directory | Responsibility |
| --- | --- |
| .opencode/skills/one-shot/ and future create-issue/triage/review skills | Interaction contract and typed handoff schemas; no durable scheduling. |
| agent-kernel-extension/src/codeagent/capability-watch/ | Release intelligence tool adapter. |
| agent-kernel-extension/src/codeagent/one-shot/ | Start/status/resume commands and plugin events for the runner. |
| agent-kernel-extension/src/codeagent/cross-session/ | Named peer tools and events; enforce security in the broker too. |
| services/release-intel/ | Scheduler, durable evidence, source/code diff and repeatable performance analysis. |
| services/issue-loop/ | Signal intake, dedup, triage, schedules and authenticated status transitions. |
| services/one-shot-runner/ | Persistent jobs, workspace leases, agent execution, evaluator and PR handoff. |
| services/cross-session-broker/ | Local IPC, credential helper, policy, bounded queue and receipts. |
| external-plugins/ | Publishable public hook bridge; no private kernel imports. |
| docs/baseline/ and test/ | Requirements, decisions, fixtures and integration evidence. |

The service directories and additional adapters are target locations, not current features. Verify the exact kernel API for each integration. If a private extension point is absent, use a public SDK path or sidecar and record blocked capability explicitly.

## Release intelligence and issue loop

Persist an intake record with source type, URL, version, observation time, hash, evidence, handoff ID, dedup key and trust level. The scheduler checkpoints per-source cursors/pages and backfills missing ranges; repeated triggers are idempotent. A release analysis compares a pinned version pair, identifies exact observed changes, records inaccessible material, and checks relevance to this project. Benchmark reports retain raw samples and test environment.

Logs, feedback and nightly bug scans feed the same candidate schema with stable handoff IDs. After successful work, a proposed reusable skill has its own version, input/output contract, provenance and review before other loops can call it. Candidates cannot make themselves todo. A maintainer action or explicitly configured automation policy promotes one to todo. Validate webhook signature, repository, installation and delivery ID; poll as recovery for a missed webhook. Record actor and policy. Issue text never grants itself permission.

## Durable one-shot state machine

Persist issue, design revision, model invocations, workspace/branch lease, acceptance criteria, reviewer findings, evaluator evidence, logs, PR URL and retry count. Atomically claim a unique (repository, issue, todo transition) key. Renew the lease; after worker failure, recover an expired lease from a checkpoint. One reusable checkout/directory has one active job; concurrency and cost/time limits are configurable.

| State | Exit evidence |
| --- | --- |
| candidate / todo | Provenance and trusted transition; unique job claim. |
| claimed / designing | Workspace lease, inspected API, saved design and acceptance criteria. |
| design_review | Concurrent attributable findings, revised design and resolved blockers. |
| implementing | Scoped commits and resumable progress checkpoint. |
| verifying | Automated checks and independent real behavior evaluation for each criterion. |
| code_review | Optional parallel reviews and bounded fix/recheck iterations. |
| pr_ready / human_acceptance | Draft PR, test guide, design, logs and known limitations. |
| blocked / failed / cancelled | Explicit reason, checkpoint and safe retry/cancel policy. |

The evaluator has a separate context from the implementer. UI checks use real browser actions; API, database and CLI checks inspect observable effects. For example, a rectangular fill criterion checks all covered cells, including interior cells. Store criterion-level evidence. Review iterations preserve findings and prompt versions. Sprint contracts, context resets and evaluation rounds are configurable and are changed using measured quality/cost data, not assumptions about a model generation. Provider fallback resumes from durable state and records lost context.

With authorized GitHub writes, publish one branch and one draft PR, idempotently attaching the design, evidence and test manual. Missing credentials yield a blocked state and a local PR package. Merge and release remain human decisions.

## Cross-session transport and trust

Opt-in same-host transport on macOS/Linux uses private directories and per-session Unix sockets. Discovery advertises user-facing name and opaque instance ID; names can collide and are not identity. A native helper must obtain peer credentials using supported OS facilities, validate UID and socket ownership, and fail closed if unavailable. Windows requires separately proven equivalent verification and is initially disabled. Verified PID is provenance only: PIDs are recycled and relays identify themselves.

Validate bounded NDJSON frames, strict schema, exact canonical envelope serialization, unique message/route IDs, TTL, payload limits and hop evidence. Keys for authenticated hops are scoped to local broker/session, protected and rotated; test forged/replayed hops and cycles. Attachments remain metadata until inbound policy accepts. Refuse before writing destination files.

Effective policy is the stricter of user and repo values under accept < hold < refuse. Absent policy defaults to hold; unknown/mismatched permission mode and bypass-permissions risk remain held. Held messages have bounded queue/TTL and expiration/eviction receipts. Sender receives delivered/held/refused/expired or transport failure only when that state is established. Socket write alone is not delivery. Exercise EBUSY liveness, stale sockets, peer exit, partial frames and macOS close behavior in platform tests.

Wrap peer messages as untrusted agent data. They cannot promote an issue to todo, authorize a tool, run a slash command or proxy an operation a peer was denied. Enforce this at action boundaries as well as in prompts. Versioned, access-controlled shared state supports a coordinator and cross-workspace API alignment without converting arbitrary peer text into user instructions.

## Delivery order and definition of done

1. MON-01/02 scheduler, source coverage, backfill and evidence; MON-03 reproducible measurement where a performance change is claimed.
2. IN-01/02 intake, typed skill handoffs, dedup and authenticated todo transition; dry-run before a real execution.
3. RUN-01/02 and OS-01..05 durable runner, isolation, independent design review/evaluator, and one real issue-to-draft-PR exercise.
4. CS-01..05 credential-verified sidecar and plugin tools, with hostile-peer and platform tests.
5. All five SPEC.md end-to-end gates, public plugin loading, branch/PR idempotency and clean original kernel diff.

The current capability_watch implementation polls stable releases on demand and persists a cursor. It is neither the scheduled release intelligence system nor an autonomous runner.

Change log: v0.3 maps all eight accounts to components, durable state, trust boundaries and verification gates.
