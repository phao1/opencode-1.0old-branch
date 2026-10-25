---
name: one-shot
description: 将明确的外置插件开发需求交给持久化 one-shot worker，完成设计、并行改进、实现、验证和交付；也用于查询、恢复或取消已有任务。
---

# One-shot

先读 `AGENTS.md`、`docs/baseline/SPEC.md`，确认当前 checkout 是有 `external-plugins/` 的开发仓库。内核固定在仓库记录的 commit；不要把参考仓库当作目标仓库。

## 明确需求并启动

1. 从用户请求提取目标、当前行为、期望行为、非目标和可观察的验收标准。普通实现选择由 agent 决定；只有会改变产品目标或无法从代码确认的关键缺口才问用户。分析和资料收集不自动变成开发授权。
2. 使用 `create-issue` skill 的规则整理输入。每条标准有稳定 ID，并绑定能验证该行为的 `checks: [配置检查ID]`，确实需要操作员判断时用 `manual: true`；原始描述及绑定不可在设计修订时删减或降级。候选可以不完整，但空标准、缺绑定或未知检查不能入队。同源内容变化会报冲突：先查看旧需求，再显式更新未入队 candidate，已有关联 run 的需求不覆盖。用 `one_shot_issue` 创建候选；已有 issue/run 或 `--from-triage` 时先用 `one_shot_status` 找到唯一匹配，禁止猜 ID。
3. 入队前检查模型、worker、allowedPaths、protectedPaths、trustedFiles、checks 和 baseRef。仓内受信入口须存在于 base commit，外部检查/适配器须显式固定 sha256；动态导入和检查辅助文件也需纳入受信范围。默认保护 skill/脚本，不修改受信检查来让任务通过；维护这些文件时由操作员显式配置范围。队列从 Git commit 创建工作目录，不携带未提交的 skills/代码。配置缺失时按 `docs/plugin-guide.md` 给出缺项，不暗中修改权限或安装后台服务。
4. 用户已明确要求实现时，调用 `one_shot_start`，返回 run ID；重复启动复用已有 run。执行由独立 worker 负责，本会话不再并行实现同一 issue。

## 执行与交付

worker 的阶段契约见 [references/stages.md](references/stages.md)。只有调试或解释阶段行为时才读取；不要在对话中手动伪造阶段状态。实际插件开发由 `external-plugin-dev` skill 指导。

- 查询：`one_shot_status`；报告实际 phase、错误、workspace 和证据位置。queued 仅表示已排队，不表示后台进程存活。
- 停止：用户要求时用 `one_shot_cancel`。恢复使用文档中的 CLI resume；先解释失败原因，不重复新建 issue 来绕过预算。
- blocked：给出失败检查、缺少能力或凭据以及恢复入口，不把 reviewer 不可用当作赞成。
- awaiting_acceptance：汇总实际变更、逐条标准的绑定检查和证据、MANUAL/PENDING 条目、未验证项、TEST-MANUAL 和 PR URL；人工条目不能称为自动 PASS。未发布时交付本地 PR.md，不声称已有 PR。
- 人工验收通过后，只有操作员明确执行 accept 才记录 accepted。不得擅自合并或发布。

需要理解本项目对参考方法的取舍时，读 [references/sources.md](references/sources.md)。不将 token 消耗、代码行数、固定四模型或五并发作为质量指标。
