# One-shot × Steering 最终报告

日期：2026-11-04 · 分支 `dev1104-oneshot-steering`（自 dev1024 `915d9f9a8` 拉出，dev1024 未改动）
分工：Claude = 总规划 + 验收（Planner/Acceptance）；Codex = 主要执行者（审计、实现、one-shot 宿主、Generator、Evaluator）
依据：`/Users/penghao/Documents/code/oneshot/reference/chencheng-oneshot-reference.md`（下称"参考文档"，§ 指其章节）

## 0. 结论速览

| 完成标准 | 结果 | 证据 |
|---|---|---|
| 新分支 + 未提交改动作为基线快照提交，不丢失、不动原分支 | ✅ `5afc92399` 原样提交 dev1024 的 4 个修改 + 11 个未跟踪文件 | `git show --stat 5afc92399` |
| one-shot skill（SKILL.md + 脚本/模板），能在 Codex 里一键触发 | ✅ `.agents/skills/one-shot/`；Codex 实测能发现并按 `$one-shot` 触发；29 项单测 | §2.2、§3 |
| 用 skill 真实跑通 steering 的 brainstorm→design→并行 improve→impl→并行 review，design 与各 agent 意见留档 | ✅ 两次完整 L 尺寸 run（v2.0、v2.1），每次 1 轮并行 improve + 2 轮并行 review，全部入库 | [v2.0 run](runs/20261104-0426-steering-v2/README.md)、[v2.1 run](runs/20261104-0553-steering-v21/README.md) |
| steering：类型检查、构建、单元/集成测试全过 | ✅ 根 `npm test` 120/120；包内 44/44（含 15 个真实官方 1.3.17 内核用例）；安装产物 44/44；tsc（根 + 包）通过 | §5 |
| 可复现的端到端演示（真实 opencode、运行中插话、能看到吸收并改变行为），附日志/截图 | ✅ 真实 Codex 模型 × 官方 opencode 1.3.17：headless、tmux TUI、自然时序 TUI，各做插件开/关对照；验收人独立复跑 headless 通过 | §5.2 |
| 旧 Codex 成果问题清单与处理结果 | ✅ 17 项逐项裁决与落地提交 | [legacy-codex-audit.md](../review/legacy-codex-audit.md)、[LEGACY-DISPOSITION.md](../review/LEGACY-DISPOSITION.md) |
| 最终报告 + 全部改动已在新分支 commit | ✅ 本文 | `git log 915d9f9a8..dev1104-oneshot-steering` |

一句话：skill 跑出的第一版 steering（v2.0）功能和演示都通过了，但两轮对抗 review 暴露出它在设计层面会"不确定就永久拦截"，验收人打回；用同一个 skill 再跑一次返工（v2.1，fail-open、按请求作用域），代码从 438 行降到 186 行，review 第 2 轮无 P0/P1，验收通过。

## 1. 过程与分工

| 阶段 | 做什么 | 谁 |
|---|---|---|
| 准备 | 读参考文档、AGENTS.md、内核 loop 源码；探测本机 agent；装 bun 1.3.11、官方 opencode 1.3.17、tmux、node/npm | Claude |
| 审计 | 对旧成果出 17 项分级问题清单（带 file:line 证据） | Codex（审计员）→ Claude 裁决 |
| 基线 | 新分支 + 基线快照；恢复用户原始 AGENTS.md 并标注仓库现状 | Claude / Codex |
| skill | Claude 写 [skill 设计](ONE-SHOT-SKILL-DESIGN.md) → Codex 实现 → Claude 审查打回 9 项 → 返工 → 提交；两次真实运行后再打回 6 项（v1.2） | Claude ↔ Codex |
| steering v2.0 | `oneshot.mjs run --size L --bg` 一键启动，Codex 宿主自主跑完 7 个节点（85 分钟） | Codex（宿主/Generator/Evaluator） |
| 验收 | 读设计、代码、两轮 review；判定根因在设计层（fail-closed + 追踪全部历史） | Claude |
| steering v2.1 | 以验收意见为需求再跑一次 L run（80 分钟，含一次宿主因模型容量退出后的 `resume`） | Codex |
| 终验 | 独立重跑类型检查/构建/全部测试/安装产物验证/真实模型演示；补 skill v1.2；本报告 | Claude（+ Codex 修 skill） |

