# Brainstorm — steering v2.1

版本：v1.0；日期：2026-11-04（Pacific/Auckland）。尺寸 L（用户指定）。

## 需求与范围

以 REQUIREMENT.md 为准，把 v2.0 的历史证据状态机返工为 fail-open 的请求作用域优化。保留 G1/G2/G3/G4，外置公开 Hooks/SDK，固定官方 1.3.17，不改 agent-kernel。设计、独立改善、全新 Generator、验证、独立对抗评审及交付按顺序执行。

## 默认假设

- 无人值守，不提问；允许本地提交（沿用前 run 与 skill 交付默认），不 push/merge/发布。其他 run 的未跟踪 host 文件保留，不纳入本轮提交。
- 不确定时放行。放弃 v2.0 对历史、编辑版本、摘要覆盖及 overflow 原文映射的保证；原生下一轮读消息承担最终可见性。
- “忙碌”只由本进程已见 transform 且未见结束界定；session.status busy 不独立创建状态。不回收运行中的工具，也不提供 queue 或紧急中断。
- 每个 transform 同步消费已有 pending，缺失的直接丢弃；之后到达的有效 chat.message 才能证明旧请求未包含它。chat.message 在保存前触发，允许此短暂窗口拦截；下一 transform/结束即解除，绝不等保存完整性。
- G2 仅成功 idle 候选一次 SDK 历史确认、最多一次 continuation；慢保存错过确认则不自动重试。autoResume:false 关闭。noReply 无公开辨识，忙碌 noReply 输入可能触发 continuation，文档说明。
- 取消/错误/revert/删除清空并同步失效正在等待的恢复候选；公开 API 不提供原子 cancel/dispatch/save，保留有限竞态说明，不虚构绝对保证。
- 真实演示使用既有 Codex CLI 桥接；暂扣真实决定开关对照继续保留，另加自然时序 tmux TUI 开关对照，不控制或暂停模型响应。自然原生也可能正确采纳，按实际文件与屏幕记录差异。
- 生产代码目标 state.ts + index.ts ≤200 非空非注释非类型行，优先清晰实现；若确需超过，先在 DESIGN 写原因经 improve 评审。

## 源码证据与简化依据

- 固定 submodule HEAD 已核对为 517e6c9aa4c61dbc125e7654fc596f1d529f20d9。
- prompt.ts:1263–1305 的 chat.message 先于保存；:1353–1387 每轮重读及完成判断；:1499 transform 先于 :1510–1526 handle.process；:1559–1569 等待处理退出后才进入下一 loop。effect/runner.ts:111–135 同会话 Running 只 join 当前 run。因此普通工具 before 属于该会话最近 transform 的请求，无需 assistant/callID 映射或历史读取。processor.ts:182–211 处理当前 assistant 的工具；prompt.ts:449–458 普通 before 路径错误会成为工具错误。
- prompt.ts:604 原生 subtask before 在 execute catch 外，使用 part.id（prt_）必须放行。不同 session 有独立状态，普通 task 不因名称豁免。
- compaction.ts 的 experimental.session.compacting 先于 summary messages.transform（以实现前精确行号核对为准）；消费一次压缩标志，摘要不拦截、不附加提示。
- v2.0 state.ts 438 行，observe 容量上限、prepare 历史查询及 gate 快照缺失拒绝是共同根因；不继续传播 summaryID 或追踪 replay 版本。
- 前 run BRAINSTORM.md 的 OpenCode 2.0/pi/DSH/Codex 对比继续作为上下文；这些队列/原子接收由各内核持有，外置 v1.3.17 不能复制其保证。Codex steer_input 没有显式 cancellation token 检查的更正继续有效。

## 验收路径

DESIGN 中登记可执行检查：请求作用域单测（所有前两轮 review 场景）、官方内核确定性 G1 多工具/G2 完成边界/压缩/overflow、零插话零历史调用计数、类型/构建/安装入口/根回归、原始真实决定 headless/TUI 对照、新自然时序 TUI 对照。缺少实际能力留阻塞，不以假模型替代真实演示。
