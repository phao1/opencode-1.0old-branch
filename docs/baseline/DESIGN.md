# One-shot framework design v0.4

Updated: 2026-09-29. Normative requirements: SPEC.md.

## Ownership

All runtime modules live in agent-kernel-extension/src/codeagent/one-shot/, registered through custom-hw/extension/bundled-global-extensions.ts and loaded by external-plugins/src/index.ts. This keeps merge output self-contained. scripts/one-shot.ts is the CLI entry. Project skills/commands call registered tools. No native kernel bootstrap or private import is added.

## Components

- types/config: validated trusted configuration, agent result schemas, stage contracts and limits.
- store: atomic JSON snapshots, short cross-process filesystem transactions, per-job locks, append-only logical events in the snapshot; local single-host deployment.
- workspace: persistent isolated Git worktree per job, captured base commit, allowed-path and immutable-kernel checks, command output artifacts.
- agents: OpenCode public HTTP session adapter plus generic stdin/stdout JSON command adapter. Each invocation gets a fresh context; command adapters must implement the documented protocol. Distinct configured agents/models can run in parallel.
- runner: persisted state machine; planner → reviewers → design revision → builder → command verification → independent evaluator → optional code reviewers → handoff. Bounded repair loops. Resume uses stored inputs/results; interrupted side effects are reported and reconciled.
- intake/loops: deduplicated candidates, configured file/command/release/GitHub sources, durable schedules/cursors and source evidence. Source content cannot configure executable commands.
- handoff: reports and manual acceptance evidence; optional git/gh publication to draft PR with deterministic branch identity.

The framework is one process with modules initially, not four independent services. A worker can run under a service manager. Plugin tools enqueue/status/cancel; they do not own a detached in-memory job.

## Data and recovery

A run snapshots configuration, issue and base commit. Persist every phase output before advancing. A per-run lock prevents concurrent execution; dead process locks may be recovered on the same host. Live unknown work is not stolen. A lock/file store is not a distributed multi-host database. Failures keep phase and error; resume starts at that boundary and reuses finished review results. A cancelled active invocation receives an abort signal; subprocesses and OpenCode sessions are explicitly aborted.

Verification commands come from trusted config. Model output cannot append shell commands to them. Models return structured reports; command runner executes argv with shell=false and bounded timeout/output. Planner criteria have stable IDs; evaluator must cover every required ID with evidence and independent role. A failed gate cannot produce an accepted state. Final acceptance requires an explicit operator command with note.

Git boundaries are checked before implementation acceptance and publication, including staged/untracked changes and submodule state. Worktrees preserve diagnostic state and avoid concurrent edits to the same checkout. Isolation is not a security sandbox against a malicious local program; configured adapters and commands are trusted local executables.

## Monitoring and authorization

Release loop reads public releases, compares version refs, persists evidence and reports uncertainty. Log/feedback/competitor/nightly analyses share a typed signal format; configurable commands enable additional source analysis and benchmark workloads. GitHub todo polling requires configured trusted actors and records issue/timeline provenance. External intake produces candidates by default. Only CLI/operator or explicit trusted-source policy queues development.

## Evaluation and artifacts

Independent stage invocations use prompt version and persisted role/model/session identifiers. Concrete check commands plus criterion-level evaluator evidence determine pass/fail. Failed findings re-enter builder and rerun verification. Artifacts include source reports, design, reviews, command stdout/stderr/exit status, evaluator outputs, test manual, PR body and reusable-skill proposal. Human rejection and evaluator feedback are stored as data for later prompt revision, not applied automatically as policy.
