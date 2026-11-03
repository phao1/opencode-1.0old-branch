# Generator 修复指令 — review round 1

按 DESIGN v1.2 的优先裁决实施。保持小状态、公开 API、≤200 有效生产行；不提交、不改内核/skill/其他 run。无需重跑三组真实模型演示（宿主正式 verify 会完整执行）；运行相关单测、官方确定性内核、类型和根回归，并报告证据。

1. P1（5.6-sol）：summary transform 后新有效输入被 observe 的 !ordinary 丢弃，idle 也被 !ordinary 排除，违反忙碌观察及 G2。改为所有已知请求都观察；ordinary 只控制 gate/reminder。recover 用最后 assistant（含 summary）成功及其 parent 用户边界，避免过滤前指导误恢复。按 DESIGN 的公开 compacting/guide 双屏障增加真实官方内核开/关 G2 测试，并断言实际续接 provider 包含指导、摘要无提示、普通续接仅一次提示；原 G2 正例继续保留。源码依据 state.ts:46/:148，compaction.ts:184–221、message-v2.ts:903–918。
2. P2（sol/astra，宿主复现）：idle 删除 active 后，history 已返回而 status/get 等待期间，候选编辑 empty/ignored 仍派发1次。证据 HOST-EDIT-REPRO.json。事件必须也失效 recovering 中对应候选；各异步等待和控制保存前的编辑不能再触发 continuation，不增加查询。
3. P2（5.6-sol，部分采纳）：公开 synthetic metadata 可以伪造 plugin 标记，未知从未签发 key 不得抛 STEERING_RECOVERY_SUPPRESSED；只对本进程已签发、会话关联的控制使用拒绝路径，记录短期到期回收。已签发旧控制重放仍可拒绝（设计明确授权），未知/过期签发记录按不确定放行。不要扩大为永久key历史。
4. 文档随 v1.2 更新 summary 输入、last assistant（含summary）、编辑/删除恢复边界与控制签发记录。无需改 skill 的链接生成问题，宿主已采纳并会在正式verify后修正 RESULT。

无关旧消息删除导致放弃恢复的P2建议未采纳：这是有意保守的history变更边界，记录限制即可。报告应说明实际代码行数、所有新增测试和任何设计偏离。
