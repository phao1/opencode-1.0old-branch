# One-shot Skill v2 设计（Codex 宿主）

版本 v1.1 · 2026-11-04 · Planner：Claude（总规划/验收）· Generator：Codex
依据：`/Users/penghao/Documents/code/oneshot/reference/chencheng-oneshot-reference.md`（下称"参考文档"，§ 号指它的章节）

## 1. 目标与非目标

目标：把 Brainstorm → Save Design → Improve Design → Impl → Review 封装成 Codex 里一句话触发的 skill，
人只在开头给需求、结尾验收；中间由宿主 agent 自主决策，必要时并行调用本机其他 agent/模型。首个用途：开发 OpenCode 1.0 外置插件。

非目标（本版不做）：Issue 驱动批量编排、定时 Loop、Herdr 式多项目管理（参考文档 §1.3，列为扩展方向）；
旧版的 trusted-files/sha256/allowUnpinned 等防篡改机制；OpenCode 进程内 runner。

## 2. 节点 ↔ 原文对应

| 节点 | 做什么 | 原文依据 |
|---|---|---|
| brainstorm | 讨论清楚需求，确保大方向没问题；需要时先调研；无人值守时自己做决定并把假设写下来 | §1.1-1「讨论清楚需求，确保大的方向和思路没问题」；§3「先讨论清楚需求」 |
| design (Save Design) | 按模板落盘 `DESIGN.md`，记录每个决策点及备选；随 commit 附带 | §1.1-2「commit 附上 design（存于仓库…）方便 reviewer 了解细节和每个决策点」 |
| improve (Improve Design) | **并行**问 n 个本机可用 agent/模型 "any suggestion to improve this design"，宿主汇总取舍后更新 design | §1.1-3、§2 新版第 3 步「ask 4 agents … for improve the design」；§3「一次并发问 n 个 agent」 |
| impl | Generator 只按 design 实现；偏离必须回写 design | §1.1-4；§1.2「90% 打磨 design，10% impl」 |
| verify | 跑 design 里声明的检查命令（类型检查/构建/测试/演示），客观证据落盘 | §1.3「验收：用例 + 人工 + 高质量 design + 日志」 |
| review（可选） | 1–n 轮，每轮并行 n 个不同 agent/模型对抗性 review，宿主分诊、修复、复验 | §1.1-5、§2 第 5 步；§3「核心改动或拿不准的改动，会跑 1-n 轮的 review」 |
| deliver | 提交代码 + design + 各 agent 意见汇总；commit message 引用 design 路径；不自动合并/发布 | §1.1-2；AGENTS.md「不自动合并或发布」 |

横切原则：
- **Planner / Generator / Evaluator 分离**（§1.2、§4.1 2026-03-25）：宿主会话 = Planner（brainstorm、design、汇总、分诊、最终裁决）；
  impl 默认交给**全新**的 Codex 会话 = Generator（只拿 DESIGN.md + 仓库，迫使 design 自洽完整）；
  improve/review agent 与 verify 检查 = Evaluator（只读、不同模型/agent）。Generator 不评审自己。
- **并发优先**（§1.2）：improve/review 的 n 个 agent 同时跑，单个超时/失败不影响其他。
- **降级不阻塞**（§1.1 末段）：先探测哪些 CLI 可用；不可用的跳过并记录；≥1 个成功即继续；0 个成功时宿主做一轮自评并在汇总里标 `DEGRADED`，流程继续。
- **按场景裁剪**（§1.2）：见 §4。
- **可后台长时间运行、可中断恢复**（§1.2）：所有进度在 `state.json`；任何节点中断后，新会话 `resume` 从第一个未完成节点继续，已完成的 agent 结果不重跑。

## 3. 文件布局

```
.agents/skills/one-shot/            # Codex repo 级 skill（codex 扫描 <repo>/.agents/skills）
  SKILL.md                          # 宿主操作手册（≤250 行）
  config.json                       # 默认 agent 池、超时、轮数
  references/flow.md                # 每个节点的输入/输出/完成条件（SKILL.md 按需读）
  references/source-mapping.md      # = 本文 §2 表格的权威副本
  templates/{brainstorm,design,improve.prompt,review.prompt,impl.prompt,summary}.md
  scripts/oneshot.mjs               # 零依赖 Node ≥20 CLI（状态机 + 并行 fan-out + 后台）
  scripts/install.sh                # 软链到 ~/.agents/skills/one-shot，供其他仓库使用
test/oneshot-skill/*.test.mjs       # node:test，用假 agent 测并行/超时/降级/恢复
docs/oneshot/runs/<run-id>/         # 每次运行的全部留档（随 commit 提交）
```

