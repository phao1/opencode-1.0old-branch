# One-shot 自动化开发框架 Spec v0.7 / Steering v2.1 (0.5.0)

Steering 的当前规范为 [STEERING.md](STEERING.md)，公开 API 证据见 [STEERING-FEASIBILITY.md](STEERING-FEASIBILITY.md)。旧 v0.1 的提示包装不满足本版行为验收。

更新：2026-10-25。本版取代 v0.3 的具体跨会话产品需求。

## 目标与范围

用于在固定 OpenCode 1.3.17 内核上自动开发外置插件。完整链路：监控/反馈 → 分析与候选 issue → todo → 设计 → 并行设计评审 → 实现 → 独立验收 → 可选代码评审/修复 → PR → 人工验收。

跨会话消息、Unix socket、棋局等是被开发需求的案例，本框架不实现这些产品功能。保留其工程教训：外部材料不能授予权限；失败必须真实报告；状态可恢复；循环、并发与资源必须有界。

## 验收要求

| ID | 框架必须提供的行为 |
| --- | --- |
| F01 | 手工/结构化反馈/文件信号/Claude Code 与 Codex release 可进入统一候选队列，包含来源、证据和去重键；定时 loop 可恢复，失败不会推进游标。 |
| F02 | release 记录 changelog、版本和可获得的 GitHub compare 证据；生成分析报告及候选需求。获取不到代码明确记录，支持外部分析/benchmark 命令接口。 |
| F03 | 候选 issue 支持本地管理与 GitHub todo label 拉取；只有明确配置的可信 issue 作者/标记者可自动触发。重复投递不重复启动。支持 from-triage ID。 |
| F04 | todo 自动入队；持久化阶段、尝试、决策、错误、用量、工作目录、分支和产物。停止、恢复、取消、失败重试有明确状态；单机多进程不得同时执行同一任务。 |
| F05 | 隔离 Git 工作目录，配置并发上限；保留目录以便恢复和诊断。固定内核 commit，发现原生内核修改或超出允许路径时阻断交付。 |
| F06 | Planner 保存需求分析、设计、边界条件、实施计划、可验证验收标准；并行独立设计评审，合并意见并修改设计后才编码。 |
| F07 | Builder、Reviewer、Evaluator 独立调用/会话；评审 fanout 可配置，支持不同模型/命令适配器及故障 fallback。不可把不可用 reviewer 算作通过。 |
| F08 | 必需的真实命令检查 + 独立 Evaluator 按每条标准提供 pass/fail 和证据。Web 可配置 Playwright，API/DB/CLI 可配置实际验证命令；不凭模型自评或截图放行。 |
| F09 | 有限次修复后重新跑检查与验收；可选并行代码评审。反复失败转 blocked，并提示重新审视架构；保存评估 prompt 版本与反馈记录。 |
| F10 | 输出 DESIGN、评审、命令日志、验收报告、测试手册、PR 正文、可复用 skill 建议。可配置通过 git/gh 提交分支和 draft PR，失败重试不重复建 PR；合入和最终验收由人决定。 |
| F11 | 插件工具和 /one-shot、/create-issue 提供实际操作入口；独立 CLI/worker 执行持续任务。终端关闭后的持续执行由用户的服务管理器承载。 |
| F12 | 时间/调用次数/重试/输出大小/并发有上限；token/cost 以适配器实际返回为准，未知不伪报。无凭据时保留 blocked 原因和可复查产物。 |
| F13 | Codex、Pi、OpenCode 源码仓可独立于 Release 定时扫描。固定 ref，记录 base/head commit，保存 Git 缓存、diff、变更文件内容与永久链接；分析成功后才推进游标。文件/字节上限、遗漏、二进制、历史缺失必须明确记录。外部源码不执行、不自动授权开发。 |
| F14 | PR/dev 的 GitHub Actions 在 macOS 分别构建 Apple Silicon arm64 / Intel x64 原生 CLI 测试包，包括外置插件、命令/skill、独立 worker、配置示例、启动脚本与版本/校验清单。临时内核 checkout 承载原生构建生成文件，不改工作区内核。上传 Actions Artifact 供人工测试，不自动发布 Release。构建失败不得声称产物可下载。 |

## 源码输入与测试交付

