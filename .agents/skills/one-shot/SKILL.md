---
name: one-shot
description: 一键开发、one-shot、从需求到实现的完整研发流程。由 Codex 宿主负责需求分析与设计，调用全新 Generator 实现，并行多模型改进设计与对抗评审，验证后交付证据；支持无人值守、后台与中断恢复。
---

# One-shot v2：宿主操作手册

你是 Planner；把设计打磨清楚，再交给全新 Generator。Evaluator 只读评审，Generator 不评审自己。
本 skill 是独立 Node ≥20 CLI，不是 OpenCode 内核 runner。先读目标仓库 AGENTS.md，遵守用户授权范围。
不自动 push、merge 或发布。用户禁止 commit 时保留全部未提交证据，并在交付说明。

## 入口与恢复

所有命令在目标仓库根运行。以下 `CLI` 指本 SKILL.md 同目录的 `scripts/oneshot.mjs` 的绝对路径；
使用 `node "$CLI" ...`。用户级安装的软链也可用。先读 [flow.md](references/flow.md)，了解各节点完成条件；
需要核对原文时读 [source-mapping.md](references/source-mapping.md)。模板在本 skill 的 `templates/`。

1. 先执行 `node "$CLI" status --json`。有匹配当前需求的未完成 run 则恢复；新需求不能混入旧 run。
2. 无匹配 run 时，将原始需求写入临时文件，执行 `init --title "标题" --req <文件>`；
   若用户指定尺寸则加 `--size S|M|L`，否则先用默认 M。记录返回的 run id 和绝对目录。
3. 后续每次命令都带 `--run <id>`（下文省略）；多 run 时禁止依赖默认选择。
4. `next` 返回第一个未完成节点及操作摘要；已完成节点和已有成功 agent 结果不要重跑。
5. 无人值守时不提问：自行选择合理默认值，将假设、备选、风险记入 BRAINSTORM.md「默认假设」。
   缺少必要能力导致无法实现时记录阻塞和证据，停在未完成节点，不能假报成功。

若用户从 shell 启动整条流程：`run "需求" [--size L] [--bg]`；已有 run 用 `resume [--bg]`。
两者会启动新的 Codex 宿主并加载本 skill。**已经作为宿主运行时不要递归调用 run/resume**，直接操作节点。
宿主 PID 和日志保存在 state.json、host.events.jsonl、host.log、host.last.md。

`fanout`、`impl`、`verify` 可能运行 10–60 分钟。调用时把 shell 工具的执行超时设得足够长
（例如支持 `timeout_ms` 时设为 ≥3600000 ms）；工具的提前返回/轮询间隔不等于执行超时。
若工具提前返回会话 ID 或进程仍在运行，必须持续等待到命令退出，再读取结果或进入下一节点。
若被打断，重跑同一命令恢复：复用已成功的 agent 结果或 Generator 报告，未完成部分重新执行；
`verify` 会重新顺序运行全部登记检查。CLI 收到 SIGTERM 会终止进行中的子进程组，细节见 flow.md。

## 尺寸判定与节点

Brainstorm 末尾判定，用户显式 `--size` 优先：

| 尺寸 | 判定 | 流程 |
| --- | --- | --- |
| S | 单文件或约 50 行以内，无接口/行为契约变化，vibe 小改 | brainstorm → impl inline → verify → deliver |
| M 默认 | 新功能/插件、多文件、有明确验收 | brainstorm → design → improve → impl → verify → deliver |
| L | 核心改动、并发/状态/安全、不熟悉或拿不准；或用户要求 review | M + review |

未显式指定尺寸时，用 `start brainstorm --size <S|M|L>` 保存最终判定。
其他节点开始后不能改尺寸；若后续发现范围变化，先记录并向原设计回写，避免静默跳过必要评审。

## 逐节点执行

### 1. brainstorm

- `start brainstorm`，阅读需求、AGENTS.md、相关源码与参考实现，需要时调研。
- 按 [brainstorm 模板](templates/brainstorm.md) 写 `<run>/BRAINSTORM.md`：范围、默认假设、边界、尺寸理由。
- 尺寸有变化且未显式指定时按上节保存；`done brainstorm`。

### 2. design（M/L）

- `start design`；按 [design 模板](templates/design.md) 写 `<run>/DESIGN.md`。
- 保留必备章节标题：目标与范围、验收标准、关键决策、实施计划、验证命令、变更记录。
  允许数字加 `.`/`、` 的编号前缀和括号等后缀；前 10 行写 `v1.0` 等版本号。
  验收标准用 A1/A2 等 ID、客观检查方法；决策列备选与取舍；计划精确到文件。
- DESIGN.md 必须自洽完整：新 Generator 只靠它与仓库就能实现，不依赖当前聊天隐含上下文。
- 把「验证命令」逐条用 `checks add "<命令>" --name <名称>` 登记；`checks list` 核对。
- `done design` 校验产物。允许提交时做 docs-only commit，message 含 `Design: <design 相对路径>`。
  禁止提交时记录留待审查，不因此中断流程。

### 3. improve（M/L）

- `agents` 查看探测结果（缓存 6h；要重探用 `agents --refresh`，每个最长 90s）。
- `fanout improve --round 1`，默认同时启动所有可用 agent；可用 `--agents a,b` 限定和 `--timeout <秒>`。
  Evaluator 默认每个 1500 秒；Generator 默认 3600 秒。
