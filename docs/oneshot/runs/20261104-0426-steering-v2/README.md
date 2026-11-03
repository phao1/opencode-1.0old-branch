# OpenCode 1.0 外置插件：插话 steering v2

## 最终交付（2026-11-04，Design v1.4）

全部节点已完成。Steering v2 独立包 0.4.0 取代旧 ledger，固定内核 tracked 源码未改；实现与完整证据已本地提交 `4251d707f`，未 push、merge 或发布。

- [最终正式验证](verify/RESULT.md)：10/10 PASS；根测试 **131/131**，新包与安装入口检查集合各 **62/62**（49 个单元/组件、13 个官方内核用例）。类型、构建、空 npm cache 离线安装、内核边界均通过。
- [最终真实 Codex headless 启停对照](verify/evidence/headless-report.json)、[tmux TUI 对照](verify/evidence/tui-report.json) 均通过。启用组阻止旧动作，关闭组写出 obsolete.md；均保留 checkpoint.md，由真实模型撰写 SUMMARY。
- [TUI 提交插话](verify/evidence/tui-enabled-guidance-submitted.txt)、[TUI 启用完成](verify/evidence/tui-enabled-completed.txt)、[关闭对照完成](verify/evidence/tui-disabled-completed.txt)；[原始路径与 SHA256 索引](verify/evidence/real-evidence-index.json) 包含 Codex JSONL、决策/usage、HTTP body、原生 messages 和 kernel logs。
- [最新实现报告](impl/round-3/report.md)、[overflow 原生新 ID/provider 证据](impl/round-3/evidence/overflow-native-replay-installed-excerpt.json)、[三次摘要 G3 证据](impl/round-3/evidence/three-manual-summaries-installed-excerpt.json)、[确定性原始记录索引](impl/round-3/evidence/kernel-evidence-index.json)。
- [第 1 轮发现关闭](review/round-1/SUMMARY.md)、[第 2 轮发现关闭](review/round-2/SUMMARY.md)：原始独立 verdict 保留 request-changes，修复后由宿主独立复现和完整 verify 关闭，无未解决 P0/P1/P2；没有伪称第三轮独立 approve。
- [独立包安装、配置、CI 与限制](../../../../external-plugins/steering/README.md)、[本地产物 tgz](../../../../dist/oneshot-opencode-steering-0.4.0.tgz)、[最终打包报告及 SHA256](verify/evidence/package-report.json)。

公开边界保持：已过 gate 的工具与运行中子代理不能撤销；native/未知 task 安全豁免；取消与派发非原子；活动 noReply 无法区分；重启不重放。prepared/摘要覆盖不证明语义采纳，provider/adopted 为 unknown；overflow 图片/PDF 的原生占位转换用 mediaStripped 标记。

旧正式验证保留为 [初次验证](verify-before-review-fix/RESULT.md)、[首轮修复验证](verify-before-review2-fix/RESULT.md)，原始演示分别归档为 `.codeagent/steering-v2-verify1-*`、`steering-v2-verify2-*`；Generator 首轮演示为 `steering-v2-generator-*`，最终演示为 `steering-v2-demo-*`。原始日志和 TUI 空白格式保持，仅修正生成 RESULT 的相对日志链接。持续写入的宿主日志保留本地，未纳入提交。

Run: 20261104-0426-steering-v2 · L · 2026-11-03T15:26:45.769Z

| 节点 | 状态 | 备注 |
| --- | --- | --- |
| brainstorm | done |  |
| design | done |  |
| improve | done |  |
| impl | done | Host checked final report/diff; transitive summaries, empty edit, terminal capacity and empty-cache offline install independently pass. Overflow and G3 have official-kernel evidence. Final formal verify follows. |
| verify | done |  |
| review | done | Two independent review rounds retained request-changes; all accepted findings fixed in Generator rounds 2/3 and independently checked by host. Final 10/10 verify PASS; no unresolved P0/P1. No third evaluator round claimed. |
| deliver | done | Local implementation/evidence commit 4251d707f; Design v1.4. Final 10 checks PASS (root 131, steering/installed sets 62 each, 13 official-kernel cases); real headless/TUI controls passed. All accepted review findings closed by host evidence after two evaluator rounds. No push/merge/release. |