源码来源：openai/codex（main）、earendil-works/pi（main）、anomalyco/opencode（dev）。上游 OpenCode 是观察对象，agent-kernel 仍固定原 baseline，源码发现不会自动升级内核。首次扫描分析 tip 与其父提交，后续分析上次成功 commit 到最新 tip 的差异。源码报告区分已证实实现、推断、与本项目公共插件 API 的适配障碍、许可证复用约束和验收建议。

测试产物为 portable tar.gz（Actions 下载外层 ZIP），CLI opencode 与插件分发包一起使用。原生可执行文件不等于 Desktop 安装器，也不代表外置插件/Node worker 已被嵌入内核。Actions artifact 有保留期限，正式长期归档到 Release 需人工选择已验收提交。PR 提交触发构建；仅保存在本地、未推送的 one-shot 运行不会自动出 GitHub 产物。

## 非固定参数

五并发、四评审、07:10、80% 设计时间都是案例参考。评审数量、调度、预算、修复次数可配置。模型改进后可调整评审轮次、prompt 和验收命令；可靠性不依赖隐式会话记忆。

## 状态与人工入口

候选 candidate → todo → queued → designing → design_review → implementing → verifying → code_review（可选）→ handoff → awaiting_acceptance → accepted。blocked/failed/cancelled 保存最后可恢复阶段。人工 reject 带原因回到修复与验收。外部材料不能自动修改配置、执行命令或把自己提升为 todo。

## 完成验证

- 真实临时 Git 仓库中，用确定性协议适配器执行全链路并检查真实文件、测试命令和 Git diff；此证据仅证明编排，不冒充真实模型质量。
- 独立调用、并行设计评审、缺少标准/证据拒绝、修复重验、失败恢复、重复触发、取消、只读内核、PR 重试有测试。
- 固定 OpenCode 内核启动后实际暴露 one-shot 工具；如无模型凭据，明确说明模型端到端尚未验证。

## v0.6 skills 需求（2026-10-23）

入口 one-shot 负责需求确认、队列和交付；create-issue 负责证据与稳定验收标准；新增 external-plugin-dev 负责固定内核公开 API 映射、外置实现及源码对照。worker prompt v2 显式要求读取当前 checkout 的开发 skill，保持各 role 的只读/写入权限及 JSON 协议。阶段指导与来源取舍位于 one-shot/references/。不新增调度器、模型适配器或隐式监控。

需求依据是用户提供的 2026.06 长文和 8 月升级帖正文，原作者完整 skill 未提供。多 reviewer 的意见由 planner 单写合并；固定四模型和设计时间比例不是验收条件。参考源码未到位时明确记录缺口。新 skills 需进入 run 的 base commit 才会在隔离工作目录生效。

变更记录：v0.6 补全研发技能与来源追溯；验证记录见下。

## v0.7 验收门禁（2026-10-25）

F2：验收标准必须绑定全部对应 checks 或明确 manual:true，原始描述/绑定不可被 planner 改写；人工项只能 MANUAL/PENDING。F6：空/未绑定候选不入队，同源内容变化必须显式报冲突；只允许显式更新未入队 candidate。F1：受信脚本和 skill 基于 baseCommit 或操作员 SHA256 固定，执行与交付前后重验，不能改写检查来通过验收。具体标准 H2/H6/H1/HM/HE、设计及验证记录见 [ONE-SHOT-HARDENING.md](ONE-SHOT-HARDENING.md)。

## Steering 外置插件 v0.3（历史，当前为 v2.1）

目标是在同一运行任务中接收方向修正，保留既有消息和已完成工作，并阻止尚未通过公开检查点的旧计划工具。验收 ID 及原文集中在 STEERING.md 的 ST-01 至 ST-08，避免维护两套含义不同的标准。

实现只使用固定内核的公开 Hooks、SDK 和普通消息路径。逐条记录保存确认、上下文准备、provider 与模型采纳证据；未知必须明确显示。取消、任务终止、压缩及重启不能让未送达消息被误报为完成。独立包必须从 tgz 安装后在真实内核运行，实际模型改向与确定性调度验证分别留证。

没有公开的 expected_turn_id 原子接收、正在执行工具的撤销、batch 内部逐子动作检查点。StructuredOutput 和较旧 ID 延迟保存的终止漏送均有真实反例；v0.3 在成功结束后用可辨认的 synthetic 控制记录启动下一请求，原指导不重复提交。已观察到取消或失败时不自动续跑；公开 API 无法让取消与派发原子互斥。未满足项按失败或未知交付，不用边界说明替代通过证据。