本机 agent 实情（`oneshot.mjs agents --refresh` 实测）：只有 codex 已登录。`claude`、`dsh`、`codebuddy` 二进制存在但未登录；`qodercli`、`agy`、`gemini`、`opencode` 不在 PATH。skill 把它们判为不可用、记录原因并继续——这正是"某个评审 agent 不可用时降级不阻塞"的真实场景。并行的多样性来自 codex 的 4 个模型（gpt-6.1-sol / gpt-6-astra / gpt-6.1-terra / gpt-5.6-sol），所有汇总都如实标注"同一 agent、不同模型"，不冒充不同厂商。

## 2. 架构

### 2.1 仓库现状

```
agent-kernel/              OpenCode v1.3.17 submodule（517e6c9aa，只读；scripts/check-kernel.mjs 校验未改动）
agent-kernel-extension/    capability-watch + 遗留 OpenCode one-shot worker（经公开插件 loader 桥接加载）
external-plugins/
  src/index.ts             聚合桥接入口（唯一允许 import extension 的外置文件）
  steering/                ← 本次交付：独立 steering 插件包（src/ test/ package.json tsconfig.json）
.agents/skills/one-shot/   ← 本次交付：Codex 仓库级 one-shot skill
docs/oneshot/              skill 设计、本报告、两次 run 的全部留档、中断恢复演示证据
docs/review/               旧成果审计与处理记录
scripts/steering-v2-demo.mjs   真实模型端到端演示（headless / --tui / --natural --tui）
scripts/verify-steering.mjs    打包 → 离线安装 → 用安装产物在真实内核上跑测试
```

AGENTS.md 已逐字恢复用户原版（Karpathy 准则、外置优先、ACL 等），并新增"本仓库当前实际状态"一节，说明原文三层蓝图中哪些尚未复刻（五扩展、kernel/ ACL、GlobalConfig、SDK merge、jest），避免把蓝图当现状。

### 2.2 one-shot skill（Codex 宿主）

```
.agents/skills/one-shot/
  SKILL.md                宿主操作手册（≤150 行）：入口/恢复、尺寸判定、逐节点做法、汇总表格式、降级规则
  config.json             agent 池（codex×4 模型、claude、qodercli、agy、gemini、dsh、codebuddy、opencode）、超时、轮数
  references/flow.md      每个节点的输入/输出/完成条件；references/source-mapping.md 节点↔原文对应
  templates/              brainstorm / design / improve.prompt / review.prompt / impl.prompt / summary
  scripts/oneshot.mjs     零依赖 Node CLI（约 660 行，含 lib/）
  scripts/install.sh      软链到 ~/.agents/skills/one-shot，供任意仓库使用
```

- **Planner / Generator / Evaluator 分离**：宿主 Codex 会话是 Planner（brainstorm、design、汇总取舍、分诊、裁决）；`impl` 新开一个 Codex 会话做 Generator，只拿 DESIGN.md + 仓库（迫使 design 自洽），修复时 `codex exec resume` 回到同一 Generator 线程；improve/review 的 n 个只读 agent 与 `verify` 的客观检查是 Evaluator。
- **状态与恢复**：每个 run 一个目录 `docs/oneshot/runs/<YYYYMMDD-HHMM>-<slug>/`，`state.json` 原子写 + `.lock`（死 pid 自动回收）；进行中的记录被 SIGTERM 或宿主崩溃中断后标 `interrupted`；`resume [--model] --bg` 起新宿主从第一个未完成节点继续，已成功的 agent 结果不重跑。
- **并行与降级**：`fanout` 并发启动所有可用 agent（每个独立超时、进程组 kill）；≥1 成功即继续；0 成功写 DEGRADED.md，宿主必须自评并在汇总中显式标注。
- **按需求大小裁剪**：S = brainstorm → impl(inline) → verify → deliver；M = + design + improve；L = M + review（1–n 轮，本轮无采纳的 P0/P1 即停，默认最多 2 轮）。

### 2.3 steering 插件 v2.1（`@oneshot/opencode-steering` 0.5.0）

