# Steering 与 OneShot 源码对照

日期：2026-10-28（Pacific/Auckland）。本文是对用户提供的本地源码逐项核对，不是对其他产品运行速度或模型质量的排名。其他项目没有在本次安装、构建或运行。精确仓库身份见 `.codeagent/package-real-steering-20261028/source-inventory.json`。

## 读取的版本

| 项目 | 本地目录（均位于 /Users/penghao/Documents/code） | 完整 commit | 工作区 |
| --- | --- | --- | --- |
| DSH | codingagent/DSH/deepseek-harness | 687f282e8625c6b8d11ff58211a90524be2e4317 | clean |
| Codex | codingagent/codex/codex | a96fa4f220700544a1202ec7ae411e432715151f | clean |
| 新版 OpenCode | codingagent/opencode/opencode | 4d30794bcf4dccdcadbcb1f62bb35b4943a96426 | clean |
| Pi | codingagent/pi/pi | 936e5f40aede9327b9142b63506ed2b68bc6b4ac | clean |
| 本项目 | oneshot/one-show-code/opencode-1.0old-branch | 915d9f9a8af90a384aee389fc01b71e425d6503e + 本次未提交补丁 | dirty |

目标内核仍为 `517e6c9aa4c61dbc125e7654fc596f1d529f20d9`，未修改其 tracked 源码。本机用于真实模型桥接的 Codex CLI 是 `0.164.0-alpha.11.1`；不能把所给 Codex 源码 commit 当作该二进制的精确构建身份。

## 实际调用链与区别

### 本项目：在固定公开插件 API 上约束旧动作

入口是 `external-plugins/src/index.ts`：公开插件加载器调用 CodeAgentPlugin，后者组合 bundled registry 与 SteeringPlugin；不是往原内核偷偷加入 bootstrap。

- `external-plugins/src/steering.ts` 注册 chat.message、messages.transform、tool.execute.before、compacting 和 event。
- `external-plugins/src/steering/ledger.ts:355` 观察消息，区分持久化证据、显式 steer、活动会话输入和历史。
- `ledger.ts:390` 在准备请求时记录 assistant 与用户消息指纹的覆盖关系。
- `ledger.ts:451` 在可用的工具检查点核对新指导；旧上下文调用收到 STEERING_STALE_CONTEXT。
- `ledger.ts:243` 附近的恢复调度按指导指纹有界执行；取消、失败、删除等生命周期会抑制不应发生的自动恢复。
- `ledger.ts:85` 明确保留 provider/adopted unknown。请求准备过并不证明 provider 收到，更不证明模型理解了指导。

优势：保持外置、容易随包分发，不必维护私有内核补丁；可以在旧模型响应已经形成、对应工具尚未经过检查点时阻止旧动作；有可审计的消息与快照证据。

代价：缺少内核事务。不能提供 expected_turn_id 原子拒收，不能撤销已越过检查点或已完成的动作；batch 内部子动作、StructuredOutput、MCP 权限等待等公开边界存在缺口。状态文件不是可自动恢复所有待处理输入的原生 inbox；重启不会自动执行历史 pending。失败时保守阻断也可能带来需要人工检查的停顿。

这些不是只读源码推测：本次真实包验证了 stale bash 拦截、连续插话、取消、工具执行中改向和完成边界继续运行；其他边界仍按源码限制报告，不能扩大成全部工具、全部 provider 的实测保证。

固定内核自身已有 busy 输入与自然继续：`agent-kernel/packages/opencode/src/session/prompt.ts:1370` 根据最新 user/assistant 及工具结果决定是否继续循环。本次普通 TUI 完成边界例的 ledger.recovery.attempts 为空，没有 synthetic 恢复控制记录，因此不能把该例描述为“插件恢复分支被触发”。原始 harness 的 automaticRecovery 标签过宽，最终审计以原始消息与 ledger 为准；后续 verifier 已改为区分 automaticContinuation 和 pluginRecoveryObserved。插件的增量应通过“已生成的旧工具有没有被拦住”等证据评价，而不是把原生已有的普通对话继续也算作新实现。

