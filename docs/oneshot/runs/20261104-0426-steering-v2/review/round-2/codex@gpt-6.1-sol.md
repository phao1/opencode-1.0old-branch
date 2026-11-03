- [P1] 连续压缩丢失指导的摘要覆盖关系 — 同一运行中，未 prepared 的指导经首次摘要后可正常放行工具；再次压缩只记录原始指导消息，未继承旧摘要覆盖的版本，guide.summaryID 仍指向已被过滤的首份摘要。纯内存复现中，第一次摘要后工具通过，第二次摘要后正常工具持续报 STEERING_STALE_CONTEXT，阻断后续执行。需传播成功摘要的覆盖关系。（evidence: external-plugins/steering/src/state.ts:151; external-plugins/steering/src/state.ts:180）

- [P1] overflow 重放更换消息 ID 后永久阻断工具 — 插话在旧请求期间保存、尚未 prepared，随后旧请求触发 overflow 压缩时，原生会将该插话排除出摘要并以新消息和 part ID 重放。插件仅按旧 ID 匹配指导，既不能确认重放已 prepared，也不会将旧版本 compacted。按此路径的内存复现中，请求已包含完整重放指导，工具仍被拒绝；后续普通请求也无法清退旧记录。（evidence: external-plugins/steering/src/state.ts:167; agent-kernel/packages/opencode/src/session/compaction.ts:167; agent-kernel/packages/opencode/src/session/compaction.ts:288）

- [P2] 取消会话不回收 settled 记录，最终拒绝新会话 — prune 遇到 terminal.error 直接返回，使已 saved、prepared 且因取消失去恢复资格的指导永久占用缓存；会话淘汰又要求 guides 为空。已复现：依次创建并取消 128 个会话后，第 129 个新会话在 chat.message 中抛 STEERING_CAPACITY，正常输入无法保存，需要重启进程。（evidence: external-plugins/steering/src/state.ts:47; external-plugins/steering/src/state.ts:226）

VERDICT: request-changes