### v0.3.2 历史删除（2026-10-24）

Undo 后继续任务和公开消息删除不得永久阻断同一会话。只有收到公开 `message.removed` 并通过 SDK 确认有效输入已不存在，才将原证据标为 `pendingReason: removed`，保留原准备与未知采纳记录。无删除确认的 SDK 缺失仍拒绝工具；附件删除不视为整条消息删除。同 ID 输入重新出现时重新检查，不继承删除豁免。验证汇总见 [STEERING-DELIVERY.md](STEERING-DELIVERY.md)。

## Steering v2.1 / 0.5.0（2026-11-04，当前）

以 [本轮 DESIGN v1.3](../oneshot/runs/20261104-0553-steering-v21/DESIGN.md) 和 [STEERING.md](STEERING.md) 为准。最小请求作用域 state：最近普通或摘要 transform 后的有效 user ID/part ID；普通工具有 pending 才拒绝，未知/native prt_/status 放行。每次 transform 消费全部旧 pending；只在有效同 ID 普通请求附加一次提醒，摘要及换 ID 不传递此前提醒；摘要 transform 后的新输入仍登记，供后续普通 transform/成功 idle 使用。歧义清全部关联；常态 observe/transform/gate/streaming/status 零 history。公开 transform 共享输出，Steering 应在变换用户消息插件之后加载，G1/G3 只覆盖本 hook 检查点。

status-idle 后75ms 单次 history，用最后一个 assistant（含 summary，须成功且不跳过失败/未完成者）的 parentID 对应 user 在数组中的位置作边界，最新有效 user 必须属于忙碌 pending 且晚于 parent。summary 的 parent 是 compaction trigger，trigger 之前的指导不恢复，避免引用原生已过滤内容。失败/不确定/慢保存放弃；status/get 及保存前许可复核，每次 await 校验 identity，5秒过期。第二次 status-idle 视为取消，deprecated idle 忽略。恢复候选的 part 更新在 active 删除后也失效许可，任何同会话消息/part 删除保守放弃恢复（含无关删除），不增加 history 查询。只识别本进程按会话签发的控制 key，派发30秒后回收；未知/缺失/跨会话/过期key按普通synthetic放行。自家失效控制使用随机错误 token，迟到错误不清新真实请求。继承 model/agent/system/variant/format，省略 tools。autoResume:false 不读恢复历史；活动 noReply 必须关闭恢复。

G2 控制保存原指导 ID 及简短重新读取继续要求。首个明确普通 transform 同步捕获现有恢复候选并失效许可，与 active.pending 一起按有效 user ID 检查后临时加一次 G3，随后消费全部候选。下一工具轮 G3 数为零。缺席/编辑无效、取消/过期的候选不能在后续请求补发提醒，摘要保持仅消费。原始已保存消息由原生存储保留。

取消/结束/错误/删除/revert/压缩清理，内存随当前活动及输入量增长，没有拒绝普通输入的128/256上限。故意放弃 v2.0 指纹、快照、压缩覆盖、overflow replay、反复提醒和未知持续阻断。保存失败/过滤/编辑/重启/压缩可漏拦；不承诺原子取消、provider/adopted（始终unknown）、语义采纳或已开始工具回滚。回归、安装和真实暂扣/自然TUI证据见 [本run索引](../oneshot/runs/20261104-0553-steering-v21/README.md)。

变更记录：2026-11-04，Steering v2.1 fail-open 重写；DESIGN v1.2评审修复摘要观察/最后assistant、恢复编辑与控制签发身份。DESIGN v1.3 将恢复 G3 改为首个普通 transform 的临时单次注入，官方 provider 验证 1→0。one-shot 框架沿用原规格。以下 v2.0 各轮说明仅历史。

## 历史：Steering v2.0 / 0.4.0（2026-11-04）

当前独立实现位于 external-plugins/steering/src，使用 @opencode-ai/plugin@1.3.17 的公开 hooks/SDK。验收以 [本轮设计 A1–A10](../oneshot/runs/20261104-0426-steering-v2/DESIGN.md) 为准。旧 ST 标准与 ledger 记录保持历史身份。普通输入原文/附件由原生内核保存；插件只保留有界进程内证据。prepared、provider、adopted 分离，后两者 unknown。