run 目录：
```
state.json                 # 机器可读进度、初始化 baseCommit（原子写：tmp+rename；.lock 防并发宿主）
REQUIREMENT.md             # 原始需求原文
BRAINSTORM.md  DESIGN.md   # design 带版本号与变更记录
improve/round-1/<agent>.prompt.md <agent>.md <agent>.log SUMMARY.md
impl/round-1/{prompt.md,report.md,events.jsonl}
verify/<n>-<check>.log  verify/RESULT.md
review/round-1/<agent>.md … SUMMARY.md
README.md                  # 运行索引：时间线、使用/降级的 agent、关键决策、证据链接
```

run id 使用本地时间 `YYYYMMDD-HHMM`，state 的 ISO 时间保持 UTC。
init 用 `git rev-parse HEAD` 记录 `baseCommit`；非 Git 仓库或无可用 HEAD 时为 null。

## 4. 尺寸裁剪（宿主在 brainstorm 末尾判定，可被 `--size` 覆盖）

| size | 判定 | 节点 |
|---|---|---|
| S | vibe/很小：单文件或 <~50 行，无接口/行为契约变化 | brainstorm(简) → impl(inline) → verify → deliver |
| M（默认） | 新功能/新插件，多文件，有明确验收 | brainstorm → design → improve(1 轮) → impl → verify → deliver |
| L | 核心改动、并发/状态/安全、不熟悉的领域或拿不准 | M + review（1–n 轮，默认最多 2 轮） |

review 停止条件：本轮无被采纳的 P0/P1，或达到 `maxReviewRounds`。improve 默认 1 轮；若汇总中采纳了 P0 级设计修改，可再跑 1 轮（`maxImproveRounds` 默认 2）。

## 5. CLI：`scripts/oneshot.mjs`

所有命令在仓库根执行，`--run <id>` 缺省取最近一次未完成 run。输出人类可读文本，`--json` 时输出 JSON。

| 命令 | 行为 |
|---|---|
| `agents [--refresh]` | 并行探测 config 中的 agent 池：二进制可执行 + 极短 smoke 提示（期望回 `PONG`，超时 90s）。结果缓存 `~/.cache/oneshot/agents.json`（TTL 6h），打印 可用/不可用/原因 |
| `init --title <t> [--size S\|M\|L] [--req <file\|->] [--slug <s>]` | 建 `docs/oneshot/runs/<YYYYMMDD-HHMM>-<slug>/`，写 REQUIREMENT.md、state.json（按 size 生成节点表） |
| `status` / `next` | 打印节点状态；`next` 打印下一个未完成节点 + 该节点在 flow.md 中的指令摘要 |
| `start <node>` / `done <node> [--note]` / `skip <node> --reason` | 宿主标记节点；`done` 会校验产物（如 design 需要 DESIGN.md 且含模板必备章节） |
| `fanout improve\|review [--round N] [--agents a,b] [--timeout s]` | 按模板生成 prompt 文件，**并发**启动所选/可用 agent（只读模式），每个 agent 独立超时（超时整组进程 kill），结果写 `<agent>.md`；已有成功结果的 agent 在重跑时跳过（恢复语义）；state 记录每个 agent 的 ok/failed/timeout/unavailable、耗时 |
| `impl [--round N] [--fix <findings.md>] [--inline]` | Generator：新开 `codex exec`（可写）执行 impl.prompt + DESIGN.md；`--json` 事件落盘并记录 thread id；`--fix` 时优先 `codex exec resume <thread>` 带上分诊后的问题；`--inline` 只记录"宿主自己实现" |
| `verify` | 依次执行 state.checks（来自 design 的「验证命令」段，由宿主用 `checks add "<cmd>"` 登记），日志写 verify/，全部通过才算 done |
| `checks add "<cmd>" [--name n]` / `checks list` | 维护检查命令 |
| `run "<需求>" [--size] [--bg]` | 一键：`init` 后启动宿主 `codex exec` 执行 `$one-shot`（跑完整流程）；`--bg` 时 detached + nohup，日志写 run 目录，pid 记入 state |
| `resume [--bg]` | 宿主进程不在则新起宿主会话，提示词 = "继续 run <id>，从 state.json 的下一个节点开始" |
| `report` | 生成/刷新 run 目录 README.md |

agent 调用约定（config.json，可在仓库 `oneshot.config.json` 覆盖）：每个 agent 有 `id`、`bin`（可多候选路径，含 `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex` 这类非 PATH 位置）、`args` 模板（`{prompt_file}`、`{out_file}`、`{cwd}` 占位）、`stdin`（是否走 stdin）、`readonly` 参数。
统一把完整 prompt 写到文件，再给 agent 一句"读取并执行 <prompt_file> 中的指令，把答案输出到 stdout"，避免 argv 长度问题。
默认池：`codex@gpt-6.1-sol`、`codex@gpt-6-astra`、`codex@gpt-6.1-terra`、`codex@gpt-5.6-sol`、`claude`、`qodercli`、`agy`、`gemini`、`dsh`、`codebuddy`。
同一 CLI 换模型算不同 Evaluator 视角，但报告中必须如实标注"同一 agent、不同模型"，不得冒充不同厂商。
默认 `agentTimeoutSeconds=1500`、`generatorTimeoutSeconds=3600`。report 的 Evaluator 列表逐个打印模型与
`durationMs`，未定义的模型或耗时用 `-`，保留 0ms。

