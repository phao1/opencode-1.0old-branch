# 固定内核 Steering 可行性结论

基线 `517e6c9aa4c61dbc125e7654fc596f1d529f20d9`。本文件只记录已核实能力，正式插件仍需独立验收；测试 provider 的确定性响应不是模型智能的证据。

| 用户行为 | 公开集成路径 | 已核实结果 |
| --- | --- | --- |
| 运行时输入修正 | 原生 TUI 普通输入 → SDK session.prompt → chat.message → message/parts 持久化 | TUI 源码未因 busy 禁用输入；真实 HTTP 消息保存已验证。权限/提问弹窗仍禁用输入。尚未做交互式 TUI 验收。 |
| 下一轮读到修正 | 原生 runLoop 重新读取消息 → messages.transform → provider 请求 | 实际内核 + 确定性 provider 观测到第二次请求包含修正，且会话只有两条用户消息，无额外提交。 |
| 阻止旧计划的后续工具 | tool.execute.before 查询公开消息 API，核对模型快照，抛普通工具错误 | baseline 执行 old、revised 两动作；有检查点时只执行 revised。普通 tool-error 不自动中止循环。实验仅证明此路径，生产实现须处理压缩、并发、重启和错误。 |
| 识别终止后的未送达 | session.messages/status 与结构化结果 | 结构化输出竞态已复现：两条用户消息均保存，但完成后只有一次 provider 请求，会话已空闲。不能报告引导已送入模型。 |
| Codex 式原子接收 | 活动 turn 标识与接收锁 | 固定公开 Hooks/SDK 没有 expected_turn_id 或与接收合并的原子锁。status 查询不能替代；无法宣称完全等价。 |
| 无新消息的继续运行 | 公开 session.prompt_async 的 messageID + 空 parts | 已实测同 ID upsert 可以唤起 StructuredOutput 结束后的循环，保留两条逻辑用户消息及原 parts；裸调用会改写元数据。chat.message 通过公开 SDK 读取并原位恢复旧 info 的探针保留了原字段。不是独立 resume-loop 或原子恢复接口。 |

## 直接证据

- `scripts/smoke-one-shot.mjs`：隔离 XDG、测试 home 和配置目录；正式安装公开 plugin 依赖；真实固定内核加载四个 one-shot 工具并持久化普通及显式文本。此脚本的历史 v0.1 文案断言不是完整 steering 验收。
- `scripts/probe-steering-api.mjs`：真实内核上的工具边界对照实验。首次 provider 响应被测试服务器暂扣，确认修正已持久化后才返回旧工具调用；两组请求、工具事件、保存消息都留档。
- `scripts/probe-steering-termination.mjs`：同样的在途顺序，但首次响应为 StructuredOutput。退出 0 表示成功复现交付缺口，**不是功能通过**。固定内核的 StructuredOutput 不经过普通 tool.execute.before，随后 structured 分支直接退出循环。
- 终止边界摘要与原始报告校验和见 [evidence/steering-termination.json](evidence/steering-termination.json)。完整原始报告在本地 `.codeagent/structured-boundary-report.json`；其中包含测试 provider 的请求、持久化消息与 hook 事件。
- `scripts/probe-steering-resume.mjs`：裸 same-ID wake 的证据在 `.codeagent/steering-resume-2bo7cq/report.json`；`PRESERVE_METADATA=1` 的证据在 `.codeagent/steering-resume-Ls4IyJ/report.json`。两次实验均为两条用户消息、两次 provider 请求，活动期间及完成后的重复 wake 未新增请求；三次 wake 均重新触发 chat.message。恢复模式的 hook 前后 info 深度比较通过，运行中内核仍会自然增加 summary。不能将这些指定时序推广为 exactly-once。

## 工具检查点及结束边界

公开检查点只能阻止尚未通过该检查点的外层调用。batch 工具内部直接执行子工具，没有每个子动作的独立 hook；MCP 检查点位于权限等待之前；已经启动的 task 子会话也不由父会话检查点暂停。这些边界已核对固定源码，不能宣称能撤销所有尚未发生的副作用。

除 StructuredOutput 外，scripts/probe-steering-late-save.mjs 已通过原生自动 ID 与公开 chat.message 屏障实测普通文本结束反例：指导 ID 早于 assistant ID，但持久化晚于上下文准备；同 ID wake 仍在 transform 前退出。独立 synthetic 控制记录可启动下一请求，原指导、附件和权限保持不变。原始证据为根 .codeagent/steering-late-save-qKGux1/report.json；最终包另用 scripts/verify-steering-late-save.mjs 验证。

same-ID wake 可作为显式续跑的候选，不默认自动复活取消或失败的任务。公开 API 没有取消与唤醒的原子互斥，读取元数据后也可能遭遇并发改写。运输层再次提交不等于重复逻辑用户消息；验收仍必须检查消息、附件、元数据及实际动作。若从同会话工具发起，不可同步等待 session.prompt 的活动循环，否则可能等待自身；异步提交也不等于模型已接收。

## 后续实现的约束

不能把“已保存”“上下文已准备”“provider 确实收到”和“模型采纳”合并成一个成功状态。任何无法通过公开 API 观察的状态都应明确为未知。独立 tgz 的构建、安装、加载和真实模型行为必须分别取证。

已证明的缺口需要在最终交付中说明；这些结论不授权修改固定内核，也不自动放宽 ST-01 至 ST-07。若设计不能满足某项，one-shot 应如实报告，不能削弱检查换取绿色结果。

## v0.3 recovery revision

Same-ID upsert is not the production recovery protocol. It can rewrite metadata, copying historical `tools` can reset current permissions, and an older ID may still hit the normal-finish exit condition. The enhanced root probe `.codeagent/steering-resume-2Qu3kU/report.json` proves that omitting `tools` retains a later deny policy. It also shows that already-idle abort and normal completion both emit idle notifications without a reason; those notifications cannot prove absence of cancellation.

The product uses the public SDK's `TextPartInput.synthetic` to append one identifiable continuation control. It does not duplicate guidance or force compaction. Recovery is bounded to guidance observed during an active task in this process; attempts are persisted before dispatch, unknown results are not retried, and restart does not dispatch old pending entries. A final public hook rechecks lifecycle and guidance. TUI source filters synthetic-only bubbles, while the public message API and provider retain the control record. See [STEERING-RECOVERY.md](STEERING-RECOVERY.md) for the state machine and non-atomic cancellation boundary.