同一 assistant 的多个未过 gate 旧工具都拒绝；晚保存指导在成功 idle 后按版本最多一次 synthetic continuation。permit 在取消/错误/删除/压缩/revert、新输入或正常准备后失效。native SubtaskPart/未知 task 安全豁免以避免 running 悬挂；普通已确认模型 task 仍 gate。重启不重放，autoResume:false 可关闭；活动 noReply 不能辨认。原子取消/派发、已运行工具、batch 内部、StructuredOutput 与运行中子代理转发不在保证范围。

根默认 npm test 包含真实官方 1.3.17 + 本地 SSE 确定性对照；真实 Codex headless 和 tmux TUI 对照单独执行。安装、CI 精确二进制供给、限制及证据见 [STEERING.md](STEERING.md) 与 [本轮索引](../oneshot/runs/20261104-0426-steering-v2/README.md)。

变更记录：2026-11-04，Steering v2 取代磁盘 ledger 默认实现，更新公开 API 契约与 A1–A10 验证入口；one-shot 框架规格未改。

### 历史：Steering v2.0 round 2 修复（2026-11-04）

按 run DESIGN v1.3 修复：仅 info/空 parts/长时间历史缺席不清退已观察候选，保留原预期 part 指纹及后续保存确认能力，无法确认时在 status 给出未知/人工检查诊断；不再按 1.5 秒年龄删除。所有并发 gate 等待同一 in-flight history，fallback 标记不再让普通 task 提前套用 native 豁免。

压缩开始标记由 summary transform 消费，完成事件清除而非重新置位；记录本次 summary 实际包含的指导版本，仅成功后标 compacted，保持与普通 prepared 分离。后续包含对应 summary 的请求可获得该覆盖；后到/编辑版本与失败 summary 不继承退役。成功终止且 idle 时释放 settled/compacted 证据和无用快照，保留 pending/unknown；256 上限约束未解决输入，不再限制整个会话普通输入总数。聚合入口原样转交第二参数（含 autoResume:false），扩展注册和 worker 行为不变。

变更记录：2026-11-04，第二轮实现及回归；[本 run 索引](../oneshot/runs/20261104-0426-steering-v2/README.md) 保存结果，旧轮报告/原始评审证据不改写。本轮未重新运行真实模型演示，正式全量验证由宿主执行。

### 历史：Steering v2.0 round 3 / DESIGN v1.4（2026-11-04）

连续摘要只在输入包含旧 covering summary 且当前内容版本未变时继承覆盖，成功后替换为新 summaryID；失败/未包含/编辑/晚到版本不继承，不建无限 lineage graph。摘要请求、覆盖摘要后的普通请求及 native replay 请求均带静态最新优先/保留完成结果/报告跳过动作提示；安全 idle 后仅保留一个最新 summary 提示标记，不宣称摘要语义完整。

overflow replay 使用当前压缩窗口、公开 auto/overflow trigger、成功 summary、相邻 native 新 ID、严格内容及 model/agent/system/variant/format/tools 对照，只在真实请求包含完整匹配的 replay 时将原指导版本绑定为 prepared。新真实输入/取消失败/新压缩/首次后续请求关闭窗口；不把任意同文历史当原指导。text/plain 及生成文本保持；image/*、application/pdf 按固定源码转换为 Attached 占位文本，原媒体不在 replay 请求中。status 的 replayedAs/mediaStripped 明确此区别，不重注大附件。

新候选的 info-only/慢保存继续保守保留；已保存输入经公开编辑及当前历史校准为空白/ignored/synthetic 后不阻断或恢复，观察仍保留时改回有效内容重新 gate。取消/失败会话只有明确 idle 且无 running/permit 才清理，active 或未确认边界保留安全容量上限。独立包 exact public plugin dev/peer 仍为 1.3.17，peer optional 表示类型/host API 约束；单文件 runtime 依赖继续内嵌，packaging 使用全新空 npm cache 真实离线安装并检查 peer 未安装。

变更记录：2026-11-04，第三轮六项采纳修复与客观回归；完整正式 verify（含真实 headless/TUI）由宿主执行，旧轮评审/证据不改写。
