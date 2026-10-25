# One-shot framework design v0.6

Current steering acceptance and API evidence: [STEERING.md](STEERING.md). Public API evidence and observed limitations: [STEERING-FEASIBILITY.md](STEERING-FEASIBILITY.md).

Updated: 2026-10-23. Normative requirements: SPEC.md.

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

Verification commands come from trusted config. Model output cannot append shell commands to them. Models return structured reports; command runner executes argv with shell=false and bounded timeout/output. Planner criteria have stable IDs and immutable checks/manual bindings; every automatic PASS requires all bound checks to succeed and be cited. Manual criteria remain passed=null until operator acceptance. A failed gate cannot produce an accepted state. Final acceptance requires an explicit operator command with note.

The v0.7 trust manifest captures protected repository files from baseCommit and externally supplied checks from explicit SHA256 pins. Execution, handoff and acceptance recheck file contents, executable mode and external real paths; default policy namespaces also reject newly ignored files. Candidate source conflicts are explicit and candidate replacement is a separate operation; an attached run makes its request immutable. This does not create an OS sandbox. See [ONE-SHOT-HARDENING.md](ONE-SHOT-HARDENING.md) for scope, failure tests and delivery evidence.

Git boundaries are checked before implementation acceptance and publication, including staged/untracked changes and submodule state. Worktrees preserve diagnostic state and avoid concurrent edits to the same checkout. Isolation is not a security sandbox against a malicious local program; configured adapters and commands are trusted local executables.

## Monitoring and authorization

Release loop reads public releases, compares version refs, persists evidence and reports uncertainty. Log/feedback/competitor/nightly analyses share a typed signal format; configurable commands enable additional source analysis and benchmark workloads. GitHub todo polling requires configured trusted actors and records issue/timeline provenance. External intake produces candidates by default. Only CLI/operator or explicit trusted-source policy queues development.

## Evaluation and artifacts

Independent stage invocations use prompt version and persisted role/model/session identifiers. Concrete check commands plus criterion-level evaluator evidence determine pass/fail. Failed findings re-enter builder and rerun verification. Artifacts include source reports, design, reviews, command stdout/stderr/exit status, evaluator outputs, test manual, PR body and reusable-skill proposal. Human rejection and evaluator feedback are stored as data for later prompt revision, not applied automatically as policy.

## v0.5 additions: source evidence and test delivery

`source.ts` maintains a per-repository bare cache under the durable state directory. It fetches a configured ref without checkout/install, compares immutable SHAs, and supplies bounded source files, diff and commit metadata to the independent analyst. `loops.ts` saves both raw evidence and analysis reports; issue evidence carries the report path. Cursor movement follows successful analysis and candidate persistence. Omitted files, binary files, missing history and ref rewrites remain explicit evidence gaps.

`scripts/build-test-package.mjs` clones the fixed kernel into a disposable build checkout. The upstream script may generate native files there, but source under the workspace submodule is untouched. The CLI, bundled public plugin, separately bundled Node worker, skills and launchers form one portable package. macOS Actions runs checks on Apple Silicon and Intel, builds, then starts the actual native binary and confirms one-shot tool registration before uploading a 30-day tar.gz artifact preserving executable permissions. Release publication remains manual.

## v0.6 skills 设计（2026-10-23）

入口 one-shot 负责需求确认、队列和交付；create-issue 负责证据与稳定验收标准；新增 external-plugin-dev 负责固定内核公开 API 映射、外置实现及源码对照。worker prompt v2 显式要求读取当前 checkout 的开发 skill，保持各 role 的只读/写入权限及 JSON 协议。阶段指导与来源取舍位于 one-shot/references/。不新增调度器、模型适配器或隐式监控。

需求依据是用户提供的 2026.06 长文和 8 月升级帖正文，原作者完整 skill 未提供。多 reviewer 的意见由 planner 单写合并；固定四模型和设计时间比例不是验收条件。参考源码未到位时明确记录缺口。新 skills 需进入 run 的 base commit 才会在隔离工作目录生效。

变更记录：v0.6 补全研发技能与来源追溯；验证记录见下。

## Steering v0.3 设计

本版由真实 one-shot run 保存设计，并经两名独立 agent 并行评审；完整阶段记录由 worker 负责，不手工填写完成状态。核心生产模块位于 external-plugins/src/，内核 gitlink 不变。

普通用户输入沿原生持久化路径进入当前会话，不靠提示前缀改变权限或调度。chat.message 观察接收，公开 SDK 确认保存；messages.transform 绑定到具体 assistant 的上下文快照；tool.execute.before 通过保存的 callID 找到对应 assistant，核对新引导是否已在该快照中。旧请求即使晚于新请求执行，其工具仍不能借用新请求的快照通过检查。

存储内容与上下文内容的指纹分开：内核可能在 transform 前包装用户文本。压缩也调用 transform，所以不能将最近一次 session 快照当成所有工具的上下文。证据无法关联时返回明确错误，不能把未知当成安全放行。状态缓存保留消息 ID 与证据，不另建重复消息队列。

