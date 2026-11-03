- [P2] G2 续接会永久重复 G3 reminder — 自动续接把完整 reminder 写入持久化 synthetic 消息；此后每轮请求都会再次发送它。现有测试甚至确认下一请求仍含 reminder，违反“只在这一次附加”的验收要求。(evidence: external-plugins/steering/src/state.ts:99, external-plugins/steering/test/kernel.test.mjs:329)

VERDICT: request-changes