只用 `@opencode-ai/plugin@1.3.17` 公开 hook 与 SDK，不改内核、不 import 私有模块。生产代码 `src/index.ts` 20 行 + `src/state.ts` 166 行。

核心前提（已对照内核源码核实，见 v2.1 BRAINSTORM）：1.3.17 的会话 loop 是串行的——`messages.transform` 之后才 `handle.process`，`process` 用 `Stream.runDrain` 消费完整个流（含工具执行）才返回，下一轮才会再次 transform。所以 `tool.execute.before` 触发时，这个工具调用一定属于该会话**最近一次 transform 构造的请求**，不需要 callID→assistant 映射，也不需要读历史。

```
用户在运行中输入 ──► chat.message ──► 会话忙碌? ──是──► pending.add(msgID)，toast "已收到"
                                         └─否──► 忽略（原生正常发起新一轮）

下一次 LLM 请求前 ──► messages.transform ──► 本次请求包含的 pending：只在这一次附加 steering reminder（G3）
                                         └► 清空全部 pending（不在请求里的直接丢弃 = fail-open）
                                         └► 压缩请求：不拦截、不加提示

工具执行前 ──► tool.execute.before ──► pending 非空 ⇒ 这个调用是"没看到插话"的请求做出的旧决定
                                         ⇒ 抛 STEERING_STALE_CONTEXT（作为工具错误回给模型，G1）
                                         └► 原生 subtask（callID 为 prt_）、steering_status、未知请求：放行

会话 idle ──► 仍有忙碌期间未被任何请求包含的插话（完成边界竞态，G2）
          ──► 一次 session.messages 确认最后一个 assistant 正常结束且插话在其后
          ──► 一次 synthetic promptAsync 续跑（autoResume:false 可关；取消/错误/revert/删除即作废）
```

与 v2.0 的差异（详见 [v2.1 DESIGN](runs/20261104-0553-steering-v21/DESIGN.md)）：不再追踪全部用户输入、不再做内容指纹/assistant 快照/摘要覆盖链/overflow 重放映射，不设 256/128 容量上限，热路径零历史读取；代价是有意放弃"不确定也拒绝"的保证——不确定时可能漏拦，此时退回原生行为（模型下一轮仍会通过原生 system-reminder 看到插话）。插件永远不会让会话比不装插件时更不可用。

## 3. 与参考文档 one-shot 流程的逐条对照

