# 阶段交接契约

这份说明细化现有 runner，不引入另一套状态机。阶段输出遵循 `agent-kernel-extension/src/codeagent/one-shot/types.ts` 的 JSON schema；Markdown 设计放在 plan.design，由 runner 保存 DESIGN.md。只读 agent 不自行写设计文件。

| 阶段 / role | 应做的工作 | 交接证据 |
| --- | --- | --- |
| designing / plan | brainstorm：读需求和真实接口，比较最小方案，记录取舍、边界、失败路径、实现计划 | summary、design、原始 criteria、manualTests |
| design_review / design_review | 独立读相同设计和代码，检查可实现性、生命周期、权限、可测性；不修改文件 | findings 含 severity、可定位 evidence 和具体缺陷 |
| design_review / revise | 主 planner 合并重复意见，按证据处理冲突，将采纳/拒绝及理由写进 design；保留所有原始标准 | 修订的完整 plan，再交 reviewer 检查 |
| implementing / build | 只实现已审设计和允许路径；修复时结合反馈及日志定位根因 | 实际文件变更、summary、evidence |
| verifying / evaluate | runner 先验证受信文件并执行配置检查；独立 evaluator 将每条 criteria 对照行为与命令结果 | 每条 ID 恰好一次；自动通过需全部绑定检查成功并逐一引用 check:<id>，人工项 passed=null / MANUAL/PENDING |
| code_review / code_review | 可选：基于 baseCommit 与实际 diff 查回归、遗漏和边界；不重复设计讨论 | 具体 findings；重大问题回 builder 后重新验证 |
| handoff | runner 生成评估、测试手册、PR 包和 skill 建议 | awaiting_acceptance，等待人工操作 |

设计评审由 runner 对配置中的 reviewer 并行发起，结果独立保存，只有 planner 合并设计。不同 session 不等于不同模型；按实际配置说明。可关注不同角度，但不让每个 reviewer 只检查局部而漏掉致命问题。

修复达到配置上限后保留 blocked 和日志，重新检查架构/需求；不要无穷重复“再检查一遍”。检查须覆盖本次需求：通用 typecheck 通过不能证明 API、UI 或行为正确。无法覆盖的标准应明确失败或待验证。

plan/revise 必须保留原始 criteria 的描述及 checks/manual 绑定；新增标准也须绑定已配置检查或明确人工验收。受信文件基于 baseCommit 或操作员 sha256 固定，agent、setup、checks 执行前后及交付时重验；失败不能重建快照绕过。旧 run 缺绑定/可信快照时需明确报告迁移缺项，不把 resume 当作自动迁移。

纯 skill 是 agent 的操作指引，不能保证终端退出后的执行、进程恢复、并发互斥或定时调度；这些能力来自现有 worker。新 skill 的有效性需通过真实任务评估，格式校验不是模型效果验证。