## 需求与关键决策

[需求](REQUIREMENT.md) · [Brainstorm](BRAINSTORM.md) · [Design](DESIGN.md)

关键决策与取舍见 Brainstorm、Design 与各轮 SUMMARY。Codex 多模型是同一 agent、不同模型，不能作为不同厂商计数。

## Evaluator 与降级

- [improve round 1](improve/round-1/SUMMARY.md)
  - codex@gpt-6.1-sol（模型：gpt-6.1-sol）: ok ；durationMs: 191174ms
  - codex@gpt-6-astra（模型：gpt-6-astra）: ok ；durationMs: 185033ms
  - codex@gpt-6.1-terra（模型：gpt-6.1-terra）: ok ；durationMs: 100723ms
  - codex@gpt-5.6-sol（模型：gpt-5.6-sol）: ok ；durationMs: 207921ms
  - claude（模型：-）: unavailable authentication required / not logged in；durationMs: 0ms
  - qodercli（模型：-）: unavailable binary not found；durationMs: 0ms
  - agy（模型：-）: unavailable binary not found；durationMs: 0ms
  - gemini（模型：-）: unavailable binary not found；durationMs: 0ms
  - dsh（模型：-）: unavailable authentication required / not logged in；durationMs: 0ms
  - codebuddy（模型：-）: unavailable authentication required / not logged in；durationMs: 0ms
  - opencode（模型：-）: unavailable binary not found；durationMs: 0ms
- [review round 1](review/round-1/SUMMARY.md)
  - codex@gpt-6.1-sol（模型：gpt-6.1-sol）: ok ；durationMs: 225312ms
  - codex@gpt-6-astra（模型：gpt-6-astra）: ok ；durationMs: 227002ms
  - codex@gpt-6.1-terra（模型：gpt-6.1-terra）: ok ；durationMs: 180404ms
  - codex@gpt-5.6-sol（模型：gpt-5.6-sol）: ok ；durationMs: 274820ms
  - claude（模型：-）: unavailable authentication required / not logged in；durationMs: 0ms
  - qodercli（模型：-）: unavailable binary not found；durationMs: 0ms
  - agy（模型：-）: unavailable binary not found；durationMs: 0ms
  - gemini（模型：-）: unavailable binary not found；durationMs: 0ms
  - dsh（模型：-）: unavailable authentication required / not logged in；durationMs: 0ms
  - codebuddy（模型：-）: unavailable authentication required / not logged in；durationMs: 0ms
  - opencode（模型：-）: unavailable binary not found；durationMs: 0ms
- [review round 2](review/round-2/SUMMARY.md)
  - codex@gpt-6.1-sol（模型：gpt-6.1-sol）: ok ；durationMs: 246089ms
  - codex@gpt-6-astra（模型：gpt-6-astra）: ok ；durationMs: 193670ms
  - codex@gpt-6.1-terra（模型：gpt-6.1-terra）: ok ；durationMs: 86951ms
  - codex@gpt-5.6-sol（模型：gpt-5.6-sol）: ok ；durationMs: 280722ms
  - claude（模型：-）: unavailable authentication required / not logged in；durationMs: 0ms
  - qodercli（模型：-）: unavailable binary not found；durationMs: 0ms
  - agy（模型：-）: unavailable binary not found；durationMs: 0ms
  - gemini（模型：-）: unavailable binary not found；durationMs: 0ms
  - dsh（模型：-）: unavailable authentication required / not logged in；durationMs: 0ms
  - codebuddy（模型：-）: unavailable authentication required / not logged in；durationMs: 0ms
  - opencode（模型：-）: unavailable binary not found；durationMs: 0ms

## 实现与验证

