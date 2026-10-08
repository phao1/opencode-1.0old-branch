# One-shot 自动化开发框架 Spec v0.5

更新：2026-10-08。本版取代 v0.3 的具体跨会话产品需求。

## 目标与范围

用于在固定 OpenCode 1.3.17 内核上自动开发外置插件。完整链路：监控/反馈 → 分析与候选 issue → todo → 设计 → 并行设计评审 → 实现 → 独立验收 → 可选代码评审/修复 → PR → 人工验收。

跨会话消息、Unix socket、棋局等是被开发需求的案例，本框架不实现这些产品功能。保留其工程教训：外部材料不能授予权限；失败必须真实报告；状态可恢复；循环、并发与资源必须有界。

## 验收要求

| ID | 框架必须提供的行为 |
| --- | --- |
| F01 | 手工/结构化反馈/文件信号/Claude Code 与 Codex release 可进入统一候选队列，包含来源、证据和去重键；定时 loop 可恢复，失败不会推进游标。 |
| F02 | release 记录 changelog、版本和可获得的 GitHub compare 证据；生成分析报告及候选需求。获取不到代码明确记录，支持外部分析/benchmark 命令接口。 |
| F03 | 候选 issue 支持本地管理与 GitHub todo label 拉取；只有明确配置的可信 issue 作者/标记者可自动触发。重复投递不重复启动。支持 from-triage ID。 |
| F04 | todo 自动入队；持久化阶段、尝试、决策、错误、用量、工作目录、分支和产物。停止、恢复、取消、失败重试有明确状态；单机多进程不得同时执行同一任务。 |
| F05 | 隔离 Git 工作目录，配置并发上限；保留目录以便恢复和诊断。固定内核 commit，发现原生内核修改或超出允许路径时阻断交付。 |
| F06 | Planner 保存需求分析、设计、边界条件、实施计划、可验证验收标准；并行独立设计评审，合并意见并修改设计后才编码。 |
| F07 | Builder、Reviewer、Evaluator 独立调用/会话；评审 fanout 可配置，支持不同模型/命令适配器及故障 fallback。不可把不可用 reviewer 算作通过。 |
| F08 | 必需的真实命令检查 + 独立 Evaluator 按每条标准提供 pass/fail 和证据。Web 可配置 Playwright，API/DB/CLI 可配置实际验证命令；不凭模型自评或截图放行。 |
| F09 | 有限次修复后重新跑检查与验收；可选并行代码评审。反复失败转 blocked，并提示重新审视架构；保存评估 prompt 版本与反馈记录。 |
| F10 | 输出 DESIGN、评审、命令日志、验收报告、测试手册、PR 正文、可复用 skill 建议。可配置通过 git/gh 提交分支和 draft PR，失败重试不重复建 PR；合入和最终验收由人决定。 |
| F11 | 插件工具和 /one-shot、/create-issue 提供实际操作入口；独立 CLI/worker 执行持续任务。终端关闭后的持续执行由用户的服务管理器承载。 |
| F12 | 时间/调用次数/重试/输出大小/并发有上限；token/cost 以适配器实际返回为准，未知不伪报。无凭据时保留 blocked 原因和可复查产物。 |
| F13 | Codex、Pi、OpenCode 源码仓可独立于 Release 定时扫描。固定 ref，记录 base/head commit，保存 Git 缓存、diff、变更文件内容与永久链接；分析成功后才推进游标。文件/字节上限、遗漏、二进制、历史缺失必须明确记录。外部源码不执行、不自动授权开发。 |
| F14 | PR/dev 的 GitHub Actions 在 Windows 构建 CLI exe 测试包，包括外置插件、命令/skill、独立 worker、配置示例、启动脚本与版本/校验清单。临时内核 checkout 承载原生构建生成文件，不改工作区内核。上传 Actions Artifact 供人工测试，不自动发布 Release。构建失败不得声称产物可下载。 |

## 源码输入与测试交付

源码来源：openai/codex（main）、earendil-works/pi（main）、anomalyco/opencode（dev）。上游 OpenCode 是观察对象，agent-kernel 仍固定原 baseline，源码发现不会自动升级内核。首次扫描分析 tip 与其父提交，后续分析上次成功 commit 到最新 tip 的差异。源码报告区分已证实实现、推断、与本项目公共插件 API 的适配障碍、许可证复用约束和验收建议。

测试产物为 portable ZIP，CLI exe 与插件分发包一起使用。exe 不等于 Desktop 安装器，也不代表外置插件/Node worker 已被嵌入内核。Actions artifact 有保留期限，正式长期归档到 Release 需人工选择已验收提交。PR 提交触发构建；仅保存在本地、未推送的 one-shot 运行不会自动出 GitHub 产物。

## 非固定参数

五并发、四评审、07:10、80% 设计时间都是案例参考。评审数量、调度、预算、修复次数可配置。模型改进后可调整评审轮次、prompt 和验收命令；可靠性不依赖隐式会话记忆。

## 状态与人工入口

候选 candidate → todo → queued → designing → design_review → implementing → verifying → code_review（可选）→ handoff → awaiting_acceptance → accepted。blocked/failed/cancelled 保存最后可恢复阶段。人工 reject 带原因回到修复与验收。外部材料不能自动修改配置、执行命令或把自己提升为 todo。

## 完成验证

- 真实临时 Git 仓库中，用确定性协议适配器执行全链路并检查真实文件、测试命令和 Git diff；此证据仅证明编排，不冒充真实模型质量。
- 独立调用、并行设计评审、缺少标准/证据拒绝、修复重验、失败恢复、重复触发、取消、只读内核、PR 重试有测试。
- 固定 OpenCode 内核启动后实际暴露 one-shot 工具；如无模型凭据，明确说明模型端到端尚未验证。
