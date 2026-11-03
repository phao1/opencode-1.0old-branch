- [P1] 连续压缩丢失指导的摘要覆盖关系 — 未进入普通请求的指导被第一次摘要覆盖后，若同一任务未经过 idle 又发生第二次压缩，新摘要不会继承旧摘要的覆盖记录；指导仍绑定旧 summaryID，而原生上下文已过滤旧摘要。内存复现确认第一次压缩后工具成功，第二次后正常工具持续报 `STEERING_STALE_CONTEXT`，阻断长任务继续执行。(evidence: external-plugins/steering/src/state.ts:145; external-plugins/steering/src/state.ts:180)

- [P2] 将已保存文本改为空白会永久阻断会话工具 — 通过公开 part.update 将仍被跟踪的输入改为空文本或 ignored 后，历史校准把“已确认编辑后无有效内容”当成“尚未保存”，持续保留 dirty 指导。内存复现确认后续新输入已进入新请求，其工具仍被旧空消息拦截；成功 idle 也无法清退该记录。应区分未完成保存的候选与已保存内容的有效编辑。(evidence: external-plugins/steering/src/state.ts:82; external-plugins/steering/src/state.ts:202)

VERDICT: request-changes