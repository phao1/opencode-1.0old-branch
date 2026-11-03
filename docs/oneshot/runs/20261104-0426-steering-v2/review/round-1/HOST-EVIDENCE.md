# 宿主独立验证

日期：2026-11-04。这些是宿主复现，不冒充 Evaluator。原始脚本/日志在 .codeagent，源文件未被这些复现修改。

- `node .codeagent/steering-v2-host-review-proofs.mjs`：用现有 public Hooks 测试 fixture，先观察指导、仅保存 info，触发 SDK 历史校准，再保存完整 parts。输出 `INFO_ONLY_GATE_ADMITTED`、`SAVED_GUIDE_GATE_ADMITTED`，状态只剩初始 m01。支持 astra 的保存中间态 P1。
- 同一脚本延迟一次公开 history 返回，同时启动旧 bash 与旧普通 task，输出 `CONCURRENT_TASK_ADMITTED BASH_REJECTED`。支持 6.1-sol 的共享查询 P1。
- `node .codeagent/steering-v2-host-slow-save-proof.mjs`：观察指导后等待 1600ms，历史仍无指导，gate 后再完整保存。输出 `SLOW_CANDIDATE_GATE_ADMITTED`、`LATE_SAVED_GUIDE_GATE_ADMITTED`，状态不再保留该指导。支持 5.6-sol 的慢保存 P1。
- `node .codeagent/steering-v2-host-compaction-proof.mjs`：按公开 hook 顺序 compacting→summary transform→session.compacted→普通请求，已 prepared 原始任务仍被拒绝。随后运行真实官方二进制复现，排除纯 mock 误判。
- `node .codeagent/steering-v2-host-real-compaction.mjs`：隔离官方 1.3.17 server + 当前插件 + 本地 SSE；初始普通文本完成，公开 `/session/:id/summarize` auto:false 成功，再发正常任务。第一个 bash 收到 STEERING_STALE_CONTEXT。原始请求/消息/工具记录：`.codeagent/host-compaction-iEPjHZ/proof.json`；kernel 日志位于该次 startKernel 生成的隔离 fixture。内核调用顺序核对：session/compaction.ts:184-221、:345。

其他发现核对：压缩只 invalidate eligible 而 gate 仍扫描所有 guides，未准备指导缺失于新上下文时无解除路径（state.ts:180,186）；observe 第 257 条所有普通输入必抛、无 settled 淘汰（:124）；聚合 index.ts 仅一个参数且 SteeringPlugin(input) 未传 options。以上均采纳，修复验收见 findings.md。

## 修复后宿主复核

round-2 后重跑同等复现：info-only 与慢保存期间以及实际保存后，旧普通工具均收到 STEERING_STALE_CONTEXT；并发 bash/task 在共享查询返回后均拒绝。真实官方 summarize 后的 bash 变为 completed，原始 proof 写入新的 .codeagent/host-compaction-* 目录。Generator 新增的公共 API 真内核集成、310 次普通输入与聚合入口选项行为亦经源码/日志核对。正式 verify 将在全新演示目录执行；原正式验证归档 verify-before-review-fix、.codeagent/steering-v2-verify1-{headless,tui}。
