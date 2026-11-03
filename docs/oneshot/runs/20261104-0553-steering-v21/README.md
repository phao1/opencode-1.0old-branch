# steering v2.1：按验收意见返工为 fail-open 请求作用域语义

Run: 20261104-0553-steering-v21 · L · 2026-11-03T16:53:16.409Z

| 节点 | 状态 | 备注 |
| --- | --- | --- |
| brainstorm | done |  |
| design | done |  |
| improve | done |  |
| impl | done | 宿主核对DESIGN v1.3修复、report与实际diff；G2控制不持久化G3、首个transform临时1次后归零；174有效行，进入最终全量复验 |
| verify | done |  |
| review | done | 两轮独立评审四个Codex模型；采纳项经Generator r3/r4修复，v1.3最终8项验证全过，无残余发现 |
| deliver | done | 本地实现与证据提交b93fc37c5；DESIGN v1.3，最终8/8检查、根113/113、安装44/44、真实模型6/6；不push/merge/发布，动态宿主记录保留本地 |

## 需求与关键决策

[需求](REQUIREMENT.md) · [Brainstorm](BRAINSTORM.md) · [Design](DESIGN.md)

关键决策与取舍见 Brainstorm、Design 与各轮 SUMMARY。Codex 多模型是同一 agent、不同模型，不能作为不同厂商计数。

## Evaluator 与降级

- [improve round 1](improve/round-1/SUMMARY.md)
  - codex@gpt-6.1-sol（模型：gpt-6.1-sol）: ok ；durationMs: 143518ms
  - codex@gpt-6-astra（模型：gpt-6-astra）: ok ；durationMs: 122942ms
  - codex@gpt-6.1-terra（模型：gpt-6.1-terra）: ok ；durationMs: 39167ms
  - codex@gpt-5.6-sol（模型：gpt-5.6-sol）: ok ；durationMs: 162074ms
  - claude（模型：-）: unavailable authentication required / not logged in；durationMs: 0ms
  - qodercli（模型：-）: unavailable binary not found；durationMs: 0ms
  - agy（模型：-）: unavailable binary not found；durationMs: 0ms
  - gemini（模型：-）: unavailable binary not found；durationMs: 0ms
  - dsh（模型：-）: unavailable authentication required / not logged in；durationMs: 0ms
  - codebuddy（模型：-）: unavailable authentication required / not logged in；durationMs: 0ms
  - opencode（模型：-）: unavailable binary not found；durationMs: 0ms
- [review round 1](review/round-1/SUMMARY.md)
  - codex@gpt-6.1-sol（模型：gpt-6.1-sol）: ok ；durationMs: 355453ms
  - codex@gpt-6-astra（模型：gpt-6-astra）: ok ；durationMs: 183766ms
  - codex@gpt-6.1-terra（模型：gpt-6.1-terra）: ok ；durationMs: 52516ms
  - codex@gpt-5.6-sol（模型：gpt-5.6-sol）: ok ；durationMs: 240098ms
  - claude（模型：-）: unavailable authentication required / not logged in；durationMs: 0ms
  - qodercli（模型：-）: unavailable binary not found；durationMs: 0ms
  - agy（模型：-）: unavailable binary not found；durationMs: 0ms
  - gemini（模型：-）: unavailable binary not found；durationMs: 0ms
  - dsh（模型：-）: unavailable authentication required / not logged in；durationMs: 0ms
  - codebuddy（模型：-）: unavailable authentication required / not logged in；durationMs: 0ms
  - opencode（模型：-）: unavailable binary not found；durationMs: 0ms
- [review round 2](review/round-2/SUMMARY.md)
  - codex@gpt-6.1-sol（模型：gpt-6.1-sol）: ok ；durationMs: 172590ms
  - codex@gpt-6-astra（模型：gpt-6-astra）: ok ；durationMs: 115888ms
  - codex@gpt-6.1-terra（模型：gpt-6.1-terra）: ok ；durationMs: 40866ms
  - codex@gpt-5.6-sol（模型：gpt-5.6-sol）: ok ；durationMs: 205150ms
  - claude（模型：-）: unavailable authentication required / not logged in；durationMs: 0ms
  - qodercli（模型：-）: unavailable binary not found；durationMs: 0ms
  - agy（模型：-）: unavailable binary not found；durationMs: 0ms
  - gemini（模型：-）: unavailable binary not found；durationMs: 0ms
  - dsh（模型：-）: unavailable authentication required / not logged in；durationMs: 0ms
  - codebuddy（模型：-）: unavailable authentication required / not logged in；durationMs: 0ms
  - opencode（模型：-）: unavailable binary not found；durationMs: 0ms

