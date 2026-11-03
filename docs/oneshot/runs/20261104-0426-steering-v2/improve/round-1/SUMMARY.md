# Improve round 1 — 宿主裁决

日期：2026-11-04；设计 v1.0 → v1.1。非 DEGRADED。四项成功结果均为 **同一 agent（Codex）、不同模型**，不冒充四种独立产品。宿主逐条核对固定源码，未重跑成功结果。

| Agent | 模型 | 状态 | 原因 | durationMs |
| --- | --- | --- | --- | --- |
| codex@gpt-6.1-sol | gpt-6.1-sol | ok | - | 191174 |
| codex@gpt-6-astra | gpt-6-astra | ok | - | 185033 |
| codex@gpt-6.1-terra | gpt-6.1-terra | ok | - | 100723 |
| codex@gpt-5.6-sol | gpt-5.6-sol | ok | - | 207921 |
| claude | - | unavailable | authentication required / not logged in | 0 |
| qodercli | - | unavailable | binary not found | 0 |
| agy | - | unavailable | binary not found | 0 |
| gemini | - | unavailable | binary not found | 0 |
| dsh | - | unavailable | authentication required / not logged in | 0 |
| codebuddy | - | unavailable | authentication required / not logged in | 0 |
| opencode | - | unavailable | binary not found | 0 |

## 取舍表

| 建议（P0/P1/P2） | 来源 agent（模型） | 采纳/部分/拒绝 | 理由与证据 |
| --- | --- | --- | --- |
| P1 G2 final-response 屏障通常只是原生继续 | Codex@全部四模型 | 采纳 | processor.ts:486-488 返回 continue；prompt.ts:1373 按 ID 判断。采用旧 late-save 探针的双 chat.message 屏障、自然 ID、开关插件对照。A3 与 v1.1 契约明确；StructuredOutput 可补充但不替代普通边界。 |
| P1 控制派发后重入 chat.message 校验 | Codex@gpt-6.1-sol、gpt-6-astra | 采纳 | server/routes/session.ts:845 后台派发，204 早于保存。v1.1 一次性 permit、epoch/版本复核、串行区外派发，旧测试 :583/:609/:620 契约迁移。 |
| P1 undo/revert 抑制恢复 | Codex@gpt-6.1-sol、gpt-6-astra | 采纳 | session/revert.ts:82-104 先标记、后 cleanup；prompt.ts:1307 在 hook 前清理。监听 revert + SDK session.get 复核，A6 增加 redo 保持。 |
| P1/P2 当前 assistant 不在 transform 数组 | Codex@全部四模型 | 采纳 | prompt.ts:1348 读取 msgs、:1433-1448 新建 assistant、:1499 传旧 msgs。唯一 parent/未完成/非 summary 候选 + 每请求一次合并 SDK 校准；compaction 不建普通快照。 |
| P1/P2 continuation 字段保留 | Codex@全部四模型 | 采纳 | message-v2.ts:357-377；llm.ts:109 使用 system。继承 model/agent/system/variant/format，不传 tools 以免 prompt.ts:1312 重写 session 权限。 |
| P1 取消绝不复活承诺过强 | Codex@gpt-6.1-terra | 采纳 | runner idle cancel 没专用取消证据，promptAsync 非原子。A6 限定 dispatch 前已观察终止证据并新增控制保存前校验；最终窗口明确限制。 |
| P1/P2 完整 part 保存与候选待定 | Codex@gpt-6-astra、gpt-6.1-terra | 采纳 | prompt.ts:1299-1300 info 与 parts 分开保存。候选记录全部有效 part 版本，完整匹配才 saved；待定 gate 有界确认、失败拒绝本次而非永久毒化。 |
| P1 native subtask 真实集成 | Codex@gpt-6-astra、gpt-5.6-sol | 采纳 | prompt.ts:604 hook 在异常捕获外且传 part.id。A6 要求真实 SubtaskPart 完成无 running；未知 task 查询失败安全豁免并诊断，普通可归属 task gate。 |
| P1 noReply 不兼容须明确 | Codex@gpt-5.6-sol | 采纳 | plugin Hooks 不暴露 noReply；选择普通插话 G2 与 autoResume:false 退出，设计 v1.1 与 README 必须明确，不只留在 Brainstorm。 |
| P1 重复冲突插话的权威顺序 | Codex@gpt-5.6-sol | 采纳 | 事件回调不 await，按稳定原生 message ID 而非异步完成顺序。A10 真内核双插话，保存全部原文、按有序版本恢复。 |
| P1 CI 二进制来源 | Codex@gpt-5.6-sol | 采纳 | 本机绝对路径不够。README 给 npm 精确 opencode-ai@1.3.17、平台二进制由 npm integrity 校验、OPENCODE_BINARY 与 --version 断言，确定性测试不依赖真实模型登录。 |
| P2 消息/附件删除与同 ID 编辑 | Codex@gpt-5.6-sol | 采纳 | SDK types.gen.ts:152-157/:414-420 分别提供 removed 事件；A10 单测完整/局部删除及新版本，不复活删除内容。 |
| P2 steering_status 豁免 | Codex@gpt-5.6-sol | 采纳 | 只读诊断必须在 pending/未知/恢复失败时可用；v1.1 明确豁免并验收。 |
| P2 独立包与聚合依赖闭合 | Codex@gpt-5.6-sol | 采纳 | 相对源码 import，由 Bun 聚合打包；独立包自有 API dev/peer，根类型包含，并核验聚合 build；不额外引入 workspace 依赖。 |
| P2 单一导出不等于跨配置去重 | Codex@gpt-5.6-sol | 采纳 | plugin/index.ts:70-80 只模块内去重。README 要求独立包/聚合入口二选一，不实现全局隐式 guard。 |

## 本轮结论

未发现 P0。全部建议经源码核对后采纳并合并重复项，设计升级 v1.1。未解决项是公开 API 的已列明限制（非原子取消、native subtask/已过 gate 的动作、noReply、重启无恢复），不伪称消除。无需第二轮 improve；下一节点交全新 Generator 实施，验证尤其核对 G2 真实开关对照、控制 reentry 与 native subtask。