| 参考文档要求 | 实现 | 真实运行中的证据 |
|---|---|---|
| §1.1-1 Brainstorm：讨论清楚需求，确保大方向没问题 | `brainstorm` 节点：读需求、AGENTS.md、源码与参考实现；无人值守时不提问，把决策写进"默认假设" | v2.0 BRAINSTORM 带 4 个参考实现 + 1.3.17 的源码路径:行号，并纠正了旧报告的 Codex 取消检查错误；v2.1 BRAINSTORM 核实了"串行 loop ⇒ 请求作用域"前提 |
| §1.1-2 Save Design：design 落盘，随 commit/PR 附带，方便 reviewer 了解每个决策点 | `design` 节点按模板写 DESIGN.md（目标/验收 ID/关键决策含备选与代价/文件级计划/验证命令/变更记录），`done design` 校验章节；docs-only commit；之后每个 commit 带 `Design: <path>` | `c8c19bbe1`、`7b3fbf045` 等 design 提交；两个 run 的 DESIGN.md 分别迭代到 v1.4 / v1.3 |
| §1.1-3、§2 第 3 步、§3 Improve：并发问 n 个 agent "any suggestion to improve this design"（替代串行问 5 遍） | `fanout improve`：同一 prompt（核心问句即 "Any suggestion to improve this design?"）并发发给所有可用 agent；宿主逐条裁决写 SUMMARY.md（建议｜来源｜采纳/部分/拒绝｜理由与证据）并升级 design | v2.0：4 模型并行 101–208 秒完成，15 条建议汇总；v2.1：39–162 秒，采纳 7、部分 2 |
| §1.1-4 Impl；§1.2 90% 打磨 design / 10% impl | Generator 新会话只按 DESIGN.md 实现，偏离必须回写；design 不完整就会在 impl 暴露 | v2.1 宿主发现 Generator 读到了旧版 design，主动中止并写 INTERRUPTED.md 后按新版重跑——design 是唯一事实来源 |
| §1.1-5、§2 第 5 步、§3 Review（可选）：1–n 轮，每轮并行 n 个 agent/模型对抗性 review | `fanout review --round N`：只读对抗评审 `git diff <base>` + 未跟踪文件，固定输出 `[P0/P1/P2] … (evidence: path:line)` 与 `VERDICT`；宿主先写复现脚本验证再采纳 → `impl --fix` → `verify`；无采纳的 P0/P1 即停 | v2.0 两轮全员 request-changes，宿主对每条都写了复现（压缩误拦在真实官方内核复现）；v2.1 第 2 轮 2 approve + 2 个仅 P2 |
| §1.2 Planner / Generator / Evaluator 分离（参考 Anthropic 对抗评估） | 见 §2.2；Generator 不评审自己；宿主的复验不冒充新一轮独立 approve | v2.0 SUMMARY 明确"原 Evaluator 的 request-changes 原样保留，修复关闭由宿主客观验证" |
| §1.2 并发优先 | improve/review 全部并发；单测断言 3 个各 2 秒的 agent 总耗时 < 4 秒 | 每轮 4 个模型并行，墙钟时间≈最慢的一个 |
| §1.1 末 换成本机实际可用 agent，不可用时降级、不阻塞 | `agents` 并行 PONG 探测（校验输出含 PONG 且无认证错误，缓存 6h）；每轮汇总记录不可用原因 | 两个 run 的 6 轮 fanout 都是 4 可用 + 7 不可用（未登录/未安装），流程未阻塞 |
| §1.2 按场景裁剪 | S/M/L 节点表；宿主在 brainstorm 末判定，`--size` 可覆盖 | 两个 steering run 为 L；中断恢复演示为 S（无 design/improve，宿主 inline 实现） |
| §1.2 可后台长时间运行（20 分钟–1 小时+），人只做高价值决策和验收 | `run --bg` detached 宿主，日志与 pid 入 state；Planner 只在关键节点抽查 | v2.0 85 分钟、v2.1 80 分钟全自动跑完，期间未向用户提问 |
| 要点：进度持久化、可中断恢复 | `state.json` + `resume`；中断记录 `interrupted`；fanout 只重跑未成功的 agent | ① 演示：S run 在 impl 中被杀，`resume --bg` 从 impl 续跑到 deliver（[证据](evidence/resume-demo-20261104/INDEX.md)）；② v2.1 宿主因模型容量退出，`resume` 从 verify 续跑完成 |
| §1.3 编排层（Issue 驱动、多目录并发、Loop） | 本次不做（参考文档列为扩展方向）；遗留的 OpenCode issue 队列 worker 保留为可选 | 见 §8 |

## 4. steering 调研：OpenCode 2.0 / pi / DSH / Codex 对比结论

（源码均为本地 `/Users/penghao/Documents/code/CodingAgent/*`，路径:行号见 [v2.0 BRAINSTORM](runs/20261104-0426-steering-v2/BRAINSTORM.md)；Codex 的抢占机制由验收人补充核实。）

