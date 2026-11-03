- [P1] 并发 gate 未等待共享查询，可能放行旧 task — 当工具归属事件延迟，第一个 gate 将 fallback 设为 true 后等待历史查询；第二个并发 task 跳过查询等待，直接因归属未知而豁免。内存复现中，已保存“不要启动子代理”的插话后，旧普通 task 仍获准执行，而查询完成后另一个旧工具被正确拦截。应让并发调用等待同一个查询，再判断是否属于 native task。 (evidence: external-plugins/steering/src/state.ts:172)

- [P2] 压缩完成后会误拦下一请求的正常工具 — compacting hook 设置标记，压缩请求的 transform 消费该标记；随后 session.compacted 又调用 compact() 重新设置它，导致下一次普通请求跳过快照建立。按内核事件顺序的内存复现确认，即使没有插话，该请求的 bash 也报 STEERING_STALE_CONTEXT，违反无插话时行为不变的要求。完成事件应只清理状态，不再标记下一请求为压缩请求。 (evidence: external-plugins/steering/src/state.ts:286)

VERDICT: request-changes