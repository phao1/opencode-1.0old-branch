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
- 真实模型完整端到端通过：run-31f771ec-873f-4773-aa48-21ea14f71ef5，基线 e83bf6346a1beabeb6101bcf913b4728324897c7。7 个独立会话实际读取新 skill，设计与代码评审均有并行时间重叠；5 条原始标准/绑定保留，5 组检查全部通过，样例回归 83/83，40 个声明文件完整性通过（不代表工具链/全部间接依赖都被固定）。
- 流程约 11.4 分钟，0 次设计修订、0 次修复；只证明该绿色路径。最终 awaiting_acceptance，未 accept、合并、推送或发布，样例代码留在隔离 worktree。详细证据在 .codeagent/one-shot-hardening-20261025/REPORT.md 和 report.json。
- 真实内核公开 one_shot_issue 调用保留检查绑定，同源变更正确报错且原候选保留（确定性 provider，未冒充模型质量验证）。代码 reviewer 的轻微文档意见已在本地报告区分 Builder 早期失败与 worker 后续独立检查成功。
- Claude 桌面 Opus 5.5 Extra 已只读复审：F2、F6 实现/回归相符，按声明契约无已证明的核心绕过；提出目录保护缺尾斜杠、未固定入口可见性和同源冲突影响同批信号三个收尾项。本地已修正：保护匹配统一、trust v2 记录 coverage 且未声明 allowUnpinned 的命令拒绝入队、监控逐条保留冲突并继续后续信号。
- 修正后回归 80/80、类型检查和固定内核检查通过；新增三项覆盖目录两种写法、无扩展名生成依赖的声明/交付可见性、混合信号批次及重复冲突复用。真实模型端到端将使用修正后的新基线再验证。
- 文件完整性不是安全执行环境：regression/package/kernel 等检查会以 worker 用户权限执行生成代码、包及可能的生命周期脚本，不能阻止被检代码的副作用或短暂篡改后恢复。PATH 工具链、生成依赖和动态导入没有自动获得可信身份；必须在 coverage/交付中明确未固定项，能固定的外部 helper 需另加 SHA256。
- Claude 桌面属于主控经 UI 转交材料的参考评审，尚未作为 runner worker 或自动放行门禁。后续建议（逐个人工标准确认、PASS 的观察说明强校验）留待后续，不扩大本轮范围。
