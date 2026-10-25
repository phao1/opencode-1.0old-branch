# One-shot 验收门禁加固（F2 / F6 / F1）

日期：2026-10-25。依据：Claude 桌面两轮对抗评审及本地反例；用户授权只修改 F2、F6、F1，测试、真实端到端验证后再交 Claude 复审，不发布。

## 验收标准与实现设计

| ID | 必须可观察的行为 | 实现与验证 |
| --- | --- | --- |
| H2 | 自动验收标准绑定配置中的具体 check IDs；无关通用检查、缺少绑定、未知 ID、缺失或失败的绑定检查不能证明通过；planner/revise 不得改写原始绑定。 | criterion 增加 checks 或 manual；入队及设计校验，评估时检查每个绑定项及引用；错误行为 + 仅 typecheck 的负向测试。 |
| H6 | 候选允许暂缺标准；入队必须非空、ID 唯一且绑定完整。同源同内容仍幂等，同源变化明确报冲突并保留旧数据，不静默更新执行中的需求。 | createIssue 比较规范化内容，冲突错误含原 issue ID；CLI issue-update 仅允许无 run 的 candidate 显式更新；并发、草稿补全、冲突/未覆盖测试。 |
| H1 | 默认保护 AGENTS、skill、脚本和存在的根构建清单；仓内检查入口必须存在于 baseCommit；受信外部检查必须显式固定 SHA256。每次 agent/setup/check 前后及交付/accept 前验证完整性。 | 入队记录不可由模型重建的可信文件快照；protectedPaths 默认拒绝改写和新增策略文件，trustedFiles 固定仓内/外部依赖；篡改、删除、隐藏改动、检查前阻断测试。 |
| HM | 人工验收条目不能显示为自动 PASS，也不能迫使 worker 无限修复。 | manual 条目评估必须 passed=null，交付显示 MANUAL/PENDING；操作员 accept 仍需说明；自动项 false 仍进入有界修复。 |
| HE | 真实模型完整执行设计、并行评审、实现、绑定的独立检查、评估和交付，并在固定 OpenCode 内核中验证插件实际加载；负向门禁由独立确定性测试验证。 | 使用本次本地提交作为 base，独立可信检查位于 Builder worktree 外且固定哈希，publish=false；保存调用记录、并发时间、检查和工件。 |

默认保护不禁止新增业务测试。维护 skill/脚本的任务必须由操作员明确缩小 protectedPaths；仍被列为 trustedFiles 的文件不能在同一 run 中修改。检查所依赖的入口会自动识别常见脚本路径；动态导入、内联命令、包管理器命令的额外依赖由操作员列入 trustedFiles。文件哈希与路径检查属于完整性门禁，worktree 不是操作系统沙箱，不能声称能阻止进程访问其他路径或防御有同用户权限的恶意并发程序。

人工验收记录仍是终点，不擅自执行 accept。已有缺少绑定/可信快照的旧 run 不能通过恢复或 accept 绕过新门禁；保留旧证据，明确报迁移缺项，不重置预算冒充恢复。

公开接口沿用固定内核的 plugin tool 与现有注册桥接，one_shot_issue 的 criteria 增加 checks/manual 字段；不新增内核 Hook，不修改 agent-kernel。Claude 桌面只负责复审，本次不实现其自动 worker 适配。F3、F5 后置，F4 不重复增加进程终止逻辑。

## 验证记录

- 本地回归 77/77 通过（原 63 项，加固后新增 14 项）。包含绑定错误、未知/重复标准、人工待验、同源冲突、显式候选更新、检查/skill 篡改、删除、assume-unchanged、Git 忽略新策略文件、外部检查链中途篡改、旧 run 保护及正常新增业务测试。
- TypeScript 类型检查、git diff --check 通过；固定内核 gitlink/源码干净，commit 仍为 517e6c9aa4c61dbc125e7654fc596f1d529f20d9。
- 真实 OpenCode 1.3.17 启动 smoke 通过，one_shot_issue/start/status/cancel 与 steering_status 均已注册；该 smoke 不调用真实模型。
- 真实模型端到端及 Claude 桌面复审：待执行，结果追加于本文件。