- 逐条阅读 `<run>/improve/round-1/<agent>.md`、失败原因和日志，自己裁决，不能直接照单全收。
- 按下方表格完成 SUMMARY.md，移除 `<!-- HOST_TODO -->`。更新 DESIGN.md 的版本与变更记录。
- 默认 1 轮；采纳 P0 设计修改可再 `fanout improve --round 2`，不得超过 config.maxImproveRounds（默认 2）。
- 每轮都完成汇总后 `done improve`；允许时提交设计与汇总，message 引用 Design。

### 4. impl

- M/L 执行 `impl`：以新 Codex 会话作为 Generator，只读入 DESIGN.md 与仓库，执行实现。
- 中断恢复时，无 `--fix/--round` 的 `impl` 复用上一份成功报告；需要重新实现则指定新轮次。
- 读取 `<run>/impl/round-N/report.md` 与实际 diff，确认无越界改动；偏离设计时先回写 DESIGN.md。
- Generator 输出成功后节点仍 waiting/running，需宿主检查后 `done impl`。
- S 执行 `impl --inline`，由宿主自行实施；把范围、改动、验证计划写 `impl/round-1/report.md`。
  S 的验收与检查命令写在 BRAINSTORM.md，同样用 `checks add` 登记，完成后 `done impl`。

### 5. verify

- `verify` 依次运行登记命令，日志写 verify/，全部通过才自动完成 verify。
- 失败时分析根因，把具体修复指令与证据写成 findings.md；M/L 用 `impl --fix <findings.md>`，
  优先恢复原 Generator thread（无 thread 则开新会话，state 留痕）；S 自己修复。
- 复查 report/diff、`done impl`，再 `verify`。修复后最多复验 3 次；仍失败写阻塞，停止并交付现状。
- 实际需要 OpenCode smoke 时必须跑真实 OpenCode；不得把假 agent 测试当作产品行为验证。

### 6. review（L 或用户显式要求）

- M 如需 review，应在 brainstorm 时选 L。`fanout review --round 1` 并行只读对抗评审。
- 输出必须含 `- [P0|P1|P2] 标题 — 说明 (evidence: path:line)` 和 `VERDICT: approve|request-changes`。
- 宿主独立验证每条发现，用 SUMMARY 表分诊，记录误报理由，采纳项写 findings.md。
- 有采纳项用 `impl --fix <findings.md>` → 检查 diff/report → `done impl` → `verify`。
- 本轮无被采纳的 P0/P1 即停止；否则继续下一轮，默认最多 config.maxReviewRounds=2。
  达上限仍有未解决 P0/P1，记录阻塞和残余风险，不能宣布验收通过。
- 所有轮汇总后 `done review`。若因阻塞未解决，不标完成，交付阶段只生成现状报告。

### 7. deliver

- `start deliver`，`report` 生成 README 索引；核对需求、设计版本、每轮意见取舍、实现、验证日志完整。
- 允许提交时提交代码、design、agent 汇总与验证证据；每个 commit message 含
  `Design: docs/oneshot/runs/<id>/DESIGN.md`。S 引用 BRAINSTORM.md。无需 Co-Authored-By。
- 用户禁止 commit 时说明待提交；本脚本从不替你执行 git commit。
- `done deliver --note "提交或待审查说明"`，再 `report` 刷新最终时间线。
- 最终向用户给出改动、验证摘要、Design/README 路径和已知限制。不自动 push/merge/release。

## SUMMARY.md 固定表格与降级

每轮保留 agent 的身份、模型、状态、失败/超时原因，Codex 多模型必须标明「同一 agent、不同模型」。
记录每条意见的优先级；改善设计与 review 都用这张取舍表：

| 建议（P0/P1/P2） | 来源 agent（模型） | 采纳/部分/拒绝 | 理由与证据 |
| --- | --- | --- | --- |
| 具体发现 | agent@model | 采纳 | path:line、验证方法与处理结果 |

另写本轮结论、设计版本变化、未解决项和下一步。无发现也写明审查范围与证据。
某 agent 不存在、未登录、超时、非零退出或空输出：记录原因，其他 agent 继续。
≥1 成功即可继续；0 成功会生成 DEGRADED.md，宿主必须自评并在 SUMMARY.md 显式标 `DEGRADED`、
自评范围与局限，记录默认假设后继续；不将自评冒充独立 Evaluator。
成功结果恢复时复用；失败可重跑同一 `fanout ... --round N`，已成功的不重跑。
脚本只生成汇总骨架，不会替你采纳建议、更新设计或自动关闭 improve/review。

## 配置与安装

`config.json` 是默认池；目标仓库 `oneshot.config.json` 可覆盖（agents 数组整体替换），
也可每次 `--config <文件>`。探测只接受成功退出且回答含 PONG，认证错误优先判不可用。
其他 CLI 的 readonly 参数与 prompt 约束取决于对应版本；启用前核实其只读能力。
详见 [flow.md](references/flow.md) 的配置说明。CLI 不导入内核私有模块。

`sh <skill>/scripts/install.sh` 将整个 skill 软链到 `~/.agents/skills/one-shot`；已存在其他内容会拒绝覆盖。
