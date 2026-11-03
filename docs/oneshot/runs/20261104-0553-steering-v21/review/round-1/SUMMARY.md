# Review round 1 — 宿主裁决

2026-11-04。非 DEGRADED。四个成功结果均 Codex，同一 agent、不同模型；原 verdict 均 request-changes。

| Agent | Model | Status | Reason | durationMs |
| --- | --- | --- | --- | --- |
| codex@gpt-6.1-sol | gpt-6.1-sol | ok | - | 355453 |
| codex@gpt-6-astra | gpt-6-astra | ok | - | 183766 |
| codex@gpt-6.1-terra | gpt-6.1-terra | ok | - | 52516 |
| codex@gpt-5.6-sol | gpt-5.6-sol | ok | - | 240098 |
| claude | - | unavailable | authentication required / not logged in | 0 |
| qodercli | - | unavailable | binary not found | 0 |
| agy | - | unavailable | binary not found | 0 |
| gemini | - | unavailable | binary not found | 0 |
| dsh | - | unavailable | authentication required / not logged in | 0 |
| codebuddy | - | unavailable | authentication required / not logged in | 0 |
| opencode | - | unavailable | binary not found | 0 |

设计 v1.1 → v1.2。

| 建议（P0/P1/P2） | 来源 agent（模型） | 采纳/部分/拒绝 | 理由与证据 |
| --- | --- | --- | --- |
| P1 摘要运行期间新插话没有 pending，错过 G2 | Codex@gpt-5.6-sol | 采纳 | state.ts:46/:148 明确按 ordinary 排除；固定 compaction.ts:184–221 和 message-v2.ts:903–918 核对，摘要不 gate 不等于忽略后到输入。v1.2 改观察/idle 资格并以最后 assistant（含摘要）的 parent 边界，要求官方双屏障开关正例 |
| P2 idle 后空/ignored 编辑不失效 recovering | Codex@gpt-6-astra、gpt-6.1-sol | 采纳 | 宿主独立内存复现 HOST-EDIT-REPRO.json：status 等待中编辑后仍 dispatch=1；修复后各 await 均需为0 |
| P2 公开 synthetic metadata 伪装自家控制导致拒绝 | Codex@gpt-5.6-sol | 部分 | 未签发 key 应放行；已签发旧控制重放属于设计授权拒绝的自家失效控制，不接受“所有重放也必须保存”的延伸。短期签发会话关联与到期清理，不永久追踪 |
| P2 删除无关旧消息使恢复放弃 | Codex@gpt-6.1-terra | 拒绝 | 保守 history 变更边界：删除可能改变 parent/顺序，放弃一次 best-effort 恢复符合不确定不唤醒；用户输入和后续工具不被拒绝。v1.2 明确限制，不为这个优化增加分类状态 |
| P2 RESULT 的 verify/verify 日志链接错误 | Codex@gpt-6.1-terra | 采纳（宿主已修） | 实际文件位于 verify，修改为本目录 .txt，逐个文件存在；不扩展修改 skill。修复后的正式 verify 再生成时宿主会重新校正 |

## 结论与下一步

无 P0；一个 P1 和两个 P2 采纳项交原 Generator，findings.md 包含具体修复与官方内核测试路径。修复前 review 保持未完成；正式 verify PASS 是修复前结果，不能用来关闭上述发现。修复后核对 diff/report、done impl、完整 verify，再进行 review round 2（因本轮采纳 P1）。不增加摘要覆盖/历史指纹状态机。

## 修复关闭证据

Generator round 3按v1.2完成上述三项修复，官方摘要G2开关与等待编辑/签发身份回归通过。恢复后完整verify通过；review round 2未再报告此三项。后续v1.3只修复新的G3重复问题，最终113根回归/44安装入口及8项正式检查全部通过。详见[最终验证](../../verify/RESULT.md)及[round 3报告](../../impl/round-3/implementation-details.md)。
