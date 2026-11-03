# 需求：OpenCode 1.0（v1.3.17）外置插件「插话 steering」v2

## 用户故事
agent 执行一个多步任务的过程中，用户可以随时插入新指令或纠偏（例如"别改 A 了，改 B"、"换成用 pnpm"），
agent 在合适时机吸收插话并调整方向——工具调用间隙、下一轮 LLM 调用前——而不需要用户中断（Esc）后重来。

## 硬约束
1. 外置插件优先：放在 `external-plugins/steering/`（独立包：自己的 src/、test/、package.json、构建脚本），只使用 `@opencode-ai/plugin@1.3.17` 公开 hook 与 SDK client；不得 import `agent-kernel/` 私有模块或 `agent-kernel-extension/`。确需改内核时必须在 design 中写明理由并单独评审（默认不改）。
2. 内核是 `agent-kernel/`（OpenCode v1.3.17，commit 517e6c9aa，只读参考，禁止修改）。官方 1.3.17 二进制：`~/.local/opencode-1.3.17/opencode`。
3. 旧实现 `external-plugins/src/steering.ts`、`external-plugins/src/steering/ledger.ts`（596 行 ledger）质量问题已审计（见 `docs/review/legacy-codex-audit.md` 的 L-08/L-09/L-10 及第 3 节），本次重写。旧 `test/steering/plugin.test.mjs` 里的行为契约可作为参考用例来源，但不要照搬其复杂度。
4. 遵守仓库 AGENTS.md 的编码准则（简单优先、外科手术式修改、目标驱动验证）。

## Brainstorm 必须先做的调研（结论写入 BRAINSTORM.md，带源码路径:行号）
对比以下四个实现的 steering / 消息队列 / 中断机制，并与 OpenCode 1.3.17 原生能力对照，择优设计：
- OpenCode 2.0：`/Users/penghao/Documents/code/CodingAgent/opencode/opencode`（SQL inbox、steer/queue 优先级等）
- pi：`/Users/penghao/Documents/code/CodingAgent/pi/pi`（steering 与 follow-up 两个队列及领取时机）
- DSH：`/Users/penghao/Documents/code/CodingAgent/DSH/deepseek-harness`（next-step / next-turn inbox）
- Codex：`/Users/penghao/Documents/code/CodingAgent/codex/codex`（active turn 中 steer 输入、expected turn、注入时机、中断）
- OpenCode 1.3.17 原生：`agent-kernel/packages/opencode/src/session/prompt.ts`（loop 每步重读消息；新用户消息被 `<system-reminder>` 包裹；`Runner.ensureRunning` 在运行中会 join 已有运行）、`effect/runner.ts`、TUI 的 QUEUED 标签、`plugin/index.ts` 的 hook 触发方式。
旧对照文档 `docs/baseline/STEERING-SOURCE-COMPARISON-20261028.md` 可参考，但其 Codex "steer_input 验证取消" 一条已被审计指出不准确，需重新核实。

## 已知的 1.3.17 原生缺口（供 brainstorm 核实与取舍，不是既定方案）
- G1 工具间隙：同一步 LLM 输出的多个工具调用（或模型尚未看到插话时已决定的调用）在插话后仍会继续执行，可能产生已被用户否定的副作用。
- G2 完成边界竞态：插话恰好在 loop 最后一次读消息之后、运行结束之前保存时，`ensureRunning` join 已结束中的运行，插话被"孤立"，直到用户下次发消息才处理。
- G3 吸收提示：原生包裹语是通用的 "Please address this message and continue with your tasks."，没有明确"以最新插话为准、哪些旧动作被跳过"。
- G4 用户反馈：TUI 只显示 QUEUED，用户不知道插话是否/何时被吸收。（`client.tui.showToast` 等公开 API 可用性需核实）
- G5 子代理：父会话正在执行 `task` 子代理时，插话要等子代理结束才被看到。
- G6 长时间运行的单个工具（如 sleep 600 的 bash）期间插话无法生效；是否提供"紧急插话 = 中止当前工具但保留会话并立即带着插话继续"由设计决定。
- G7 steer（立即注入）与 queue/follow-up（本轮结束后再处理）是否需要区分。
设计需给出每个缺口：做/不做/部分做 + 理由；MVP 至少覆盖 G1、G2、G3，并对用户可见行为负责。

## 验收标准（design 中细化为带 ID 的可验证条目）
- 类型检查、构建（产出可被 OpenCode 加载的单文件 JS 插件）、单元测试、**集成测试**全部通过，并接入根 `package.json` 的 test 脚本或文档写明命令。
- 集成测试必须真实启动 OpenCode（官方 1.3.17 二进制或 agent-kernel 源码）+ 插件，用**脚本化的假模型**（本地 OpenAI 兼容 HTTP 服务，按脚本返回 tool_calls/文本，可做到一次返回多个 tool_calls）做确定性测试：覆盖 G1/G2/G3 的行为，以及"无插话时行为不变"。不依赖真实模型、不花钱、可在 CI 跑。
- 端到端演示（可复现脚本 + 留档）：实际启动 opencode，用真实模型执行多步任务，运行中插话，能看到 agent 吸收插话并改变行为（例如原计划创建 step1..step5，插话后停止并改为写 SUMMARY），附运行日志；另做一个 TUI 版演示（tmux 驱动真实 TUI，`tmux capture-pane` 抓屏存档）。同条件下关闭插件做对照。
  - 真实模型通道：本机 OpenCode Zen 免费模型均 429 限流；可用的是已登录的 Codex CLI（`/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`）。仓库已有 `scripts/lib/codex-cli-bridge.mjs`（把 codex exec 包装成 OpenAI 兼容 chat completions，目前一次只返回一个工具调用；可扩展为支持多个），作为演示的模型桥接测试设施使用。
- 文档：插件 README（安装/配置/用法/限制）；按仓库约定同步 `docs/baseline/STEERING.md`（版本号 + 变更记录）及 `docs/baseline/SPEC.md`、`docs/baseline/DESIGN.md` 中 steering 相关段落。
- 旧 steering 实现与只服务旧实现的脚本/测试在新实现验收通过后移除或标注，处理方式写入 design。

## 环境
- node v24、bun 1.3.11（`~/.bun/bin/bun`）、tmux（`/opt/homebrew/bin/tmux`）、codex CLI（见上）。macOS 无 `timeout` 命令。
- OpenCode 运行时用隔离的 XDG_* 目录，不要污染用户 `~/.local/share/opencode`。

