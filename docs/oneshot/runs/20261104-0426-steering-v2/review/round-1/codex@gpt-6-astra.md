- [P1] 保存中间态会永久丢弃插话并放行旧工具 — 当历史查询读到已保存的 user info、但有效 parts 尚未保存时，`update()` 直接删除指导记录，后续 part 事件不会重建它。纯内存复现中，parts 保存前后的旧工具均被放行，插话也从状态中消失，破坏 G1/G2。应保留未完成保存的候选，不能将空 parts 视为确认删除。(evidence: external-plugins/steering/src/state.ts:81)

- [P1] 压缩掉未准备的指导后，普通工具永久被拦截 — 插话已保存但尚未进入正常请求时发生压缩，原指导仍存在于全量历史，却被原生请求上下文过滤。`compact()` 仅取消恢复资格；`gate()` 仍检查该指导，而后续快照无法补入其版本。纯内存复现连续三个新 assistant 的工具均报 `STEERING_STALE_CONTEXT`。需要明确处理压缩后的未准备指导，避免形成无法解除的阻塞。(evidence: external-plugins/steering/src/state.ts:180; external-plugins/steering/src/state.ts:186)

- [P2] 压缩完成事件导致下一次正常请求跳过快照建立 — 压缩开始时设置的 `compacting` 已被压缩请求的 transform 消费，但 `session.compacted` 再次调用 `compact()`，重新设置该标记。因此下一次正常 transform 直接返回，即使没有插话，其普通工具也因缺少 assistant 快照被误拦。已按固定内核的公开 hook 顺序纯内存复现，违反“无插话时行为不变”。(evidence: external-plugins/steering/src/state.ts:286; external-plugins/steering/src/state.ts:136)

VERDICT: request-changes