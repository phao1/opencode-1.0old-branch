# Plugin integration guide v0.3

Updated: 2026-10-08

For this baseline, inspect `agent-kernel/packages/plugin/src/index.ts` for supported hooks and `agent-kernel/packages/opencode/src/plugin/index.ts` for loading behavior. Place the fixed registry in `agent-kernel-extension/src/custom-hw/extension/bundled-global-extensions.ts` and extension business logic under `agent-kernel-extension/src/codeagent/<module>/`. The public plugin bridge at `external-plugins/src/index.ts` invokes the registry. The project's one-shot skill is under `.opencode/skills/one-shot/` and is invoked by `.opencode/command/one-shot.md`.

Do not depend on `Bus`, `Session` or private `@/` aliases from an external plugin. Pin and validate the external plugin package against this exact kernel before publishing.

Change log: v0.1 establishes public API boundaries.

## One-shot framework

The runtime is in agent-kernel-extension/src/codeagent/one-shot/. The fixed registry loads its four public tools: one_shot_issue, one_shot_start, one_shot_status, one_shot_cancel. No kernel source modifications are required. Workloads are managed by a separate Node 24+ worker; Bun is required for this repository's dependency/build/kernel commands.

### Configure and run

1. Copy one-shot.config.example.json to one-shot.config.json. Configure the OpenCode server URL and available models. Each agent may specify model as provider/model; omitted model uses the server default. Example roles have separate sessions but **do not imply different models** until configured. Add reviewer IDs to increase parallel perspectives.
2. Install workspace dependencies with bun install. Ensure dev contains the code you want worktrees to start from. Configure checks appropriate to the task: UI requires a real Playwright/browser test command; API/database work requires corresponding assertions. The example typecheck/tests are repository checks, not universal acceptance criteria.
3. Start the pinned server through agent-kernel-extension's bun run serve after installing its dependencies. Configure provider credentials in OpenCode. If the server requires authentication, set OPENCODE_SERVER_PASSWORD and optionally OPENCODE_SERVER_USERNAME for the worker.
4. Start npm run one-shot -- worker from the wrapper root. It runs scheduled intake and queued jobs. Use a service manager for persistence after terminal logout. No daemon is silently installed.
5. In OpenCode use /create-issue or /one-shot. Alternatively use the CLI below. Generated artifacts and state are under .codeagent/one-shot; this directory is local and ignored by Git.

```bash
npm run one-shot -- issue request.json
npm run one-shot -- todo ISSUE_ID
npm run one-shot -- run
npm run one-shot -- status RUN_ID
npm run one-shot -- resume RUN_ID
npm run one-shot -- cancel RUN_ID
npm run one-shot -- accept RUN_ID "Manual behavior confirmed"
npm run one-shot -- reject RUN_ID "Actual observed failure and reproduction"
```

request.json and file/command signal loops use this shape (loops wrap it as signals: [ ... ]):

```json
{"title":"Add an external plugin capability","body":"Scope, evidence, expected behavior and constraints","source":"feedback","sourceId":"0021","triageId":"0021","criteria":[{"id":"AC1","description":"A concrete observable result"}],"evidence":["source URL or log reference"]}
```

one-shot.config.json is trusted operator configuration. Generated code cannot alter the run's captured commands, models, limits or allowlist. Root package manifests are outside the default allowlist; explicitly allow a needed file before queueing tasks that must change it. Staged changes, untracked files and kernel gitlink/source are checked before handoff. Local programs run with the worker user's permissions: worktrees provide task isolation, not an OS security sandbox. Run untrusted repositories in a sandbox/container.

### Monitoring and loops

- source: fetch Git objects from a configured public GitHub repository/ref, without installing or executing its code. Example inputs cover openai/codex main, earendil-works/pi main and anomalyco/opencode dev. First scan compares the latest tip with its parent; later scans compare the last successfully analyzed SHA to the new tip, even if no release exists. Persist full Git cache and bounded diff/changed-file content, commit URLs, rewrite/omission notices and independent analysis. Candidate evidence includes the saved report path so planning can inspect original evidence. A source scan never upgrades the pinned kernel or grants todo. Defaults: 30 files, 32KB per file, 256KB content, 256KB patch; configure maxSourceFiles/maxSourceFileBytes/maxSourceBytes. A shallow fetch retains 200 commits per fetch; missing previous SHA blocks cursor advancement. No claim of exhaustive analysis for omitted content.