- [Generator round 1](impl/round-1/report.md) · [events](impl/round-1/events.jsonl) · ok
- [Generator round 2](impl/round-2/report.md) · [events](impl/round-2/events.jsonl) · ok
- [Generator round 3](impl/round-3/report.md) · [events](impl/round-3/events.jsonl) · ok
- [验证结果](verify/RESULT.md)

## 时间线

- 2026-11-03T15:26:45.771Z init: L
- 2026-11-03T15:26:45.775Z run-host: pid=91742
- 2026-11-03T15:27:02.365Z start: brainstorm
- 2026-11-03T15:28:42.354Z done: brainstorm
- 2026-11-03T15:28:42.393Z start: design
- 2026-11-03T15:30:15.895Z checks-add: node_modules/.bin/tsc --noEmit -p .
- 2026-11-03T15:30:15.944Z checks-add: node_modules/.bin/tsc --noEmit -p external-plugins/steering
- 2026-11-03T15:30:16.017Z checks-add: /Users/penghao/.bun/bin/bun run --cwd external-plugins/steering build
- 2026-11-03T15:30:16.089Z checks-add: node --test external-plugins/steering/test/*.test.mjs
- 2026-11-03T15:30:16.161Z checks-add: npm test
- 2026-11-03T15:30:16.235Z checks-add: BUN_BINARY=/Users/penghao/.bun/bin/bun node scripts/package-steering.mjs
- 2026-11-03T15:30:16.307Z checks-add: node scripts/check-kernel.mjs
- 2026-11-03T15:30:16.383Z checks-add: node scripts/steering-v2-demo.mjs --out .codeagent/steering-v2-demo-headless
- 2026-11-03T15:30:16.456Z checks-add: node scripts/steering-v2-demo.mjs --tui --out .codeagent/steering-v2-demo-tui
- 2026-11-03T15:30:16.563Z done: design
- 2026-11-03T15:33:52.627Z fanout: improve round 1
- 2026-11-03T15:35:19.032Z done: improve
- 2026-11-03T15:54:17.906Z impl: round 1: ok
- 2026-11-03T15:54:59.165Z checks-add: BUN_BINARY=/Users/penghao/.bun/bin/bun node scripts/verify-steering.mjs
- 2026-11-03T15:54:59.233Z done: impl Host inspected actual diff, standalone source/tests, real evidence and kernel boundary; formal verify follows. Design v1.2 adds installed-artifact check.
- 2026-11-03T15:58:54.354Z verify: PASS
- 2026-11-03T16:03:45.040Z fanout: review round 1
- 2026-11-03T16:15:04.771Z impl: round 2: ok resumed
- 2026-11-03T16:15:44.164Z done: impl Host inspected round-2 report/diff; info-only, slow-save, concurrent task and official summarize reproductions now pass. Formal verify follows.
- 2026-11-03T16:19:57.228Z verify: PASS
- 2026-11-03T16:24:43.931Z fanout: review round 2
- 2026-11-03T16:44:03.910Z impl: round 3: ok resumed
- 2026-11-03T16:45:05.469Z done: impl Host checked final report/diff; transitive summaries, empty edit, terminal capacity and empty-cache offline install independently pass. Overflow and G3 have official-kernel evidence. Final formal verify follows.
- 2026-11-03T16:49:43.917Z verify: PASS
- 2026-11-03T16:50:30.401Z done: review Two independent review rounds retained request-changes; all accepted findings fixed in Generator rounds 2/3 and independently checked by host. Final 10/10 verify PASS; no unresolved P0/P1. No third evaluator round claimed.
- 2026-11-03T16:50:30.467Z start: deliver
- 2026-11-03T16:51:56.012Z done: deliver Local implementation/evidence commit 4251d707f; Design v1.4. Final 10 checks PASS (root 131, steering/installed sets 62 each, 13 official-kernel cases); real headless/TUI controls passed. All accepted review findings closed by host evidence after two evaluator rounds. No push/merge/release.
