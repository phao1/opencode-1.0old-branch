# 方法来源与本项目取舍

资料状态（2026-10-23）：以下两篇的正文由用户粘贴提供；在线读取 X 返回 403。没有获得作者完整 SKILL.md，不把本项目实现称为其原版。

- [2026.06 方法论](https://x.com/chenchengpro/status/2061114453345943921)：自动化 brainstorm → design → improve → impl；todo issue 驱动；日志/竞品/找 bug loop 产生 issue；用例、人工验收、完整设计和日志共同验收。
- [8 月升级帖](https://x.com/chenchengpro/status/2090725037548638547)：串行 improve×5 改为四个 agent 并行建议，然后实现及可选并行 review。原帖未说明具体合并协议；本项目由 planner 单写 design，是工程选择。

采用：详细且可验证的 issue、先保存设计再改进、独立评审、日志驱动修复、人工最终验收。普通决策自主推进，重要缺口才询问。

适配：现有 dev 已使用持久化 Git worktree，不为了复制作者的多目录习惯改写隔离机制；环境准备开销通过已配置 setup 管理。四个 agent、五并发、80% 设计时间、7:10 调度都是案例参数。多 CLI 必须通过已验证 adapter；未实现 adapter 不算已支持。

暂不推出：新增自动监控、付费账户配置、全局 skill 安装、自动发布/合并。用户要求的是研发 skills；现有 loop 只有明确配置后才运行。评论区工具推荐不属于作者的核心工作流。

后续参考 Pi / OpenCode 2.0 / Codex 时，使用 external-plugin-dev 的源码对照规则，记录本地路径和 commit。尚未 clone 或未提供的源码不可当作已验证依据。
