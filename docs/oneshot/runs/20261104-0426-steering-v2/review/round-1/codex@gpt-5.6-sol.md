- [P1] 压缩后的首个正常请求会误拦工具 — `experimental.session.compacting` 已设置 `compacting`，压缩 transform 清除后，`session.compacted` 又调用 `compact()` 重新置位，导致下一次正常 transform 跳过快照；即使没有插话，其工具也会收到 `STEERING_STALE_CONTEXT`。(evidence: external-plugins/steering/src/state.ts:286)
- [P1] 压缩时未准备的指导会永久阻断后续工具 — 压缩仅取消指导的恢复资格；压缩后上下文不再包含该指导，无法将其标记 prepared，但 gate 仍检查所有 guides、未排除已失效的 `eligible=false` 项，导致以后每个普通工具持续失败。(evidence: external-plugins/steering/src/state.ts:180)
- [P1] 慢保存会让旧工具被错误放行 — 指导观察超过 1.5 秒仍未出现在历史时就被删除，但这无法区分保存失败与仍在执行的后续 `chat.message` hook；删除后 gate 看不到指导而放行旧工具，稍后到达的保存事件也不会重新登记它。(evidence: external-plugins/steering/src/state.ts:97)
- [P2] 长会话在第 257 条普通输入时失效 — 所有非空用户输入都会永久保留在 `guides`，完成、prepared 或 idle 后均不回收；达到 256 条后 `chat.message` 直接抛错，使后续正常消息无法保存，即使会话从未发生插话。(evidence: external-plugins/steering/src/state.ts:124)
- [P2] 聚合入口静默忽略 `autoResume:false` — 官方加载器会把插件配置作为第二参数传入，但 `CodeAgentPlugin` 未接收或转交该参数；通过受支持的聚合入口安装时，用户无法关闭自动恢复。(evidence: external-plugins/src/index.ts:9)

VERDICT: request-changes