# Codex 用户入口验收

2026-10-28，新增可双击的“使用Codex模型启动.command”，原普通入口保持原模型配置。原固定内核和插件文件未改，新增入口通过临时公开 provider 配置启用本机 CLI 桥接。

- 新包：`OpenCode-Real-Package-20261028/CodeAgent-OpenCode-Mac-arm64-Codex.zip`。
- SHA256：`71c9cef388e14da70727e70e25fc825f711bf59d3a2fbab9b046eaf07ca3cec4`。
- 从新 ZIP 的中文/空格解压路径，执行包内同一双击入口，PATH 仅含系统目录，由入口自动发现已有 Node 和 Codex CLI。
- 实际 TUI 选择 local-codex/codex-cli-default，完成真实文字回答、原生 bash 写文件与 steering_status 调用，共 4 次真实 CLI 模型请求，4 次成功、0 次失败。
- 退出后，本地接口已关闭、活跃 CLI 请求为 0，本次临时请求目录全部删除。
- 4 项组件测试（明确使用组件 backend，不算真实模型）、完整默认回归 88/88 通过；固定内核检查与 diff 检查通过。
- 没有复制登录文件、修改全局 provider 配置或发布。使用已有 Codex 账号的正常用量；确切模型型号未由事件暴露，使用 CLI 默认模型。
- 独立 PTY 观察，不冒充已通过 Finder 鼠标双击 GUI 验收。文字与顺序工具桥接的其他范围见 Codex 模型入口说明。

原始证据：`.codeagent/codex-user-entry-20261028/real-entry-report.json`、`real-entry/messages.json`、`real-entry/bridge.json`、`real-entry/tui.ansi`、`component-tests-final.log`、`regression.log`。

复现脚本：`scripts/verify-codex-user-entry.mjs`。该验证会实际使用登录账号的模型用量。