补做的真实无插件对照已验证这一点：同一包关闭外置插件后最终也写出了新目标，但已生成的旧调用先创建了 old.txt；启用插件时对应调用被 STEERING_STALE_CONTEXT 阻止，old.txt 不存在。两组均为真实模型与原生 bash，不是预制 provider 答案；并未据此比较速度或整体模型质量。

### DSH：驱动器拥有持久化 inbox

来源：[agent.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-loop/src/agent.ts#L167)、[inbox.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-loop/src/inbox.ts#L25)、[tool-calls.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-loop/src/tool-calls.ts#L200)。

`steer()` 进入 next-step，followup 进入 next-turn，inject 不唤醒驱动器。inbox 由 session 事件投影重建，splice 检查位置与跨队列重复 ID，claim 先领取 next-step，再按边界领取 next-turn。取消默认清空 inbox，也有显式 keepInbox；中止后的唤醒输入被重新归类为下一 turn。

优势：排队、领取、取消和回放都在驱动器内部，持久化职责清楚，比插件从消息历史推断 pending 更直接。代价：必须拥有整个 agent-loop/session 体系；不能把这段队列代码复制进 OpenCode 外置插件就获得相同原子性。该版本工具调度器按 abort signal 控制已启动/待启动调用；仅调用 steer 并不等于撤销当前执行的工具。

### Codex：明确的活动 turn 接收协议

来源：[turn_input.rs](https://github.com/openai/codex/blob/a96fa4f220700544a1202ec7ae411e432715151f/codex-rs/core/src/session/turn_input.rs#L843)、[input_queue.rs](https://github.com/openai/codex/blob/a96fa4f220700544a1202ec7ae411e432715151f/codex-rs/core/src/session/input_queue.rs#L175)。官方协议说明：[App-server — turn/steer](https://developers.openai.com/codex/app-server/)。

`steer_input` 在 `active_turn` 锁内校验活动任务、`expected_turn_id`、允许的任务类型（拒绝 Review/Compact）、空输入与输出 schema 后入队，返回被接收的 turn 身份（`turn_input.rs:843–929`）。该函数本身没有显式 cancellation token 检查；`input_queue.rs:179–204` 的 mailbox 投递路径才有该条件（`:189`，位于提供 `expected_turn_id` 时的分支），不能用它证明 `steer_input` 本身验证取消。是否由外层状态转换间接保证，**未核实**。文件开头也明确：接收答复不等于已经跑完 hooks、更新模型上下文、持久化或采样。

优势：客户端可以精确针对活动 turn，过期输入有明确拒收结果；接收检查与入队处于同一内核控制域。代价：协议与内核耦合，客户端需处理无活动 turn、ID 不匹配等错误。原子接收仍不保证模型语义采纳；也不等于任意在执行的外部副作用都能回滚。

本插件可借鉴“saved/prepared/received/adopted 分层”和过期输入诊断；固定公开 API 没有相应事务，不能声称复制了 Codex 的原子保证。

### Pi：轻量队列与清晰的继续边界

来源：[agent.ts](https://github.com/earendil-works/pi/blob/936e5f40aede9327b9142b63506ed2b68bc6b4ac/packages/agent/src/agent.ts#L308)、[agent-loop.ts](https://github.com/earendil-works/pi/blob/936e5f40aede9327b9142b63506ed2b68bc6b4ac/packages/agent/src/agent-loop.ts#L184)。

Base Agent 分开保存 steeringQueue 和 followUpQueue。循环在开始、长准备阶段之后和 assistant turn 结束时领取 steering；本来要停止时再看 follow-up。提供 drain、clear 和队列模式等接口。

优势：SDK 较轻，steer 和“当前任务结束后再做”语义分开。限制：这里核对的是 Base Agent 内存队列，不把它当成 DSH 那样的持久化 inbox；此版本循环在 executeToolCalls 返回后再领取新 steering，不能从 API 名称推导出它会撤销当前 batch。应用层可能另做持久化，本次未据此作产品级断言。

### 新版 OpenCode：原生数据库 inbox

来源：[session/inbox.ts](https://github.com/anomalyco/opencode/blob/4d30794bcf4dccdcadbcb1f62bb35b4943a96426/packages/core/src/session/inbox.ts#L45)、同仓库的 session inbox 数据库迁移。

以 SQL 行和 enqueued_seq 保存输入；每会话 KeyedMutex 序列化处理。promote 区分 steer 与普通 input，处理生命周期、压缩、移动等边界，steer 具有明确的领取优先级。

优势：消息持久化与调度在内核中统一；比“已经保存的聊天消息 + 插件 ledger”更适合扩展原生队列 UX。代价：这是另一套 core/schema/session 架构，不是本项目固定 1.3.17 的公开插件能力；迁移它需要单独的升级决策和兼容测试，不能私自导入其内部模块。

## 对 OneShot 本身的评价

当前 skill 不是只有一篇提示词：`.opencode/skills/one-shot/SKILL.md` 负责需求、入队和交付约定，`agent-kernel-extension/src/codeagent/one-shot/runner.ts` 实现实际状态机。

| 能力 | 源码证据 | 评价 |
| --- | --- | --- |
| 设计落盘 | runner.ts:180，保存 DESIGN.md | 有真实阶段与工件 |
| 并行设计/代码评审 | runner.ts:186，Promise.allSettled | 有并行调用；配置允许只有一个设计 reviewer、零个代码 reviewer，不自动等于四模型 |
| 不同模型视角 | types.ts:41、50 只检查 reviewer ID 唯一 | 多 ID 可指向同一模型；历史 7 会话验证使用同一 Codex 通道，不能宣传为多模型验收 |
| 标准与检查绑定 | runner.ts:18、28，检查 ID 和成功证据 | 比“任意测试绿了就完成”可靠；manual 项必须保留待人工 |
| 受信检查与改动边界 | trust.ts、runner.ts 的 guard/fingerprint | 可检测已建模的改动和可信入口变化；不等于全系统操作系统隔离 |
| 受控返工和交付 | runner.ts 的修订/修复上限、handoff | 达到 awaiting_acceptance；不自动变成人工 accepted |
| 参考实现源码对照 | agents.ts 提示读 external-plugin-dev；该 skill 引用 source-comparison.md | 是工作规范，不是 planSchema 强制的结构化验收字段 |

“以前 OneShot 到底逐一对比源码了吗？”：已有 STEERING.md 记录 Codex/Pi/新版 OpenCode 的机制取舍，但本次检查的旧 OneShot DESIGN 和 run 状态没有四个参考仓库的完整来源清单。不能仅凭那些文档倒推每轮模型真的读过所有源码，更不能补称旧 run 已审计 DSH。旧 run `run-1e5b897b-36ce-47a6-a9da-ffec7d9fb465` 确实有 7 次阶段调用、5 组成功检查，状态仍是 awaiting_acceptance；这证明编排执行过，不证明源码对照覆盖完整。

本次已补齐上述四库的身份和具体调用链。建议下一版将 sourceAudit 作为可选但一经需求指定就必需的结构化工件：repo/commit/dirty、文件与行、机制、公开 API 映射、优点/代价、证据缺口。只保存一段“参考过某 agent”的设计文字不应满足该检查。

## 建议优先级

1. 保留已验证的外置方案作为固定内核的实用版本，明确“当前工具可完成、后续检查点改向”，不要叫全局即时中断或 exactly-once。
2. 补充队列/保存/准备/失败的用户反馈；继续保留 provider 与 adopted 的诚实 unknown，不用 UI 文案伪造保证。
3. 把用户指定的源码对照清单绑定进设计与独立评估；配置检查模型多样性，不能只看不同 agent ID。
4. 如确实需要 Codex/DSH 级原子接收、完整持久化 inbox 和编辑队列能力，应单独评估内核升级或正式公开扩展点。当前规则下不通过私有导入或修改固定内核冒充实现。

这些是本次源码审计的建议，尚未作为新功能实现；没有将建议写成已完成能力。

变更记录：2026-11-04，按 `docs/review/legacy-codex-audit.md` 第 8 节（L-17）修正 Codex 取消检查归属，区分 `steer_input` 校验与 mailbox 投递条件，并标记外层间接保证未核实。