| 实现 | 插话如何接收 | 何时被模型看到 | 已在途的旧决定 | steer 与 queue |
|---|---|---|---|---|
| OpenCode 2.0 | 内核 SQL inbox（`enqueued_seq`、按会话互斥锁），持久化 | step 边界提升 steer；控制消息（压缩/移动）构成边界 | 不撤销已执行动作 | 区分 steer / queue，可互转；空闲时一次提升一条 queue |
| pi | 内存 steering 队列 + follow-up 队列 | 开始时、准备后、**每个工具批次返回后**领取 steering | 当前批次照常执行完 | follow-up 在 agent 将要停止时领取 |
| DSH | 事件溯源 inbox，target = next-step / next-turn | next-step 先于 next-turn 领取 | 取消默认清空 inbox（可 keepInbox） | 区分 steer（next-step）/ follow-up（next-turn） |
| Codex | `steer_input` 在 active-turn 锁内校验 expected_turn_id/任务类型/空输入后进 pending_input | 下一次采样前；开启 `InstantInterrupt` 时，用户输入会**抢占取消在途采样**并带上新输入重采样（`turn.rs` 的 `watch_user_input`） | 抢占使旧响应根本不产生工具调用 | TUI 区分立即 steer 与排队 |
| OpenCode 1.3.17 原生 | 忙碌时提交即持久化为普通用户消息；Runner join 当前运行；TUI 显示 QUEUED | 每轮 loop 重读消息，新消息包 `<system-reminder>` | **照常执行**（插话落在模型请求进行中时，返回的工具调用全是旧决定） | 不区分 |
| 本插件 v2.1 | 复用原生持久化，插件只在内存登记"忙碌期间到达的插话" | 下一次请求（原生）+ 一次性明确提示（G3） | **在 `tool.execute.before` 拦下**旧请求的未执行工具（G1） | 不区分（G7 未做） |

择优结论：
1. **接收与持久化**交给内核（原生 1.3.17 已具备，与 OpenCode 2.0 / DSH 的方向一致）；外置插件做不到 Codex 的 expected-turn 原子接收或 OpenCode 2.0 的 SQL inbox，也不该在插件里再造一份消息库（旧实现的 596 行 ledger 正是这样做而出问题的）。
2. **吸收边界**采用 pi / DSH 清晰的"下一步"模型：插话在下一次模型请求生效；插件额外在这一次附加"最新指导优先、保留已完成结果、说明跳过了什么"的提示。
3. **旧决定处理**借鉴 Codex"不要执行没看到插话的决定"的思想：Codex 用抢占取消在途请求；1.3.17 公开 hook 无法取消在途请求，最接近的是在工具执行前拦截——这是插件相对原生最大的增量（演示中关插件时旧决定写出了 `obsolete.md`，开插件时没有）。
4. **只做确定的事（fail-open）**：v2.0 的教训是外置插件拿不到原子事务，试图"不确定就拒绝"会与压缩、重放、编辑等内核语义冲突、制造永久阻塞。

## 5. 验证结果

### 5.1 自动化检查（验收人在最终提交上独立重跑）

| 检查 | 结果 |
|---|---|
| `node_modules/.bin/tsc --noEmit -p .` / `-p external-plugins/steering` | 通过 / 通过 |
| `bun run --cwd external-plugins/steering build` | 产出单文件 `dist/index.js`（455 KB，含打包的运行时依赖） |
| `npm test`（根回归：extension、capability-watch、遗留 one-shot、steering、packaging、one-shot skill） | **120/120** |
| `node --test external-plugins/steering/test/*.test.mjs` | **44/44**（29 单测 + 15 个真实官方 1.3.17 内核用例：脚本化 SSE 假模型，覆盖 G1 多工具开/关、G3 晚保存开/关、无插话不变开/关、原生 subtask、取消、撤销/重做、慢保存、手动压缩、overflow 重放换 ID、连续三次压缩、压缩期间插话的 G2 开/关） |
| `node scripts/verify-steering.mjs`（npm pack → 空 cache 离线安装 → 用安装产物重跑） | 离线安装、入口导入、**44/44** 通过 |
| `node scripts/check-kernel.mjs` | 内核固定在 517e6c9aa 且 tracked 文件无改动 |
| `node --test test/oneshot-skill/*.test.mjs` | **29/29** |

### 5.2 端到端演示（真实 Codex 模型 × 官方 opencode 1.3.17，开/关插件对照）

模型通道：本机 OpenCode Zen 免费模型均返回 429（已实测），因此用已登录的 Codex CLI 经 `scripts/lib/codex-cli-bridge.mjs` 包装成 OpenAI 兼容接口；模型的每个决定都是 Codex 真实输出，原始请求/响应/JSONL 全部留档。

