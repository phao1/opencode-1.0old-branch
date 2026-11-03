- [P2] idle 后的空编辑未失效自动续跑候选 — `message.part.updated` 仅通过 `active.pending` 判断是否清理，但 idle 已删除 active。可复现：恢复流程读取有效插话后，暂挂 `session.status`，将插话编辑为空或 ignored 并发送更新事件，再释放查询；仍调用一次 `promptAsync`。已用只读内存复现确认。这会在用户撤销有效内容后额外启动模型及可能的工具操作。应同时检查并失效 `recovering` 中对应候选，补充恢复等待期间编辑的回归测试。 (evidence: external-plugins/steering/src/state.ts:140)

VERDICT: request-changes