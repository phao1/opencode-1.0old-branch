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
npm run one-shot -- issue-update ISSUE_ID complete-request.json  # only when the candidate needs explicit completion
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
{"title":"Add an external plugin capability","body":"Scope, evidence, expected behavior and constraints","source":"feedback","sourceId":"0021","triageId":"0021","criteria":[{"id":"AC1","description":"The configured tests assert this feature’s observable result","checks":["tests"]}],"evidence":["source URL or log reference"]}
```

one-shot.config.json is trusted operator configuration. Generated code cannot alter the run's captured commands, models, limits or allowlist. Root package manifests are outside the default allowlist; explicitly allow a needed file before queueing tasks that must change it. Staged changes, untracked files and kernel gitlink/source are checked before handoff. Local programs run with the worker user's permissions: worktrees provide task isolation, not an OS security sandbox. Run untrusted repositories in a sandbox/container.

Candidates may omit criteria while requirements are being refined. `todo` rejects empty/duplicate criterion IDs, missing checks/manual bindings and unknown check IDs. Repeated source identity with identical normalized content is idempotent; changed body, criteria or evidence reports a conflict containing the existing issue ID. `issue-update` (or `one_shot_issue` with `updateIssueId`) explicitly replaces only an unqueued candidate, preserves its source identity, and takes complete input. Requirements associated with a run cannot be overwritten. Trusted GitHub labels alone cannot bypass missing criteria; complete the candidate before queueing.

Directory protectedPaths work with or without a trailing slash. Source-content conflicts in monitor batches are retained in loop.conflicts with a durable report and do not starve later signals; identical recurring conflicts reuse that report.

Default `protectedPaths` protects AGENTS.md, .opencode/, scripts/ and existing root build manifests. Enqueue captures their baseline SHA256 and executable mode directly from baseCommit, along with script paths referenced by setup/check/command-agent argv. Repository entrypoints must already exist in that commit. Changed, deleted, Git-hidden or newly ignored policy files block execution/handoff. For skill/script maintenance an operator may explicitly narrow protectedPaths before queueing, but must keep independent verification outside the editable scope; allowlisting alone does not override protection.

Every command must explicitly set allowUnpinned:true if its executable or path-like arguments are not pinned. Enqueue otherwise refuses it. Run trust.coverage, EVALUATION.json and PR.md list the detected unpinned paths. This is not complete dependency analysis: generated dependencies, indirect imports, PATH resolution and lifecycle scripts remain the operator’s toolchain responsibility. Pin external helpers when possible; generated worktree dependencies are not captured after setup or silently treated as immutable.

Absolute script paths require `trustedFiles: [{"path":"/absolute/operator/check.mjs","sha256":"<actual 64-character sha256>"}]`. Relative trustedFiles are resolved against the run workspace and must match baseCommit; absolute ones remain external and are verified against the explicit hash, real path and executable mode. Use `shasum -a 256 /absolute/operator/check.mjs` to obtain a pin. Declare transitive helpers, inline-command imports, interpreters/package dependencies or wrapper dependencies that need protection explicitly; automatic argv discovery is a convenience for script paths, not dependency analysis. Normal new business tests remain editable unless explicitly selected as trusted files. Trust is rechecked before/after stages and commands, before handoff and before accept. EVALUATION.json includes the captured manifest. These are integrity checks, not a filesystem access sandbox. Checks execute generated code and packages with worker-user permissions; that code can itself affect files, services and dependencies. Pins do not prevent such effects, transient tampering restored before verification, or a same-user process rewriting state.

Legacy runs lacking bindings or a trusted snapshot fail closed on execution/accept; do not silently regenerate trust from an already modified workspace. Preserve their artifacts and arrange an explicit operator migration/re-verification. Current CLI resume does not migrate or reset budgets.

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

Input: protocol=one-shot/v1, promptVersion, role, cwd, payload, prompt and JSON schema. Output: {"result": <object matching schema>, "usage": {"tokens": 123, "cost": 0.1}}. Usage is optional and unknown when unavailable. Roles are analyze, plan, revise, design_review, build, evaluate, code_review. Each criterion specifies checks (all bound check IDs must succeed and be cited exactly as check:<check-id>) or manual:true (evaluator must return passed:null, displayed as MANUAL/PENDING). Planner/revise cannot change original descriptions or bindings. Unrelated successful checks cannot substitute; automatic criteria require boolean passed, with false triggering bounded repair. Missing/duplicate criteria, malformed results, failed required commands and unresolved major/blocker findings fail the gate.

The runner writes stage input/output, DESIGN.md, command logs, EVALUATION.json, TEST-MANUAL.md, SKILL-PROPOSAL.md and PR.md. Retry resumes the failed phase. Design/code review findings are deduplicated, bounded repair rounds rerun real checks, and final acceptance requires an operator note. Review artifact retention/rotation is an operator concern in this initial single-host implementation.

### PR publication

publish.enabled=false produces a local PR package. With it enabled, authenticated git and gh publish the deterministic task branch and create a draft PR in the configured repository/base. Retries look up the branch's existing PR before creating another. A closed/merged PR blocks reconciliation. The worker never merges or releases. Reviewer logs and artifact paths are local; the PR contains a self-contained design/check/acceptance summary. Share additional raw logs deliberately if needed.

### Recovery and limits

State uses atomic local snapshots plus per-task/process locks, suitable for one host. Concurrent jobs have distinct persistent Git worktrees; no environment sharing is assumed. A worker crash preserves completed phases. Before retry, an interrupted OpenCode session is aborted; a still-running command child blocks automatic replay until stopped. Lost database files are not recoverable from model context: back up the state/artifact directory if needed. This is not a distributed scheduler.

The bundled tests exercise a real Git workspace and a deterministic command adapter. They verify orchestration and failure handling, not the quality of an actual model's implementation. Real provider quality and platform-specific checks must be verified in your configured environment.

### Test binary delivery

See docs/test-package.md. `npm run package:test` builds the native CLI in a disposable pinned-kernel clone, bundles the external plugin and worker, and emits a portable directory with launchers and provenance/checksums. GitHub Actions builds Windows x64 on dev pushes/PRs/manual runs and uploads the smoke-verified package as a 30-day artifact. It does not publish a Release. The exe remains the native kernel; custom features are delivered by the accompanying plugin bundle. Node 24/Git/Bun are still required for the complete development worker, not just launching the CLI.

## Skills v0.6 (2026-10-23)

`/create-issue` prepares observable criteria and evidence; `/one-shot` queues and inspects the durable workflow. `.opencode/skills/external-plugin-dev/SKILL.md` guides direct development and worker roles through the fixed public API. Worker prompt v3 reads that skill when present, without recursively queueing work. Stage contracts and the user-supplied methodology sources are under `.opencode/skills/one-shot/references/`. The portable build already copies the complete skills directory.

Example request: `/one-shot 开发一个外置工具插件，返回当前项目的基本信息；不读取敏感配置，并为正常调用和缺少项目元数据提供行为测试。` The agent refines this into stable criteria, checks the real public API, and queues it only when configuration and the worker are available. Do not run an unconfigured example as a claim of validation.

Commit the intended skill changes into the configured baseRef before queueing: worktrees start from committed Git objects and cannot see uncommitted prompt guidance. These project skills are not installed globally in Codex. A new real-model run is required to evaluate instruction quality; deterministic runner tests alone do not establish it.

Change log: v0.6 adds project development skill routing and distinguishes skill guidance from worker execution.

## Steering 引导（v0.3）

运行任务时，在同一会话直接发送补充要求，例如：

```text
steer: 先修复测试失败，保留已经完成的接口改动。
```

steer: 是普通文本标记；API 客户端使用原生 session prompt/prompt_async。插件不将普通文本转成 command 模板，不展开其中的 shell/file 标记，也不改变用户的工具权限。

新引导已保存而旧模型请求尚未读到时，公开 tool.execute.before 检查点阻止该请求的后续工具，并返回明确工具错误，让原生循环进入下一轮。已经通过检查点的工具允许完成。batch 内部子工具、MCP 等待授权之后的动作以及已启动的子任务没有可撤销保证。

steering_status 工具查询当前会话的消息级证据。已保存与上下文已准备是不同事实；provider 收到与模型实际采纳在缺少独立证据时显示 unknown。成功结束后，默认对本进程在活动任务中观察的未处理引导做一次有界恢复，追加可审计的 synthetic 控制记录，原消息和附件不重复。已观察到取消、失败或进程重启后不自动续跑。autoResume:false 可关闭恢复。固定内核没有原子 expected_turn_id 接收，也不能原子协调取消与恢复派发；机制见 baseline/STEERING-RECOVERY.md。

### 独立安装

运行 npm run package:steering（Node 24+ 与 Bun；可用 BUN_BINARY 指定 Bun），得到 dist/oneshot-opencode-steering-0.3.2.tgz。安装与卸载步骤见 ../external-plugins/steering/README.md。独立包无需 one-shot worker；总 CodeAgentPlugin 已包含 steering 时不要再次安装。尚未发布到 npm registry。

### 手工验收

1. 在任务正在准备下一工具时发送修正，确认仍为同一会话、只保存一次输入，旧动作被拦截，后续模型按修正执行。
2. 连续发送两条修正，查看实际保存顺序、后续输出与 steering_status；另开会话验证没有串话。
3. 检查附件和已完成工作保留，空显式输入有用法反馈，普通文本中的 shell/file 标记没有在发送时展开。
4. 请求仍执行时使用原生停止功能，确认 pending-cancelled 且没有自动续跑。成功 StructuredOutput 结束时，确认有一个 synthetic 控制记录及后续包含指导的请求；单独的 dispatched 状态不代表已送达。取消恰好与续跑派发交错仍是非原子边界。
5. 真实 CLI/UI 手工验收与 HTTP/provider 自动验收分别记录；自动脚本不冒充已经操作过交互式 TUI。

自动验证命令为 node scripts/verify-steering.mjs；真实模型通过 CODEX_BINARY 指定可用且已登录的 Codex CLI。缺少模型、网络失败或未完成的行为不能算通过。协议探针的确定性 provider 与真实模型运行证据分开保存。

### 本地 Web 调试

先初始化固定子模块，并分别在根目录与 `agent-kernel/` 安装依赖，然后运行 `npm run package:steering` 和 `npm run debug:steering`。需要 Node 24+、npm、Bun 和已登录的 Codex CLI。默认网页为 `http://127.0.0.1:4317`；可用 `STEERING_WEB_PORT` 指定其他空闲端口。日志、实际 server 地址和临时项目路径写入 `.codeagent/steering-web-lab.json`。

在网页打开该临时项目，选择 Verification agent 和 Codex verification relay。可要求模型调用 `probe_step` 记录一个明确的 action，再在运行中发送 `steer:` 修正；观察下一动作和 `steering_status`。首次打开若遇到固定前端的 `worktree` 初始化错误，点击“重启”恢复。Ctrl+C 停止调试进程；不会安装后台服务。

为了稳定复现“旧 provider 请求尚未返回时插话”，调试中继的本地 `/control` 接口接受 POST 暂停下一响应，GET 查询 waiting；`/release` 的 POST 释放响应。模型始终读取暂停前的真实上下文，测试端只控制响应放行时刻。停止体验可在暂停后发送修正，再点击网页“停止”，释放旧响应后核对没有自动续跑。这些控制接口仅绑定 localhost。