improve/review prompt 必须提供 REQUIREMENT.md、BRAINSTORM.md、DESIGN.md 和上一轮同类评审的 SUMMARY.md
（若存在），要求对照需求检查设计是否满足验收、是否越界。review 另用 `{base}` 渲染初始化基准，明确评审
`git diff {base}`（包含已提交与未提交累计改动），以及 `git status --short --untracked-files=all` 找出的未跟踪新文件。
impl prompt 同样告知 base。base 为 null 时不执行 `git diff null`，检查工作区并记录缺少基准的局限，不用当前 HEAD 替代。

## 6. SKILL.md 宿主流程（要点）

1. `oneshot.mjs status`：有未完成 run 就恢复；否则 `init`。无人值守：不向用户提问，把需要人拍板的事写进 BRAINSTORM.md「默认假设」后继续。
2. brainstorm：读 AGENTS.md、相关源码/参考实现；产出 BRAINSTORM.md；判定 size。
3. design：按模板写 DESIGN.md（验收标准带 ID 且可验证；每个关键决策写备选与理由；测试/验证命令；文件级实施计划）；`checks add` 登记验证命令；docs-only commit。
4. improve：`fanout improve`；宿主逐条读意见 → SUMMARY.md（建议 | 来源 agent | 采纳/部分/拒绝 | 理由）→ 更新 DESIGN.md（版本+变更记录）→ commit。
5. impl：`impl`（Generator）；读 report，确认无越界改动；偏离写回 design。
6. verify：`verify`；失败 → 分析根因 → `impl --fix` → 再 verify（最多 3 次，仍失败则停下写明阻塞）。
7. review（L 或显式要求）：`fanout review --round N` → 分诊 SUMMARY.md → 采纳项 `impl --fix` → verify → 下一轮/停止。
8. deliver：`report`；commit（message 含 `Design: <path>`）；不 push/merge，除非用户要求。

fanout/impl/verify 可能运行 10–60 分钟，宿主调用 shell 工具时应设置足够长的执行超时（例如 ≥3600000 ms）；
若工具提前返回会话或进程仍在运行，必须持续等待直到退出后再继续。中断后重跑同一命令，fanout 复用成功 agent、
impl 复用成功报告并为未完成尝试另开轮次，verify 重新运行全部检查。
CLI 收到 SIGINT/SIGTERM 会 kill 活动子进程组；进行中的 agent 会丢失，属预期，已落盘的成功结果保留。
设计校验允许标题带数字加 `.`/`、` 的编号前缀和括号等后缀，去前缀与空白后以必备章节名开头即可；
前 10 行出现 `v\d+(\.\d+)*` 即满足版本号要求。

## 7. 验收标准（本 skill 自身）

- A1 `node --test test/oneshot-skill/*.test.mjs` 全过，覆盖：尺寸→节点表；状态原子写与锁；fan-out 真并发（3 个各 sleep 2s 的假 agent 总耗时 <4s）；单 agent 超时被 kill 且其他成功；全部失败→DEGRADED 记录；中断后重跑 fan-out 跳过已成功 agent；`done` 产物校验；`impl --fix` 记录与 resume 参数；baseCommit、评审上下文与模板渲染、本地时间、宽松章节/版本号、模型与耗时缺省值。
- A2 `oneshot.mjs agents` 在本机真实输出：codex 各模型可用，claude/dsh/codebuddy 等因未登录/不存在被标为不可用，流程不阻塞。
- A3 在 Codex 里用 `$one-shot` 真实跑完 steering 需求的 M/L 全流程（含并行 improve 与并行 review），run 目录留档完整并提交。
- A4 SKILL.md ≤250 行，宿主能只靠它 + flow.md 完成流程；`install.sh` 可把 skill 装到用户级目录。

## 8. 变更记录

- v1.0 2026-11-04 初版。
- v1.1 2026-11-04 返工：记录并传递初始化 diff 基准，补全评审需求与上一轮汇总；明确长命令等待、SIGTERM 清理与恢复；run id 改用本地时间；放宽设计章节/版本号校验；Evaluator 默认超时改为 1500 秒；测试统一使用 glob 并删除入口；验收记录改为 Planner 审查后提交；report 展示模型、耗时及缺省值。
