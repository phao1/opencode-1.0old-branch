# 中断恢复真实演示（2026-11-04）

目的：验证 one-shot skill 的"后台运行 + 中断恢复"。在临时 git 仓库（`resume-demo`，只放了 `math.mjs` 与 AGENTS.md）里用真实 codex 宿主跑一个 S 尺寸需求。

| 时间 (UTC) | 事件 |
|---|---|
| 16:49:01 | `oneshot.mjs run --size S --bg "在 math.mjs 增加并导出 add(a, b)…"`，后台宿主 pid 34487 |
| 16:49:43 | brainstorm done，checks 登记 `node --test` |
| 16:49:44 | impl（inline）开始后，Planner 立即 `kill -TERM` 宿主及其子进程（模拟中断） |
| 16:49:52 | `oneshot.mjs resume --bg`：新宿主 pid 35655 读取 state.json，从 impl 继续，不重做 brainstorm |
| 16:50:22 | impl done、verify PASS（2/2） |
| 16:50:59 | deliver done，本地提交 `fff1891`（message 含 `Design: …/BRAINSTORM.md`） |

文件：`state.json`（完整 timeline，可见 `run-host` 与 `resume-host` 两次）、`README.md`（run 索引）、`verify/`、`git-log.txt`、交付的 `math.mjs`/`math.test.mjs`。

另一处真实中断：v2.1 steering run 的宿主在 17:43 因 "Selected model is at capacity" 退出，`resume --bg` 后从 verify 继续直至 deliver（见 `../../runs/20261104-0553-steering-v21/state.json` 的 `resume-host` 事件）。
