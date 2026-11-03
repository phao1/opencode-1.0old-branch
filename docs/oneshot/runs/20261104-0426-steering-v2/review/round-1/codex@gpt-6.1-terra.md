- [P1] 每次成功压缩后，首个正常请求都可能被误判为过期 — 压缩开始时设置 `compacting`，压缩请求的 transform 会清除它；随后内核发布 `session.compacted`，插件再次设置该标志。紧接着的正常请求因此跳过快照创建，其普通工具调用会因缺少快照而报 `STEERING_STALE_CONTEXT`，即使没有插话。固定版本内核的事件顺序见 `agent-kernel/packages/opencode/src/session/compaction.ts:221` 和 `:345`。(evidence: external-plugins/steering/src/state.ts:136)

- [P1] 压缩前未准备的指导会持续阻断后续工具 — 压缩只取消指导的恢复资格，没有移除或标记已被压缩的未准备指导；压缩后的请求若不再包含原消息，就无法为其建立快照，而 gate 仍将它判为过期。已用只读的 hook 级复现验证：压缩后提交新任务，新的 `bash` 调用仍因旧指导被拒绝。(evidence: external-plugins/steering/src/state.ts:180)

- [P2] 长会话达到 256 条普通输入后无法继续发送消息 — 插件记录所有非空用户输入，包括空闲时的普通任务，但完成或准备后不会清理对应记录。第 257 条输入在 `chat.message` 阶段抛错、无法保存；即使整个会话从未使用插话也会触发，用户只能重启插件或换会话。(evidence: external-plugins/steering/src/state.ts:124)

VERDICT: request-changes