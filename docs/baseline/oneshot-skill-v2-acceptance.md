# One-shot skill v2 验收与边界

设计唯一依据：`docs/oneshot/ONE-SHOT-SKILL-DESIGN.md` v1.1；流程来源为其中引用的陈成原文。

本次验收：A1 全部自动化用例；A2 本机 agent PONG 真实探测；A4 手册独立可执行、≤250 行与安装器；临时 Git 仓库 init → design → fanout → status。A3 的真实 steering 业务开发及提交属于后续验收，本次不执行。按分工由 Planner 审查后提交。

实现前已核对：子模块为 `517e6c9aa4c61dbc125e7654fc596f1d529f20d9`，`@opencode-ai/plugin` 为 1.3.17。本实现是项目 skill/独立 Node CLI，不调用内核扩展点，不改内核源文件。CLI 参数依据本机 `codex exec --help` 与 `codex exec resume --help`；resume 子命令不支持 `-C`，以 spawn 的 cwd 指定仓库。

测试必须隔离配置/缓存并使用生成的假 agent，不能调用真实 Codex。验收覆盖独立超时与进程组清理、并行耗时、成功结果复用、失败原因、原子写和锁、产物门禁、Generator thread 恢复、宿主后台启动与验证日志。

## 验证结果

初版结果（v1.1 返工结果见下节），现统一用 `node --test test/oneshot-skill/*.test.mjs`：17/17 通过，0 失败；总耗时 11.77s。
三个各等待 2s 的 agent 真正并发，实测 fanout 为 2086ms（要求 <4000ms）。
测试使用显式 *.test.mjs glob，与根 npm test 一致；已删除不再需要的 index.js 入口。
所有自动化用例使用临时配置与生成的假 Node CLI，未调用真实 Codex。

```text
✔ 尺寸生成 S/M/L 节点表，非法尺寸拒绝 (0.887792ms)
✔ 状态原子写：rename 前旧文件完整，rename 失败仍保留旧状态且清理 tmp (2.158458ms)
✔ 锁包含 pid，拒绝活锁，回收死亡 pid (2.624708ms)
✔ done 校验产物、设计章节与验收 ID，next 返回操作指导 (414.232875ms)
✔ init req stdin、run id、显式尺寸优先，默认尺寸可在 brainstorm 判定 (150.078167ms)
✔ 中文需求生成的 run id 可显式选择，路径穿越被拒绝 (100.736542ms)
✔ fanout 真并发：三个各 2s，预热探测后总耗时 <4s；完成需宿主汇总 (2684.189417ms)
ℹ 3 x 2s fanout elapsed: 2086ms (<4000ms)
✔ 独立超时 kill 整个进程组，另一个 agent 成功 (1023.608417ms)
✔ 退出非零、空输出、全部失败记录 DEGRADED；无可用 agent 同样降级 (713.614667ms)
✔ 中断 fanout 后复用已成功结果，回收锁，只重跑未完成 agent (2255.806458ms)
✔ PONG 探测校验认证信息、非 PONG、缺失二进制，缓存可刷新 (598.877875ms)
✔ 默认 Codex 只读 argv、stdin 文件指令与 -o 输出路径（替换为假二进制） (507.184917ms)
✔ Generator 新会话、JSON thread 持久化，--fix resume 参数与记录正确且保留历史 (812.73925ms)
✔ --fix 无 thread 时新开 Generator，inline 需要宿主报告 (680.2515ms)
✔ verify 顺序执行、日志落盘，失败不能 done，修复后可以通过 (325.252292ms)
✔ run 前台/后台宿主精确参数与 stdin，存活时拒绝 resume，死亡后可恢复 (1421.584167ms)
✔ install.sh 可安装、幂等，拒绝覆盖别的目录；SKILL 通过行数与 frontmatter 检查 (27.415083ms)
ℹ tests 17
ℹ suites 0
ℹ pass 17
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11766.726334
```

## v1.1 返工

2026-11-04，按 Planner 审查意见完成定点修复；按分工由 Planner 审查后提交。

