# Review round 1 — 宿主裁决

日期：2026-11-04。四个成功评审均 Codex，同一 agent、不同模型。非 DEGRADED。全部 request-changes；五个 P1、两个 P2 经宿主复现/源码核对后采纳。设计 v1.2 → v1.3。

| Agent | 模型 | 状态 | 原因 | durationMs |
| --- | --- | --- | --- | --- |
| codex@gpt-6.1-sol | gpt-6.1-sol | ok | - | 225312 |
| codex@gpt-6-astra | gpt-6-astra | ok | - | 227002 |
| codex@gpt-6.1-terra | gpt-6.1-terra | ok | - | 180404 |
| codex@gpt-5.6-sol | gpt-5.6-sol | ok | - | 274820 |
| claude | - | unavailable | authentication required / not logged in | 0 |
| qodercli | - | unavailable | binary not found | 0 |
| agy | - | unavailable | binary not found | 0 |
| gemini | - | unavailable | binary not found | 0 |
| dsh | - | unavailable | authentication required / not logged in | 0 |
| codebuddy | - | unavailable | authentication required / not logged in | 0 |
| opencode | - | unavailable | binary not found | 0 |

| 建议（P0/P1/P2） | 来源 agent（模型） | 采纳/部分/拒绝 | 理由与证据 |
| --- | --- | --- | --- |
| P1 并发 gate 未等共享查询，普通 task 被豁免 | Codex@gpt-6.1-sol | 采纳 | HOST-EVIDENCE.md 第二项独立复现；等待已有 query 后再归属，不增加每工具查询 |
| P1/P2 压缩完成重设 compacting，普通首请求误拦 | Codex@四个模型 + host | 采纳 | 统一升为 P1：官方 1.3.17 /summarize 后首 bash 实际 error，HOST-EVIDENCE.md 第四/五项 |
| P1 未准备指导经压缩永久 gate | Codex@gpt-6-astra、gpt-6.1-terra、gpt-5.6-sol | 采纳 | state.ts:180/:186 全量 guides 与无 prepared 路径；记录成功 summary 覆盖版本并退役，不丢晚到指导 |
| P1 info 已保存但空 parts 时删除候选 | Codex@gpt-6-astra | 采纳 | HOST-EVIDENCE.md 第一项独立复现，完整保存后仍失踪；必须保留 expected parts 候选 |
| P1 慢保存 >1.5s 当失败丢弃 | Codex@gpt-5.6-sol | 采纳 | HOST-EVIDENCE.md 第三项独立复现，时间与历史缺席不证明失败；保留 late persistence 处理 |
| P2 第 257 普通输入硬失败 | Codex@gpt-6.1-terra、gpt-5.6-sol | 采纳 | observe 无 settled 清理、state.ts:124 明确抛错；A5 无插话保持行为，安全 idle 淘汰并测 >300 |
| P2 聚合入口忽略 autoResume:false | Codex@gpt-5.6-sol | 采纳 | external-plugins/src/index.ts:9 单参数，未向 SteeringPlugin 传 options；应转交并行为验证 |

## 结论与下一步

无 P0。尚未解决：上表全部七项；因此不关闭 review，也不宣布验收通过。采纳项写 findings.md，交原 Generator 修复，复验通过后 review round 2。既有 verify PASS 是修复前检查结果，不能抹去这些缺陷。公开 API 既有边界仍保留。

## 最终修复后关闭记录（宿主，2026-11-04）

七项采纳发现均在 impl/round-2 修复并新增反例/回归，最终 impl/round-3 保持这些回归。info-only、慢保存、并发 task、真实 summarize、settled 310 回合及聚合配置均通过。无本轮未解决 P0/P1/P2。

最终正式 verify 10/10 PASS（根 131/131，新包/安装入口集合各 62/62，含官方内核 13 项），真实 Codex headless/TUI 启停对照通过，证据见 ../../verify/RESULT.md 与 ../../verify/evidence。原 Evaluator 的 request-changes 原样保留；到达两轮上限后的修复关闭由宿主客观验证，不伪称新一轮独立 approve。