steering_status 查询当前会话的逐消息状态。saved、prepared、provider 与 adopted 分开；公开 hook 不证明 provider 收到或模型遵循，因此后两者通常为 unknown。成功结束后，对本进程在活动任务中观察的未处理引导执行一次有界 synthetic continuation；原输入保持，新增控制记录可审计。已观察到取消、错误及进程重启后不自动派发旧 pending。autoResume:false 可关闭恢复。状态机和非原子取消边界见 STEERING-RECOVERY.md。

入口显式合并 steering 与 one-shot 的 tools 和 event，不能用对象 spread 覆盖已有能力。独立包只包含 steering，不依赖 worker、固定源码目录或私有 import。

验证分三层：组件测试覆盖生命周期和隔离；真实内核配确定性 provider 验证工具检查点与消息顺序；真实模型中继仅转换协议，让模型根据实际 provider 请求自主选择工具和输出。最终验收报告以本 run 的实际检查结果为准。

## 参考实现核对与独立分发（2026-10-23 补充）

上一版仅核对固定内核，未对照其他项目；本次补查实际源码，不能将原有提示包装称为完整 steering。三个参考仓库均以 HTTP/1.1、depth=1 克隆到 oneshot 下对应目录；源码完整，历史为浅克隆，未安装/运行参考库依赖。

| 来源 commit | 已读实现 | 关键机制与本项目差距 |
| --- | --- | --- |
| openai/codex de06fd0be4f465bc28c3111bdadaabda5dfdebcd | codex-rs/core/src/session/turn_input.rs 的 steer_input / start_or_steer | 活动 turn 锁、expected_turn_id 校验、空输入/不可 steer turn 拒绝、接受序号、输入队列、返回 Steered/NotSubmitted。旧内核公共 hook 没有原子 expected-turn 接收接口，不能用状态查询冒充。 |
| earendil-works/pi 36be9c612e64082a4f0d4d0a94706c38ecbc20a1 | packages/agent/src/agent.ts 与 agent-loop.ts | steeringQueue 和 followUpQueue 分离，one-at-a-time/all，内层下一轮消费 steering、自然停止时才消费 follow-up。当前插件没有独立队列或消费控制。旧 changelog 提及的跳过工具行为不直接视为当前实现保证。 |
| anomalyco/opencode 24b5ed8bcc60aa9a20cf4e3edf1444470e0e6464 (dev) | packages/core/src/session/prompt.ts、inbox.ts、runner/index.ts | prompt delivery，持久化 inbox，steer/input 两种 promote 范围，steer 优先，queue 自然边界才提升。它是用户所称 2.0 的参考，不替换固定 1.3.17 内核。 |

永久源码链接：
- https://github.com/openai/codex/blob/de06fd0be4f465bc28c3111bdadaabda5dfdebcd/codex-rs/core/src/session/turn_input.rs
- https://github.com/earendil-works/pi/blob/36be9c612e64082a4f0d4d0a94706c38ecbc20a1/packages/agent/src/agent-loop.ts
- https://github.com/anomalyco/opencode/blob/24b5ed8bcc60aa9a20cf4e3edf1444470e0e6464/packages/core/src/session/inbox.ts

本版学习这些实现的消息归属和执行边界，通过公开工具检查点实现旧动作拦截。原子 turn 接收、独立 follow-up 队列和持久化 inbox 并未因此获得；不宣称完整复刻，也没有复制参考项目代码。

独立包入口及说明位于 external-plugins/steering/。scripts/package-steering.mjs 负责构建与干净安装；scripts/verify-steering.mjs 使用安装后的文件启动真实固定内核并保存行为证据。构建、加载、调度和真实模型采纳分别判断，不能互相代替。

## v0.3.2 删除确认与交互验证（2026-10-24）

原实现将 Undo cleanup 删除的历史保留为 `saved: unknown`，导致新 assistant 即使准备完整上下文仍永久被 gate 拒绝。现在公开 `message.removed` 为已知输入记录 `removedAt`；reconcile 确认有效输入缺失后，该条目退出待处理阻断集合，但保留审计记录。有效输入重新出现立即清除 `removedAt`，无删除事件的缺失以及仅附件删除继续按未知/未读证据阻断。字段随 ledger 持久化。

新增真实内核历史探针覆盖 revert→新 prompt cleanup 和 DELETE 两条路径。动作探针改成静态公共插件 fixture，避免原生成代码中的字面换行转义错误；基线并行工具只约束每个动作一次及批次先后，不要求并行批次内部的完成顺序。

`npm run debug:steering` 启动固定内核、安装后的独立包、固定版本 Vite Web app 与真实 Codex 中继，目录、状态、模型请求和工具动作均隔离保存。它只提供可观察的动作工具和模型协议转换，不替模型选择目标；不更改内核源码或用户全局配置。原生前端首次打开项目可能发生 `worktree` 初始化竞态，页面重启后继续验证，未修改固定前端。
