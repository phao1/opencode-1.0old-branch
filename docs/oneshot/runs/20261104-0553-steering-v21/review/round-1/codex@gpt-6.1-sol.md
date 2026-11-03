- [P2] idle 后的无效编辑未撤销恢复许可 — 历史检查返回后、status/get 等待期间，将唯一插话编辑为空或 ignored，事件处理只查询 active.pending；但 idle 已删除 active，因此 recovering 仍有效。只读内存 fixture 已复现：编辑事件之后 recovery 仍为 true，且 promptAsync 派发一次，导致已失效的插话触发额外模型运行。应同时检查恢复候选中的 messageID 并撤销许可。(evidence: external-plugins/steering/src/state.ts:142)

VERDICT: request-changes