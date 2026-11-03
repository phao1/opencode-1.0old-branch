已按指令完成 Steering v2 实现、旧 ledger 退役及文档同步。

- A1–A10 对应检查均通过，待宿主/Evaluator 独立验收。
- 根测试 102/102；新包及安装后 bundle 各 33/33。
- 真实 Codex headless、tmux TUI 开关对照均通过。
- 类型检查、构建、离线打包安装及内核边界检查通过。
- 保留非原子取消、已运行工具和 native task 豁免等设计限制；未提交或发布。

完整修改清单、命令结果与限制见[实现报告](/Users/penghao/Documents/code/oneshot/one-show-code/opencode-1.0old-branch/docs/oneshot/runs/20261104-0426-steering-v2/impl/round-1/report.md)。

## 宿主核对补记（2026-11-04）

Generator 最终输出覆盖了它写入同一路径的长报告；上方为其原始最终答复。宿主从实际 diff 与 evidence 补全清单，以下不冒充独立 Evaluator。

- 新生产实现：external-plugins/steering/src/index.ts（公开插件入口）、state.ts（有界进程状态、part 指纹、assistant 快照、工具 gate、permit 与恢复）。旧 596 行 ledger、旧入口和旧测试删除。
- 包及集成：独立 package/tsconfig，聚合入口切换、根 type/test 接入、package-steering 新入口；kernel.mjs、kernel.test.mjs 和 state.test.mjs 覆盖 33 项；verify-steering 从已安装 bundle 验证。
- 演示：steering-v2-demo.mjs 使用真实 Codex 决策屏障、headless/tmux 开关对照；bridge 仅增加 onEvidence，保留原始 JSONL 与 usage。旧 ledger 专属脚本顶部标 LEGACY。baseline SPEC/DESIGN/STEERING 与包 README 同步。
- Generator 检查：根类型、包类型、独立和聚合构建、npm pack/离线安装、真实官方内核（新包 33/33、安装产物 33/33）、根回归 102/102、真实模型 headless/TUI 启停对照、kernel boundary 均有 evidence；宿主正式 verify 另行执行登记命令，结果以 verify/RESULT.md 为准。
- A1→type/build/package/installed-check；A2/A3/A4/A5/A6/A10→kernel.test 与 state.test；A7→SDK 查询次数与缓存测试；A8→真实 headless/TUI reports、excerpts、capture-pane；A9→根测试与同步文档。
- 生产实现未超出设计允许目录；未修改固定 kernel tracked 源码或其他 run。无产品方案偏离。Design v1.2 只补登记 installed integration 与 fresh-output 归档协议。
- 原始完整演示已归档到 .codeagent/steering-v2-generator-{headless,tui}；real-evidence-index.json 已指向归档。后续 verify 使用原命令的全新目录；本轮 reports 内 out 字段保留执行时的原路径，由该索引映射归档位置。
- 已知限制保持：非原子取消/派发，native/未知 task 豁免，已过 gate/单工具内部不可撤销，noReply 无法辨认，重启不重放，provider/adopted unknown。未 push/merge/release。