| 演示 | 怎么插话 | 关插件 | 开插件 | 证据 |
|---|---|---|---|---|
| headless，暂扣真实决定 | 模型已决定"写 obsolete.md"、尚未执行时，通过 HTTP 提交插话，再放行原决定 | 旧决定照样执行，`obsolete.md` 被写出 | 旧决定被 `STEERING_STALE_CONTEXT` 拦下，`obsolete.md` 不存在，SUMMARY 说明跳过原因 | [v2.1 verify/evidence/headless](runs/20261104-0553-steering-v21/verify/evidence/headless/report.json)；验收人独立复跑同样结果 |
| tmux 真实 TUI，暂扣真实决定 | 在 TUI 输入框键入插话并回车 | 同上（写出 obsolete.md） | 同上；抓屏可见被拦的工具、插话、改写后的 SUMMARY | [evidence/tui](runs/20261104-0553-steering-v21/verify/evidence/tui/) 的 `enabled/completed.txt`、`disabled/completed.txt` |
| tmux 真实 TUI，**自然时序**（不暂扣任何响应） | 第 1 步工具运行（sleep 8 秒）期间直接在 TUI 输入插话 | 吸收插话、跳过 obsolete.md | 吸收插话、跳过 obsolete.md | [evidence/natural-tui](runs/20261104-0553-steering-v21/verify/evidence/natural-tui/report.json) |

如实说明：插话若落在**工具运行期间**，原生 loop 在下一次请求就能吸收（自然时序演示两组都正确改向，插件只多了提示与 toast）；插件的独特价值在插话落在**模型请求进行中**——此时原生会执行旧决定，插件会拦下。

## 6. 使用方法

### 6.1 one-shot skill

前置：已登录的 Codex CLI；Node ≥ 20（本机已用 Homebrew 装 node/npm）。在目标仓库根目录：

```bash
# 在 Codex 里（交互或 exec）直接说：
#   $one-shot <需求描述>
# 或者从 shell 一键后台跑完整流程：
node .agents/skills/one-shot/scripts/oneshot.mjs run --title "需求标题" --req requirement.md --size L --bg
node .agents/skills/one-shot/scripts/oneshot.mjs status --run <id>       # 查看进度
node .agents/skills/one-shot/scripts/oneshot.mjs resume --run <id> --bg  # 中断/宿主退出后续跑（可加 --model 换模型）
node .agents/skills/one-shot/scripts/oneshot.mjs agents --refresh        # 重新探测可用 agent
sh .agents/skills/one-shot/scripts/install.sh                            # 安装为用户级 skill，供其他仓库使用
```

在其他仓库用 `oneshot.config.json` 覆盖 agent 池（例如登录 claude/gemini 后它们会自动通过探测加入）。

### 6.2 steering 插件

```bash
bun run --cwd external-plugins/steering build
BUN_BINARY="$HOME/.bun/bin/bun" node scripts/package-steering.mjs      # 生成 dist/oneshot-opencode-steering-0.5.0.tgz
```

在 opencode 配置中加入插件入口（独立入口与聚合入口二选一）：

```json
{ "plugin": [["/absolute/path/external-plugins/steering/dist/index.js", { "autoResume": true }]] }
```

使用：任务运行中直接在 TUI 输入新指令并回车即可（不需要前缀）。会看到 toast 提示"已收到 / 已在本次请求吸收 / 已拦截旧工具 / 继续"；`steering_status` 工具可查看当前会话状态。

复现演示（需要已登录的 Codex CLI 与 tmux；官方二进制放在 `~/.local/opencode-1.3.17/opencode` 或用 `OPENCODE_BINARY` 指定）：

```bash
node scripts/steering-v2-demo.mjs --out .codeagent/demo-headless
node scripts/steering-v2-demo.mjs --tui --out .codeagent/demo-tui
node scripts/steering-v2-demo.mjs --natural --tui --out .codeagent/demo-natural
```

## 7. 已知限制

steering：
- 已通过 gate 的工具不会被撤销；单个长时间工具（如 `sleep 600`）期间插话要等它结束（G6 未做，可用原生 Esc）。
- 正在运行的子代理（task）看不到父会话的插话（G5 未做）。
- 不区分 steer 与 queue/follow-up（G7 未做）。
- fail-open：保存失败、压缩过滤、编辑、插件加载顺序、进程重启等情况下可能漏拦（退回原生行为），不保证永不漏拦。
- 无原子的取消/派发/保存：取消与 G2 续跑之间仍有窄竞态；忙碌期间的 `noReply` 输入无法区分，需要 `autoResume:false`。
- toast 可能显示在同一 TUI 的其他会话上；`dist/index.js` 455 KB（打包了运行时依赖）。
- 只在 OpenCode 1.3.17 上验证；依赖"会话 loop 串行"这一内核事实，升级内核需复核。

