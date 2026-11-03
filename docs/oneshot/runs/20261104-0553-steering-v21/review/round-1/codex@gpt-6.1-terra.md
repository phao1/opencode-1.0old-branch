- [P2] 删除无关消息会取消待处理的自动续接 — 会话进入 idle 后、恢复检查完成前，如果删除的是同一会话中的旧消息或旧消息的 part，事件处理仍会无条件使恢复候选失效。即使待续接的插话没有变化，G2 也不会再尝试续接；这里应区分被删除的消息是否属于候选插话。 (evidence: external-plugins/steering/src/state.ts:140)
- [P2] 验证报告的日志链接无法打开 — `RESULT.md` 已位于 `verify/` 目录，但各日志链接又以 `verify/` 开头，解析后指向不存在的 `verify/verify/` 目录，评审者无法从报告直接查看所列检查的日志。 (evidence: docs/oneshot/runs/20261104-0553-steering-v21/verify/RESULT.md:7)

VERDICT: request-changes