## 实现与验证

- [Generator round 1](impl/round-1/report.md) · [events](impl/round-1/events.jsonl) · interrupted
- [Generator round 2](impl/round-2/report.md) · [events](impl/round-2/events.jsonl) · ok
- [Generator round 3](impl/round-3/report.md) · [events](impl/round-3/events.jsonl) · ok
- [Generator round 4](impl/round-4/report.md) · [events](impl/round-4/events.jsonl) · ok
- [验证结果](verify/RESULT.md)

## 时间线

- 2026-11-03T16:53:16.412Z init: L
- 2026-11-03T16:53:16.416Z run-host: pid=37316
- 2026-11-03T16:54:17.944Z start: brainstorm 
- 2026-11-03T16:54:18.024Z done: brainstorm 
- 2026-11-03T16:54:18.125Z start: design 
- 2026-11-03T16:55:55.550Z checks-add: node_modules/.bin/tsc --noEmit -p .
- 2026-11-03T16:55:55.632Z checks-add: node_modules/.bin/tsc --noEmit -p external-plugins/steering
- 2026-11-03T16:55:55.730Z checks-add: npm test
- 2026-11-03T16:55:55.833Z checks-add: node scripts/check-kernel.mjs
- 2026-11-03T16:55:55.933Z checks-add: node scripts/verify-steering.mjs
- 2026-11-03T16:55:56.036Z checks-add: node scripts/steering-v2-demo.mjs --out docs/oneshot/runs/20261104-0553-steering-v21/verify/evidence/headless
- 2026-11-03T16:55:56.136Z checks-add: node scripts/steering-v2-demo.mjs --tui --out docs/oneshot/runs/20261104-0553-steering-v21/verify/evidence/tui
- 2026-11-03T16:55:56.239Z checks-add: node scripts/steering-v2-demo.mjs --natural --tui --out docs/oneshot/runs/20261104-0553-steering-v21/verify/evidence/natural-tui
- 2026-11-03T16:55:56.442Z done: design 
- 2026-11-03T16:58:42.082Z fanout: improve round 1
- 2026-11-03T16:59:50.658Z done: improve 
- 2026-11-03T17:17:13.819Z impl: round 2: ok
- 2026-11-03T17:17:21.626Z done: impl 宿主已核对round-2报告、累计diff与范围；固定内核tracked干净，按DESIGN v1.1进入正式verify
- 2026-11-03T17:22:27.521Z verify: PASS
- 2026-11-03T17:29:20.130Z fanout: review round 1
- 2026-11-03T17:41:19.996Z impl: round 3: ok resumed
- 2026-11-03T17:41:26.699Z done: impl 宿主核对v1.2三项修复与报告；摘要G2官方开关正例、26单测、110根回归、41安装入口通过，进入正式复验
- 2026-11-03T17:44:15.828Z resume-host: pid=45151
- 2026-11-03T17:49:54.658Z verify: PASS
- 2026-11-03T17:53:44.346Z fanout: review round 2
- 2026-11-03T18:06:17.827Z impl: round 4: ok resumed
- 2026-11-03T18:06:41.483Z done: impl 宿主核对DESIGN v1.3修复、report与实际diff；G2控制不持久化G3、首个transform临时1次后归零；174有效行，进入最终全量复验
- 2026-11-03T18:12:07.913Z verify: PASS
- 2026-11-03T18:12:36.161Z done: review 两轮独立评审四个Codex模型；采纳项经Generator r3/r4修复，v1.3最终8项验证全过，无残余发现
- 2026-11-03T18:12:36.262Z start: deliver 
- 2026-11-03T18:13:40.848Z done: deliver 本地实现与证据提交b93fc37c5；DESIGN v1.3，最终8/8检查、根113/113、安装44/44、真实模型6/6；不push/merge/发布，动态宿主记录保留本地
- 2026-11-03T18:22:59.778Z interrupted: impl round 1: reconcile: CLI pid unknown (legacy record) is not alive
