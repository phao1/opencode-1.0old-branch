# CodeAgentPlugin baseline specification v0.3

Updated: 2026-09-29

## Goal and constraints

On the pinned OpenCode v1.3.17 kernel, monitor Claude Code and Codex changes, turn release intelligence and other signals into issues, run trusted todo issues through a resumable one-shot workflow, and let named local sessions coordinate safely. Produce a PR with design, evidence and a human acceptance handoff.

The pinned kernel commit is 517e6c9aa4c61dbc125e7654fc596f1d529f20d9. Original tracked kernel files stay immutable. The fixed extension registry lives in agent-kernel-extension/src/custom-hw/extension/; adapters live under src/codeagent/; public hooks live in external-plugins/; durable workers belong in services/. Use verified public SDK/plugin APIs or external sidecars. A copied registry is not itself a native bootstrap.

The eight user-supplied accounts are design input. Their described results are not evidence that this repository implements them. An ID is complete only with tests and runtime evidence. Release text, code downloads, logs, issue bodies and peer messages are untrusted inputs. Only a trusted user transition or explicitly configured project automation can select a todo issue for execution.

## Traceability and acceptance contract

| ID | Required behavior and proof | Source section |
| --- | --- | --- |
| MON-01 | Schedule and manually trigger Claude Code/Codex version and changelog scans. Persist URL, version, time, hash, cursor and pagination/backfill state. Restarts and duplicate events cannot silently skip or repeat releases; unknown gaps are reported. | 5, 8 |
| MON-02 | Compare authorized public changelog/source/artifacts across versions and write per-feature evidence-linked analysis. Label observed behavior, vendor claims and hypotheses separately; inaccessible sources remain unknown. | 5, 8 |
| MON-03 | For relevant performance changes, benchmark before/after under recorded builds, platforms and workloads, report raw repetitions, variance, time, CPU, memory and package-size tradeoffs. Changelog numbers alone are not measurements. | 8 |
| IN-01 | /create-issue accepts user analysis, release reports, error logs, feedback handoff and bug scans. Candidate records evidence, repro, scope, architecture impact, acceptance checks, provenance, confidence, dedup key and handoff ID. | 2, 3, 5 |
| IN-02 | Configurable loops for logs, competitor news and nightly bugs create deduplicated candidates with retry/idempotency and typed skill handoffs. Completed work can be proposed as a reusable skill, reviewed and composed with other skills without losing provenance. 07:10 is one example schedule. | 2, 3, 5 |
| RUN-01 | An authenticated and trusted todo transition starts exactly one job despite webhook replay/restart. Persist claim, lease, checkpoint, state, decisions, logs, elapsed time and token/cost where available; support cancel/retry/resume. | 2, 3 |
| RUN-02 | Parallel jobs use isolated reusable checkouts/directories, one branch/lease per job, configurable concurrency and budgets. Five simultaneous directories are a reported example. Provider fallback preserves and reports state. | 2 |
| OS-01 | Brainstorm, inspect pinned API/architecture, save detailed design and concrete criteria before coding. Cover edge cases, failure, permissions and rollback; do not enforce a universal 80/20 time split. | 1, 2, 7 |
| OS-02 | Review saved design concurrently with distinct available models/agents; record findings, deduplicate and resolve blockers in a versioned design. Four named reviewers are an example, not fabricated if unavailable. Bound fanout/cost/time. | 1, 5, 7 |
| OS-03 | Implement from the design. Independent evaluator checks actual UI actions, API/DB/CLI effects as relevant, with criterion-level evidence; self-rating or screenshot alone cannot pass. Required failures block ready PR status. | 1, 2, 5 |
| OS-04 | Optional parallel independent code reviews, bounded fix/recheck cycles, logs/repro/diagnosis for failed acceptance, manual test guide and PR handoff. Human accepts/merges; no auto-release. | 2, 5, 7 |
| OS-05 | Track evaluator judgment errors and prompt/criteria revisions. Keep contracts, compaction and evaluation rounds adaptable to model behavior, while preserving durable task state. | 1 |
| CS-01 | Opt-in named peer discovery and addressing on macOS/Linux; support same-project and isolated-workspace coordination, explicit coordinator/shared-state handoffs and receipts. Windows disabled until equivalent peer verification exists. | 4, 6 |
| CS-02 | Private Unix socket directory 0700, sockets 0600, bounded NDJSON and OS peer credentials. Claimed name/from is untrusted; PID/UID is provenance, not lasting authentication. Check ownership, framing and canonical envelope round-trip. | 4 |
| CS-03 | Effective inbound policy is the stricter user/repo value under accept < hold < refuse. Default hold. Unknown or mismatched permission modes, including bypass permissions, hold until a trusted decision. Refuse before attachment materialization. | 4, 6 |
| CS-04 | Peer content never establishes user intent or permission. Slash commands remain text; reject permission laundering at actual action boundaries, including proxy retries of a refused action. | 4 |
| CS-05 | Bound hop count/routes, authenticated hop evidence, queue length/TTL and payload sizes. Expiry/eviction sends receipts. Delivery success requires acknowledgement/close outcome; handle stale sockets, EBUSY, peer exit, partial writes and platform close timing. | 4 |

## Cross-cutting end-to-end gates

1. Two releases are compared, traced into one deduplicated candidate; a pagination gap remains visible, and an unverified performance claim remains labeled a claim.
2. Feedback/log triage creates a stable handoff ID. Only a trusted todo transition starts a job; replay, restart and recovery produce one branch and one PR.
3. Two jobs have separate reusable workspaces; a design defect found in concurrent review is fixed before coding; independent evaluation exercises real behavior and blocks an incomplete change.
4. Two named peers align an API contract across isolated workspaces. A hostile peer forges a name, sends a slash command and attachment, attempts laundering and a message loop. Default policy prevents execution and refused attachment writes; receipts accurately report hold/refusal/expiry.
5. All of the above run on the pinned kernel. Kernel original tracked files show no diff; only CodeAgent-owned merge output appears.

## Case-study details versus release gates

The accounts report five concurrent directories, 80% design effort, four reviewers, a 07:10 loop, 32 hops, 100 held messages, a 150 ms macOS delay, a 24-bit HMAC fragment, 13 reports, 152 tests and 46 manual cases. Preserve these as context and configurable design inputs, not fixed promises or security targets. In particular, do not adopt a short HMAC fragment as an authentication-strength requirement; choose a reviewed scheme and test it. Match the behavior and acceptance gates above, not anecdotal code or test counts.

## Current implementation

The capability_watch tool currently checks stable GitHub releases on demand, stores a local cursor, returns source URLs/notes, establishes baseline on first use and warns if the last cursor falls outside the fetched page. Its registration and public plugin bridge have been smoke tested. The one-shot skill is an interactive checklist. MON-01 is partial; every other ID is a target awaiting implementation and evidence.

Change log: v0.3 captures all eight accounts as testable requirements and records the current gaps.
