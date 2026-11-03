# 旧 Codex 成果：问题清单与处理结果

日期：2026-11-04 · 分支 `dev1104-oneshot-steering`（自 dev1024 `915d9f9a8` 拉出，dev1024 未改动）
问题来源：[legacy-codex-audit.md](legacy-codex-audit.md)（独立审计，17 项，含证据）。本文记录每项的裁决、理由和落地提交。

## 基线保护

| 动作 | 结果 |
|---|---|
| dev1024 上未提交的 4 个修改 + 11 个未跟踪文件 | 原样作为 `5afc92399 chore: snapshot uncommitted dev1024 work as baseline` 提交到新分支，无丢失 |
| dev1024 分支 | 未改动（仍为 `915d9f9a8`） |
| `.codeagent/` 下 4 个旧 one-shot run worktree 与证据 | 保留在本机（gitignored），未删除、未合入 |
| `OpenCode-Mac-Test-915d9f9a8`、`OpenCode-Real-Package-20261028` 两个包目录 | 未改动 |

## 逐项处理

| ID | 问题（摘要） | 裁决 | 处理结果 / 理由 | 提交 |
|---|---|---|---|---|
| L-01 | 重写 AGENTS.md 丢失用户原始准则 | 修改 | 逐字恢复用户原版（Karpathy 四准则、命令、ACL、外置优先等），新增「本仓库当前实际状态」一节如实说明哪些蓝图尚未复刻 | `5f065e982` |
| L-02 | submodule URL 自引用 | 保留 + 文档 | 固定提交 517e6c9aa 就是官方 v1.3.17 发布提交，当前可用；改远端会影响用户的 fork 管理，超出本次范围。AGENTS.md 写明只用 `--init`、禁止 `--remote` | `5f065e982` |
| L-03 | 三层结构能力缩减却沿用同名 | 修改（文档） | AGENTS.md 现状一节逐项列出存在/缺失（五扩展、ACL、GlobalConfig、SDK merge、jest 均未复刻） | `5f065e982` |
| L-04 | external-plugins 跨目录 import extension | 修改 | 新 steering 是独立包 `external-plugins/steering/`（自有 src/test/package.json/tsconfig/构建），不 import extension 或内核私有模块（打包脚本做私有引用扫描）；`external-plugins/src/index.ts` 作为唯一聚合桥接入口保留，AGENTS.md 已标注为唯一例外，并补上把插件 options 透传给 SteeringPlugin | `4251d707f` `b93fc37c5` |
| L-05 | one-shot 无按尺寸裁剪、reviewer 失败即 blocked | 重写 | 新 Codex skill：S/M/L 节点表、探测+降级（≥1 成功即继续，0 成功 DEGRADED 自评） | `60d42de9b` |
| L-06 | 入口是 OpenCode 工具入队，不保证模型多样性 | 重写 | 新 skill 以 Codex 为宿主（`.agents/skills/one-shot`，`$one-shot` 触发）；agent 池按 CLI+模型配置并如实标注「同一 agent 不同模型」。旧 OpenCode worker 标注为遗留可选（对应参考文档 §1.3 编排扩展方向；打包脚本仍依赖它，故不删） | `60d42de9b` `5f065e982` |
| L-07 | design 在 ignored 目录、不随 commit | 重写 | 新 skill 的 run 目录 `docs/oneshot/runs/<id>/` 入库；commit message 带 `Design: <path>` | `60d42de9b` |
| L-08 | steering 每工具多次全量查询、事件全量重写 | 重写 | v2.1：观察、transform、gate、流式事件、状态查询均不读历史；只有 idle 时存在未吸收插话才做一次 `session.messages` 读取（可用 `autoResume:false` 关闭）。A5 测试用 SDK 调用计数断言 | `b93fc37c5` |
| L-09 | native subtask 拒绝悬挂、损坏文件持续拒绝 | 重写 | v2.1：原生 subtask（before hook 在 catch 外、callID 为 `prt_` 前缀）一律放行，真实内核测试覆盖；去掉磁盘 ledger，不存在“文件损坏后持续拒绝”；fail-open 语义保证任何不确定都不会永久拦截 | `b93fc37c5` |
| L-10 | ledger 无跨实例锁 | 重写 | v2.1 只有进程内、按会话的短生命周期状态（idle/错误/取消/删除/revert 即清），无共享文件，问题不复存在 | `b93fc37c5` |
| L-11 | 1044 行 one-shot 框架过重 | 重写 | 新 skill 核心 JS 约 600 行；trusted-files/sha256/issue 队列不进入主流程 | `60d42de9b` |
| L-12 | 默认测试不启动真实 OpenCode | 修改 | `external-plugins/steering/test/kernel.test.mjs` 启动真实官方 1.3.17 server（隔离 XDG）+ 本地脚本化 SSE 假模型，确定性覆盖 G1/G2/G3、无插话不变、subtask、取消、撤销、慢保存、压缩/overflow 重放等 15 个真实内核用例，已接入根 `npm test`；`scripts/verify-steering.mjs` 对安装产物再跑一遍 | `4251d707f` `b93fc37c5` |
| L-13 | 成功 run 证据留在 ignored 状态目录 | 保留 | 历史证据原地保留，不追认为验收；本次新流程的证据全部入库 | — |
| L-14 | 11 个 probe/verify 一次性脚本 | 修改 | 6 个依赖旧 ledger 的脚本顶部标 `LEGACY v0.3`、指向替代命令；4 个内核缺口可行性探针保留为历史证据；`verify-steering.mjs` 改为 v2 安装产物验证入口；新增 `scripts/steering-v2-demo.mjs`（真实模型 headless/TUI/自然时序） | `4251d707f` |
| L-15 | 旧包依赖本机绝对路径 | 保留（记录） | 打包不在本次需求内；最终报告「已知限制」中说明 | — |
| L-16 | 报告口径（26 文件/84 测试 vs 现 31/88） | 保留（记录） | 历史报告不改写；以本次新证据为准 | — |
| L-17 | 对照文档 Codex 取消检查表述不准 | 修改 | 按审计修正并追加变更记录；新 BRAINSTORM 也独立复核了该点 | `5f065e982` |

## Steering 的两轮重写

| 版本 | run | 结果 | 验收裁决 |
|---|---|---|---|
| v2.0（0.4.0） | [20261104-0426-steering-v2](../oneshot/runs/20261104-0426-steering-v2/README.md) | 功能与真实演示通过；两轮对抗 review 共报出 5+6 项 P1/P2（压缩/重放后永久拦截、256/128 容量导致无法发消息等），修到 438 行 | **不通过**：fail-closed + 追踪全部历史是共同根因，继续打补丁会重蹈旧 ledger 覆辙，打回设计层返工 |
| v2.1（0.5.0） | [20261104-0553-steering-v21](../oneshot/runs/20261104-0553-steering-v21/README.md) | fail-open、按请求作用域；生产代码 186 行（有效约 174 行）；review 第 2 轮 2 approve + 2 个仅 P2（已修） | **通过**，见最终报告 |

旧 ledger（`external-plugins/src/steering.ts`、`external-plugins/src/steering/ledger.ts`）与旧测试 `test/steering/plugin.test.mjs` 已在 `4251d707f` 删除，其中有价值的行为契约迁入新测试。