- release: stable Claude Code/Codex releases, pagination, version cursor, changelog and GitHub compare evidence, independent analyst report and candidate issues. First scan analyzes the latest release. If an old cursor cannot be found within maxPages, it stays unchanged with an error. GitHub compare may lack closed-source implementation or complete patches; reports must retain this limitation.
- file: read a JSON signals array produced by feedback/log tooling; source identity deduplicates repeated reads.
- command: invoke configured argv without a shell; stdout must contain the same signals JSON. Use this to connect competitor analysis, nightly scans or benchmark scripts. The framework does not invent a bug-finder or benchmark workload.
- github: poll open issues bearing the configured todo label. Validate the most recent label event against trustedActors before queueing; an issue body cannot grant permission. Missing/overlong label-event history blocks provenance instead of accepting it. Set GITHUB_TOKEN for required access/rate limits.

Each loop supports intervalSeconds or daily HH:MM with an explicit IANA timezone, durable cursor, bounded pagination and error retry. Intake produces candidates except the explicitly enabled trusted GitHub todo policy. Use npm run one-shot -- tick for one due scan.

### Agent adapter protocol

OpenCode adapters call the pinned kernel's public session/message API. A new session is used for every invocation. Planner/review/evaluator sessions have read-only tool permissions; Builder can read/edit/run commands. These permissions do not sandbox a trusted local command adapter.

A command adapter is any executable argv implementing the protocol below. This is an integration contract, **not a claim that raw claude/codex/qoder commands accept this JSON**. Wrap a native CLI's documented input/output modes to implement it. Command arguments are trusted configuration and executed with shell=false. Input arrives as one JSON object on stdin; output is one JSON object on stdout; diagnostics go to stderr. Timeouts, cancellation and output limits terminate the process. Fallback agent IDs may be configured on each agent.

Input: protocol=one-shot/v1, promptVersion, role, cwd, payload, prompt and JSON schema. Output: {"result": <object matching schema>, "usage": {"tokens": 123, "cost": 0.1}}. Usage is optional and unknown when unavailable. Roles are analyze, plan, revise, design_review, build, evaluate, code_review. Every evaluator passing criterion must cite at least one successful configured check as exactly check:<check-id>, alongside concrete observed evidence. Missing/duplicate criteria, malformed results, failed required commands and unresolved major/blocker findings fail the gate.

The runner writes stage input/output, DESIGN.md, command logs, EVALUATION.json, TEST-MANUAL.md, SKILL-PROPOSAL.md and PR.md. Retry resumes the failed phase. Design/code review findings are deduplicated, bounded repair rounds rerun real checks, and final acceptance requires an operator note. Review artifact retention/rotation is an operator concern in this initial single-host implementation.

### PR publication

publish.enabled=false produces a local PR package. With it enabled, authenticated git and gh publish the deterministic task branch and create a draft PR in the configured repository/base. Retries look up the branch's existing PR before creating another. A closed/merged PR blocks reconciliation. The worker never merges or releases. Reviewer logs and artifact paths are local; the PR contains a self-contained design/check/acceptance summary. Share additional raw logs deliberately if needed.

### Recovery and limits

State uses atomic local snapshots plus per-task/process locks, suitable for one host. Concurrent jobs have distinct persistent Git worktrees; no environment sharing is assumed. A worker crash preserves completed phases. Before retry, an interrupted OpenCode session is aborted; a still-running command child blocks automatic replay until stopped. Lost database files are not recoverable from model context: back up the state/artifact directory if needed. This is not a distributed scheduler.

The bundled tests exercise a real Git workspace and a deterministic command adapter. They verify orchestration and failure handling, not the quality of an actual model's implementation. Real provider quality and platform-specific checks must be verified in your configured environment.

### Test binary delivery

See docs/test-package.md. `npm run package:test` builds the native CLI in a disposable pinned-kernel clone, bundles the external plugin and worker, and emits a portable directory with launchers and provenance/checksums. GitHub Actions builds Windows x64 on dev pushes/PRs/manual runs and uploads the smoke-verified package as a 30-day artifact. It does not publish a Release. The exe remains the native kernel; custom features are delivered by the accompanying plugin bundle. Node 24/Git/Bun are still required for the complete development worker, not just launching the CLI.
