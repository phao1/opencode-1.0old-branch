# 流程原文对应

权威副本：docs/oneshot/ONE-SHOT-SKILL-DESIGN.md §2。原文：`/Users/penghao/Documents/code/oneshot/reference/chencheng-oneshot-reference.md`（用户提供的流程原文；§ 号指该原文）。

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

