- [P1] 压缩请求期间的插话会绕过 G2 恢复 — summary transform 将状态设为 `ordinary:false`，随后 `observe()` 直接忽略有效用户输入。若该输入在 summary assistant 分配后才保存、但 message ID 更早，内核会在完成时退出循环；idle 时插件没有 pending，不读历史也不 continuation，插话会滞留到用户再次发消息。(evidence: external-plugins/steering/src/state.ts:46)
- [P2] 公开输入可伪装成内部恢复控制并被拒绝 — 任意带公开 `codeagentSteering.plugin` 标记的 synthetic part 都被当作内部 control；当 recovery key 不存在或不匹配时会抛出 `STEERING_RECOVERY_SUPPRESSED`。固定内核的公开 PromptInput 允许 synthetic/metadata，因此重放旧控制或构造该字段会让本可保存的请求失败，违反 fail-open。(evidence: external-plugins/steering/src/state.ts:41)

VERDICT: request-changes