| 审查项 | 修复与验证 |
| --- | --- |
| 1：diff 基准 | init 记录目标仓库 HEAD 为 baseCommit，非 Git/无 HEAD 为 null；review 明确 git diff 基准及未跟踪文件检查，impl 告知基准；覆盖状态记录和模板渲染。 |
| 2：评审需求上下文 | improve/review 均传入 REQUIREMENT.md、BRAINSTORM.md、上一轮同类 SUMMARY.md（若存在），要求对照需求检查满足程度与越界；覆盖首轮缺省和第二轮汇总路径。 |
| 3：宿主长命令 | SKILL.md/flow.md 明确 shell 工具长超时、提前返回后持续等待、中断恢复；检查 SIGTERM 会 kill 活动子进程组，补断言确认进行中的 agent 死亡及成功结果复用。verify 恢复时重跑全部检查。 |
| 4：本地 run id | YYYYMMDD-HHMM 改用本地时间，state ISO 保持 UTC；固定时刻验证 Auckland 跨日与 Honolulu 本地日期。 |
| 5：设计校验 | 章节接受数字加点/顿号、空白及括号后缀；前 10 行出现 v 数字版本即可；覆盖第 10/11 行边界及缺失章节拒绝。 |
| 6：超时默认值 | agentTimeoutSeconds 改为 1500，Generator 保持 3600；配置断言与 SKILL.md/flow.md 说明同步。 |
| 7：测试入口 | 删除 test/oneshot-skill/index.js，文档统一使用 node --test test/oneshot-skill/*.test.mjs。 |
| 8–9：验收与报告 | 更新 Planner 审查后提交的分工说明；Evaluator 报告逐个打印模型与 durationMs，缺失值为 -，覆盖 0ms 与缺省值。 |

本轮验证：

- `node --test test/oneshot-skill/*.test.mjs`：22/22 通过，0 失败，退出码 0；最终复验总耗时 9.28s。3 × 2s 并发实测 2092ms（<4000ms）。
- `node_modules/.bin/tsc --noEmit -p .`：退出码 0，无诊断。
- 全部 agent 执行使用隔离临时目录与假 CLI；Git HEAD 测试只读现有提交，未创建新提交。

## 真实 agent 探测

执行：`node .agents/skills/one-shot/scripts/oneshot.mjs agents --refresh`。
4 个 Codex 模型是同一 agent、不同模型，不代表 4 个厂商。认证错误优先于退出码和 PONG；
Claude/DSH/CodeBuddy 已实测未登录。缓存位于 ~/.cache/oneshot/agents.json。

| Agent | 状态 | 原因 | 耗时 |
| --- | --- | --- | --- |
| codex@gpt-6.1-sol | 可用 | PONG | 10617ms |
| codex@gpt-6-astra | 可用 | PONG | 12616ms |
| codex@gpt-6.1-terra | 可用 | PONG | 26007ms |
| codex@gpt-5.6-sol | 可用 | PONG | 8927ms |
| claude | 不可用 | authentication required / not logged in | 2388ms |
| qodercli | 不可用 | binary not found | 0ms |
| agy | 不可用 | binary not found | 0ms |
| gemini | 不可用 | binary not found | 0ms |
| dsh | 不可用 | authentication required / not logged in | 2115ms |
| codebuddy | 不可用 | authentication required / not logged in | 6487ms |
| opencode | 不可用 | binary not found | 0ms |

## 临时 Git 仓库演练

使用 mktemp 建仓库，git init，不提交；配置仅包含两个假 agent。improve 保持 running 是预期行为：
脚本不替宿主做设计取舍，必须填写 SUMMARY 并移除 HOST_TODO 后才可 done improve。

```text
Temporary Git repo: /private/tmp/oneshot-v2-smoke.4LdWQY
init → start/done brainstorm → start/done design → fanout improve → status: PASS
next=improve, design=done, degraded=False
Tree:
  cache/
  cache/agents.json
  docs/
  docs/oneshot/
  docs/oneshot/runs/
  docs/oneshot/runs/20261103-1512-temporary-smoke/
  docs/oneshot/runs/20261103-1512-temporary-smoke/BRAINSTORM.md
  docs/oneshot/runs/20261103-1512-temporary-smoke/DESIGN.md
  docs/oneshot/runs/20261103-1512-temporary-smoke/REQUIREMENT.md
  docs/oneshot/runs/20261103-1512-temporary-smoke/improve/
  docs/oneshot/runs/20261103-1512-temporary-smoke/improve/round-1/
  docs/oneshot/runs/20261103-1512-temporary-smoke/improve/round-1/SUMMARY.md
  docs/oneshot/runs/20261103-1512-temporary-smoke/improve/round-1/fake-a.log
  docs/oneshot/runs/20261103-1512-temporary-smoke/improve/round-1/fake-a.md
  docs/oneshot/runs/20261103-1512-temporary-smoke/improve/round-1/fake-a.prompt.md
  docs/oneshot/runs/20261103-1512-temporary-smoke/improve/round-1/fake-b.log
  docs/oneshot/runs/20261103-1512-temporary-smoke/improve/round-1/fake-b.md
  docs/oneshot/runs/20261103-1512-temporary-smoke/improve/round-1/fake-b.prompt.md
  docs/oneshot/runs/20261103-1512-temporary-smoke/state.json
  fake-agent.mjs
  oneshot.config.json
Agents: {"fake-a": "ok", "fake-b": "ok"}
```

## 真实 OpenCode smoke

`node scripts/smoke-one-shot.mjs` 首次因当前 PATH 无 npm 而启动失败；以本机 Corepack shims 补充 PATH 后成功。
核对了固定版本公共 Plugin API 的 PluginInput/Plugin 定义；新 skill 没有导入该 API 或私有模块。
下列 smoke 验证现有公共插件加载和消息持久化，不代表已完成 A3 steering 业务端到端生成。

```json
{
  "kernel": "1.3.17",
  "tools": [
    "one_shot_issue",
    "one_shot_start",
    "one_shot_status",
    "one_shot_cancel"
  ],
  "steering": "v0.2 literal persistence + status tool loaded; no model invoked",
  "realModel": false,
  "fixture": "/Users/penghao/Documents/code/oneshot/one-show-code/opencode-1.0old-branch/.codeagent/kernel-lab-lcILaI"
}
```

## SKILL.md 自审

v1.1 为 137 行，frontmatter 的 name/description 明确覆盖一键开发、one-shot、从需求到实现。
临时 Python venv 安装 PyYAML 后运行 skill-creator 的 quick_validate.py：`Skill is valid!`；未增加项目依赖。

| 独立宿主需要的信息 | 结论 |
| --- | --- |
| CLI 绝对路径、工作目录、run 选择和避免递归宿主 | 已说明 |
| S/M/L 判定、显式尺寸优先与保存方式 | 已说明 |
| 每个节点的命令、输入、产物与完成条件 | SKILL.md + flow.md 完整覆盖 |
| SUMMARY 格式、采纳/拒绝理由、设计版本更新 | 已说明，并由 HOST_TODO 门禁防止自动假完成 |
| 独立 Generator、thread 恢复、S inline 报告 | 已说明并测试 |
| 验证失败最多 3 次复验、review 上限与阻塞 | 已说明，由宿主裁决 |
| 0 成功 DEGRADED 自评、不可冒充独立 Evaluator | 已说明并测试落盘门禁 |
| 无人值守默认假设、用户禁止提交时的交付 | 已说明 |
| commit 的 Design 引用、不自动推送/合并/发布 | 已说明 |

`git diff --check` 通过。根 package.json 仅在 test 脚本末尾追加新 glob。
未修改内核源码、docs/review/；未执行 git commit/checkout/stash/reset。

## 已知限制与后续验收

- A3 未执行：本次未让真实 Generator 完成 steering 需求 M/L 全流程，也未提交；这需要后续业务验收。
- 第三方 CLI 的登录/只读参数依赖其版本；本机不可用，尚未实测它们的正常评审路径。Codex 使用强制 read-only；其他 CLI 使用配置参数与只读 prompt，不宣称跨 CLI 具有同等沙箱保证。
- 进程组清理面向 macOS/Linux POSIX，未实现 Windows 进程树管理。
- 设计取舍、轮次停止与复验次数由宿主执行；脚本负责状态、进程、证据和产物门禁，不替代 Planner。

## v1.2 返工

2026-11-04，基于两次真实运行的验收发现完成 6 项定点修复。设计升为 [v1.2](../oneshot/ONE-SHOT-SKILL-DESIGN.md)，本轮不提交。

证据来源：[steering-v2 运行](../oneshot/runs/20261104-0426-steering-v2/README.md)、
[steering-v21 运行](../oneshot/runs/20261104-0553-steering-v21/README.md)；
v21 的 [impl 第 1 轮中止说明](../oneshot/runs/20261104-0553-steering-v21/impl/round-1/INTERRUPTED.md)
与 state.json 对照显示 SIGTERM 后 attempt 仍为 running；host.events.jsonl 包含
`Selected model is at capacity. Please try a different model.` 的 error / turn.failed 事件。
历史 run 作为只读证据保留，不修改其状态、日志或产物。

| 验收项 | 修复与验证 |
| --- | --- |
| P1 中断与失联状态 | impl attempt、fanout 每个 agent、verify 及检查记录 cliPid；SIGINT/SIGTERM 先清理子进程组，再尽力原子保存 interrupted、reason、finishedAt 与事件，立即释放锁；写命令取得锁后 reconcile 死亡 PID（兼容旧版缺少 cliPid 的长任务）。真实 spawn CLI + sleep 假 Generator 分别发送 SIGTERM/SIGINT，验证退出 143/130、子孙进程结束、锁消失、新轮次恢复；死 PID/陈旧锁用下一条 report 验证修复，成功与存活记录保持原状态。status/next 不写盘，均能展示已保存的中断信息。 |
| P2 run 目录忽略文件 | init 写 .gitignore，内容为 `.lock` 与 `*.tmp`；断言文件原文，并以临时 Git 仓库的 check-ignore 验证。 |
| P2 重复 done | 已 done 的 deliver 再次 done 只更新 note，不重验产物，保留原 finishedAt，timeline 写 note-update；覆盖备注更正和完成事件不重复。 |
| P2 中止操作说明 | SKILL.md/flow.md 明确对 CLI 发 SIGTERM，不直接 kill Generator；在 run 目录写中止原因，impl 用新轮次，fanout 可恢复同一轮并复用成功 agent。 |
| P2 验证日志链接 | RESULT.md 使用相对自身的 `<n>-<name>.log`，state.log 保留 `verify/<n>-<name>.log`；精确检查两类路径并从 RESULT.md 目录解析链接，确认文件存在。verify 中断保留进行中的检查，恢复后顺序重跑全部检查。 |
| P2 宿主模型配置 | 支持 host.model，run/resume --model 优先覆盖；精确比较实际假宿主捕获的 argv 与 state.host.args，覆盖两命令、配置值、覆盖值、前台/后台及未指定模型时不传 -m。SKILL.md/flow.md 说明容量/网络失败后使用 resume [--model 其他模型] --bg。 |

最终验证命令：`node --test test/oneshot-skill/*.test.mjs`，退出码 0。

```text
ℹ tests 29
ℹ suites 0
ℹ pass 29
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11227.30425
```

3 × 2s fanout 并发区间实测 2156ms（要求 <4000ms）。全部自动化在隔离临时目录运行，
真实启动的是本 CLI，Generator/Evaluator/宿主使用假 Node CLI，未调用真实模型或改写历史运行证据。
SKILL.md 保持 ≤250 行。`git diff --check` 通过。
只修改 `.agents/skills/one-shot/`、`test/oneshot-skill/` 和指定的两份文档；未执行 git commit/checkout/stash/reset。
