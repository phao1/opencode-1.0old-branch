- [P2] 自动续接的提醒会在后续请求中重复发送 — G2 将完整的 `[Steering reminder]` 写入持久化的 synthetic 控制消息。续接后的每次普通请求只要仍包含该消息，都会再次向模型发送提醒，违背 G3 只在首次吸收时提示一次的要求。摘要续接的真实内核测试已覆盖该触发条件，但把连续两个请求各含一次提醒视为通过，因此没有发现这一回归。 (evidence: external-plugins/steering/src/state.ts:99, external-plugins/steering/test/kernel.test.mjs:324)

VERDICT: request-changes