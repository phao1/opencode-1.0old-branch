# Steering 0.3.1 人工体验清单

自动验收及独立评审已通过；下面是尚未执行的交互式体验，不会自动记录人工 accept。原 runner 生成的完整 TEST-MANUAL.md 保留在 STEERING-DELIVERY.md 列出的 artifacts 目录。

1. 在临时项目只加载一种入口：独立包或本仓库组合插件。重启固定 OpenCode，确认能查询 steering_status。安装方法见外置包 README。
2. 给模型一个有可观察结果的任务。工作仍运行时在同一会话输入“steer: 保留已完成的工作，接下来改用新的目标”。确认历史和附件保留，后续动作采用修正，已开始动作可以完成。
3. 连续输入两条修正，确认原消息 ID 各自保留、顺序明确；同时在另一会话运行任务，确认不互相影响。普通 shell/file 标记保持字面文本，已有权限 deny 继续生效。
4. 体验成功结束边界：原始指导保留，必要时增加一个 metadata.codeagentSteering.kind=continuation、synthetic=true 的控制记录。它可能不显示为 TUI 气泡，但公开消息 API 和 recovery.attempts 可审计。分别统计真实输入与控制记录；不要把 dispatched 当成 provider/adopted 证据。
5. 请求仍运行时使用原生停止。确认 pending-cancelled 或取消错误证据、没有自动复活。关闭并重开 OpenCode 后旧 pending 不应自动派发。取消恰好与续跑最后检查交错仍无原子保证。
6. 无未处理指导时运行内置 /review，确认子任务正常完成。原生 subtask 与未读真实 text/file 混合会保守拒绝，可能留下 running ToolPart；这一分支不承诺自动恢复，不应通过伪造 prepared 消除状态。
7. 对照 STEERING-DELIVERY.md 和原 ST-01..07 记录体验结果。需要额外关注复杂媒体压缩组合和交互式 TUI，自动协议证据不代替这些体验。只有操作员确认后才执行 one-shot accept。
