# Round 1 accepted findings — fix in original Generator

依据 DESIGN.md v1.3。本轮 5 个 P1、2 个 P2 均采纳，无 P0。只在原设计范围修复，不改 kernel，不 commit。完成后宿主独立复验及 review round 2；不要替宿主标记节点。

1. **P1 保存 info/空 parts 导致指导永久丢失**（astra；state.ts:81）：update 中 `!effective(parts).length` 在候选完整保存前就删除。宿主复现见 HOST-EVIDENCE.md，INFO_ONLY_GATE_ADMITTED + SAVED_GUIDE_GATE_ADMITTED。保留预期 parts 候选；没有明确删除证据时空结果不是删除。增加 info→空历史校准→parts 保存的回归，旧调用始终不能因丢记录被放行。
2. **P1 慢保存超过 1.5s 被当失败永久删除**（5.6-sol；state.ts:97）：`observed < begun - 1500` 不能证明失败，下游 chat hook 可能仍等待。宿主复现保存后仍放行。保留晚保存观察能力；不要用任意 timeout 丢指令。更新原“aged absent candidate 自动消失”测试为真实正确契约，明确未知时诊断/恢复方式。可加公开 companion hook 在产品 hook 后延迟保存的真实内核用例，不碰 kernel。
3. **P1 并发 gate 不等待共享查询导致旧普通 task 豁免**（6.1-sol；state.ts:172）：第一个设 fallback=true 后 await history，第二个跳过 await 并因未知 task 直接返回。宿主复现 CONCURRENT_TASK_ADMITTED / BASH_REJECTED。所有并发 gate 等已有 s.query；查询真正失败/仍未知时才使用设计中的 native/未知 task 安全例外。不要新增每工具全史读取。
4. **P1 session.compacted 重设 compacting 导致正常第一请求误拦**（全部四模型，宿主真内核复现）：开始 hook→summary transform→compacted→normal transform。完成事件不再次置开始标记；加入完整生命周期单测与真实官方 summarize→新任务→第一个工具成功用例，无插话也不能错误拒绝。
5. **P1 未准备指导被压缩后永久 gate**（astra/terra/5.6-sol；state.ts:180,186）：压缩仅置 eligible=false 而 gate 检查全部，过滤后无法 prepared。记录 summary 实际覆盖版本，成功后用 compacted/retired 证据解除后续普通请求阻断；不要假称普通 prepared，别丢压缩后到的指导；失败不清退。连续多个正常请求及晚到指导都要测。
6. **P2 >256 条普通输入硬失败**（terra/5.6-sol；state.ts:124）：所有普通任务永久留 guides；在安全完成/idle边界清理已 settled 证据，仍保留活跃旧 assistant 需要对照的 pending。>300 普通串行输入测试不失败，内存确实有界。README 调整实际缓存语义。
7. **P2 聚合入口忽略 autoResume:false**（5.6-sol；external-plugins/src/index.ts:9）：接收/传第二参数给 SteeringPlugin；以实际行为证明可关闭恢复，保持扩展/worker 其他行为。

验证：运行相关新增单测及真内核回归、根/包类型、构建和安装产物验证；完整正式 verify 由宿主执行。若重跑真实 demo，请使用新的输出目录（例如 .codeagent/steering-v2-fix-headless 与 -fix-tui），保留既有原始证据，不能带旧 artifacts 重跑。同步本次行为改动的 README、baseline、实现报告，不改旧轮原始评审文件。

最终答复本身写完整修改/验收结果，不先写同名 report 再用自链接短答覆盖。原 Generator 的最终输出会自动写入 impl/round-N/report.md。