one-shot skill：
- 本机只有 codex 可用，"多 agent"实际是同一 agent 的 4 个模型；claude/qodercli/agy/gemini/dsh/codebuddy 的调用参数按各 CLI 惯例配置，因未登录/未安装而未真实验证。
- 宿主是否严格按 SKILL.md 执行依赖模型遵循度（本次两个 run 都遵循良好，包括主动中止过期 Generator、先复现再采纳 review）。
- 证据体积偏大：两个 steering run 的原始日志与演示归档约 39 MB 已入库（每次重跑演示都保留了 archive 副本）。
- 节点状态校验是结构性的（章节、文件存在、检查通过），不能替代人工判断设计质量——v2.0 就是"全部检查通过但设计需要返工"的例子，这正是保留验收人角色的原因。

环境：本机原本没有 node/npm/bun/tmux，本次安装了 Homebrew node 26 + npm、`~/.bun/bin/bun` 1.3.11、`~/.local/opencode-1.3.17/opencode`（官方发布包）、Homebrew tmux。旧的两个 Mac 测试包未重建（不在本次范围）。

## 8. 后续建议

1. **可选的"抢占"模式（借鉴 Codex InstantInterrupt）**：插话落在模型请求进行中且没有工具在跑时，用公开 `session.abort` + 续跑立即重采样，省去等待旧响应；需要处理 abort 留下的中断 assistant，建议作为 opt-in 单独评审。
2. **queue / follow-up**：用前缀（例如 `>>`）把输入延后到本轮结束再处理，对齐 pi / DSH / OpenCode 2.0。
3. **子代理传播**：父会话收到插话时，让运行中子会话的下一个工具调用拿到提示并尽快返回。
4. **skill 证据策略**：原始日志压缩或只保留最终一次演示，入库摘要 + 关键片段，完整原始日志放 `.codeagent/`。
5. **真正的多厂商评审**：登录 claude / gemini / qodercli 后无需改代码即可加入 improve/review 池。
6. **编排层（参考文档 §1.3）**：在 skill 之上加 issue 驱动批量运行（多目录并发、loop 分诊），可复用遗留 worker 的 issue/验收绑定思路。
7. **内核侧**：若可改内核，最小的上游补丁是给 `tool.execute.before` 传 `messageID`，并提供"带插话重启当前 step"的公开 API；或直接迁移到 OpenCode 2.0 的 inbox 模型。

## 9. 文档索引

| 文档 | 内容 |
|---|---|
| [ONE-SHOT-SKILL-DESIGN.md](ONE-SHOT-SKILL-DESIGN.md) | skill 设计（v1.2），含节点↔原文对应 |
| [baseline/oneshot-skill-v2-acceptance.md](../baseline/oneshot-skill-v2-acceptance.md) | skill 验收与两轮返工记录 |
| [runs/20261104-0426-steering-v2/](runs/20261104-0426-steering-v2/README.md) | steering v2.0 run：需求、brainstorm、design v1.4、improve/review 各 agent 原文与汇总、Generator 报告、verify 证据 |
| [runs/20261104-0553-steering-v21/](runs/20261104-0553-steering-v21/README.md) | steering v2.1 run（同上结构，含自然时序 TUI 演示） |
| [evidence/resume-demo-20261104/](evidence/resume-demo-20261104/INDEX.md) | 中断恢复真实演示 |
| [../review/legacy-codex-audit.md](../review/legacy-codex-audit.md) | 旧成果独立审计（17 项） |
| [../review/LEGACY-DISPOSITION.md](../review/LEGACY-DISPOSITION.md) | 逐项处理结果与提交 |
| [../../external-plugins/steering/README.md](../../external-plugins/steering/README.md) | 插件安装、语义、限制 |
| [../baseline/STEERING.md](../baseline/STEERING.md) | steering 基线设计文档（已同步 v2.1） |
