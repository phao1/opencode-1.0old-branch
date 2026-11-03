# Brainstorm — steering v2

版本：v1.0；日期：2026-11-04（Pacific/Auckland）

## 需求与范围

在固定 OpenCode v1.3.17 上重写独立外置 steering 包。普通活动会话输入即插话；补齐尚未经过公开检查点的旧工具拦截、完成边界的有界继续和明确提示。保留原生消息存储与调度，不复刻内核 inbox，不修改只读 submodule。执行需求见 REQUIREMENT.md。

## 默认假设

- 无人值守，不提问；用户已指定 L。允许本地提交（skill 的默认交付方式），不 push、merge 或发布。只提交本 run 与本功能的变更，其他 run 不纳入。
- 普通非空文本（含可选 steer: 前缀）及附件作为指导，不新造输入命令或 TUI。空输入、synthetic 控制、历史消息不主动唤醒；指令原文和附件不修改。
- 不提供 queue/follow-up 或紧急 abort。它们需要更明确的接收/取消协议，不能用外置 hook 假装内核原子调度。
- 以本进程事件与每次请求快照为依据，不持久化 ledger；重启后不自动恢复历史插话。取舍是简化状态、消除损坏文件阻断及跨实例文件竞争，代价是状态仅供当前运行查询。
- prepared 表示请求准备阶段包含了输入，不等于 provider received/adopted。提示及 toast 不宣称语义采纳。恢复只对活动期间本进程观察且已保存的指导，在成功空闲边界执行有界 continuation；取消/失败/删除/压缩抑制。保留 autoResume:false 选项。
- 公开 chat.message 不含 noReply 标记：活动中的 noReply 保存与正常输入无法完全区分；如需只保存不唤醒，应关闭自动恢复。记录这个兼容边界，不能声称原生 noReply 契约完全保留。
- 不承诺撤销已过检查点的工具、batch 内部子调用、原生 native subtask、StructuredOutput、已运行子代理或长工具。多个并发工具可能已全部通过 gate；验收区分 gate 前和 gate 后。
- 老实现及依赖 ledger 的历史脚本在新实现验收成功后删除或明确标注为历史证据，不能继续推荐为 v2 验证入口。可复用桥接、打包、公共 hook 合并器。

## 源码与边界证据

均是本地源码核对；不将参考项目源码 commit 当成本机二进制的精确构建身份。

| 实现 | 接收与领取机制 | 可借鉴点与不能复制的保证 |
| --- | --- | --- |
| OpenCode 2.0 | `/Users/penghao/Documents/code/CodingAgent/opencode/opencode/packages/core/src/session/inbox.ts:21` KeyedMutex；`:318` enqueued_seq；`:421` steer 优先；`:505-537` promote 在 step/turn 区分 steer/input，控制消息形成边界 | 优先级与持久化统一归内核拥有。v1 插件没有此事务，不能复制 SQL 表就获得同等保证。 |
| pi | `/Users/penghao/Documents/code/CodingAgent/pi/pi/packages/agent/src/agent.ts:197-198,308-324` 两个队列；`agent-loop.ts:184,210-214,279-311` 开始、准备后、工具 batch 完成后取 steering，停止时取 follow-up | 借鉴边界清晰及普通消息保留。此版本在 executeToolCalls 返回后取插话，不能说 steer 会撤销当前 batch；Base Agent 内存队列不等于持久化 inbox。 |
| DSH | `/Users/penghao/Documents/code/CodingAgent/DSH/deepseek-harness/packages/core/agent-loop/src/agent.ts:156-175` next-step/next-turn 与取消后唤醒；`inbox.ts:25-50,97-112` 投影、重复 ID 检查、claim 先 next-step 再一条 next-turn | 借鉴“接收/领取/完成”分层；持久化、取消和工具信号属于驱动器，不在当前插件控制域。 |
| Codex | `/Users/penghao/Documents/code/CodingAgent/codex/codex/codex-rs/core/src/session/turn_input.rs:843-929` 在 active_turn 锁内校验活动任务、expected_turn_id、Regular/Review/Compact、空输入/schema 后入队；`input_queue.rs:179-204` mailbox 路径在提供 expected_turn_id 时才额外检查 cancellation_token | 更正旧混淆：steer_input 函数没有显式 cancellation token 检查。接收返回不证明 hook、持久化或模型调用已完成。借鉴证据分层，不声称原子 expected-turn 或取消保证。 |

固定 OpenCode 1.3.17：

- `agent-kernel/packages/opencode/src/session/prompt.ts:1263-1305` chat.message 在保存 user/parts 之前触发；不可把 hook 到达视为已保存。
- `prompt.ts:1338-1380` 每轮重读消息；`:1484-1499` 原生通用 system-reminder 后触发 messages.transform。`:1530-1560` 终止路径可以直接 break，最后一轮过程中保存的新输入不能只靠下一轮重读解决。
- `effect/runner.ts:111-135` Running 时 join 现有 Deferred，不能视为保证额外再跑一轮。
- `prompt.ts:449-458,487-499` 普通工具/MCP 在执行前触发 before hook；`session/processor.ts:153-212,239-256` tool part 有 callID、messageID，普通工具异常变 error 结果。native subtask `prompt.ts:604` 的 hook 在 execute 捕获区外，且传 part.id 而非 callID；v2 不从该路径抛 gate 错误，避免 L-09 的 running 悬挂。
- `packages/plugin/src/index.ts:197-282` 公开 Hooks；SDK `packages/sdk/js/src/gen/sdk.gen.ts:639,1118` promptAsync/showToast 可用。v1 SDK 部分运行时 synthetic 字段不在声明中，应局部结构扩展或明确窄类型适配，不 import 私有类型。
- `plugin/index.ts:227-235` event 回调不 await，必须自行捕获异步失败；`:245` 之后 trigger 顺序 await。
- TUI `cli/cmd/tui/routes/session/index.tsx:1300` 的 QUEUED 是原生显示。使用 toast 提示保存/准备/跳过/恢复，不声称模型已经理解。

旧实现审计：`docs/review/legacy-codex-audit.md:56-58,133-143`，L-08 每工具多次全量查询与流式事件重写、L-09 native subtask 错误路径及损坏 ledger 阻断、L-10 跨实例文件竞态。本次避免常态每工具全量扫描、避免磁盘 ledger，明确 native subtask 例外。

## 尺寸与理由

L（用户显式指定）：多文件插件、并发/事件顺序与完成边界，必须经过独立 improve 和 review。先设计验收与固定公开 API，再交新 Generator；不内联实现。

## 验收与验证命令

在 DESIGN.md 细化 A1 等条目：独立包类型/构建/单测；真实官方 OpenCode + 脚本化 OpenAI HTTP 模型确定性覆盖 G1/G2/G3 和无插话；真实 Codex 中继 headless 与 tmux TUI 的开/关插件对照；根回归及内核边界检查；同步说明与归档旧入口。真实模型失败须留证据，不能用假模型顶替。
