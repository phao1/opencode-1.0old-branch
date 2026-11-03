# Generator 修复指令 — review round 2

按 DESIGN v1.3 实施唯一采纳P2：不要把完整G3 reminder持久化进G2 synthetic continuation。控制仅引用原指导ID并要求重新读取继续；首个恢复普通transform以现有恢复候选pending做一次性有效ID匹配、临时加G3、同步消费，不引入历史状态。保留全部取消/编辑/许可/摘要安全规则，不改内核、skill、其他run，不提交。

先补回归证明当前失败：单测和原普通/摘要官方G2正例，在保存控制中找不到完整reminder，首次恢复请求恰1次，下一工具轮0次；保持原开关正例和后续普通消息/工具可用。确保总有效生产行≤200。同步包README、baseline三文档的当前版本链接/一次性G3语义，历史证据不改写。DESIGN由宿主更新，不修改。Generator报告另写 implementation-details.md 并从 report.md 链接，避免大小写同名覆盖。

执行相关单测、官方确定性内核、类型/根回归/安装验证与diff检查；三组真实模型演示留宿主正式verify，不自行重跑。不做额外评审。报告给出失败→通过证据和有效行数。
