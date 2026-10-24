# Steering 0.3.2 交付与验收

## 2026-10-24 本机复验

从远端 `dev1024` 的 `b134339f551506457c4cc693b0042b2442a0f180` 拉取并复验。发现并修复 Undo 后已删除历史永久阻断后续工具的问题；新增六项删除生命周期回归测试、真实内核 Undo/DELETE 场景。修复验证脚本生成探针时的换行转义错误，以及对并行工具完成顺序的错误假设。固定内核 tracked 文件保持干净。

- 当前独立包：[oneshot-opencode-steering-0.3.2.tgz](../../dist/oneshot-opencode-steering-0.3.2.tgz)
- SHA256：`3e02dfecb7bd66bdd95b5f6d0209e70d04aeb02f70ca89510f42769520fb282b`。
- `npm test`：63/63 通过；`npm run typecheck`、`npm run check:kernel`、`git diff --check` 通过。
- `node scripts/verify-steering.mjs --use-package-report`：19/19 场景通过，ST-01..07 均通过；包含真实 Codex 模型改向、完成边界恢复及独立安装包加载。完整报告：`.codeagent/steering-verification-RVEC5v/report.json`。
- 固定版本 Web app 实际浏览器操作：同一会话连续两次插话，旧工具被阻止，仅执行最终目标；Undo 后新任务工具正常执行；插话后点击原生“停止”，保持取消且没有自动复活。真实 provider 请求、工具动作、ledger 状态与截图分别留证：`.codeagent/steering-web-fDFGU5/web-verification.json`。
- 便携汇总：[steering-2026-10-24.json](evidence/steering-2026-10-24.json)。新增 `npm run debug:steering` 用于重现本地 Web 调试环境。

当前 Web 调试地址为 `http://127.0.0.1:4318`，仅本机可访问。固定前端第一次打开项目出现过 `Cannot read properties of undefined (reading 'worktree')`；点击“重启”后恢复并完成上述操作，未修改内核前端。TUI、复杂媒体压缩未在本次进行交互验证；已有 HTTP 证据与 Web 体验分别记录。

本次没有重跑 ST-08 的完整开发编排，也不代替操作员的最终 accept。仅提交源码、测试与报告到用户指定分支，不创建远端 PR、不发布包或 release。

## 0.3.1 历史交付记录

开发及自动验收完成。原 ST-01..07 全通过，ST-08 的实际 one-shot 编排已完成设计、并行改进、实现、验证、独立评估、两路代码评审与 handoff。Run 当前为 `awaiting_acceptance`，等待人工体验；尚未记录人工 accept。

## 安装包

- 历史独立包：`dist/oneshot-opencode-steering-0.3.1.tgz`（当前安装请使用上面的 0.3.2）
- SHA256：`6bf16ee3198a23532848b5108d83d7f30d981b139f26b23405e9b8ec00b1a4d6`
- [安装、使用及卸载说明](../../external-plugins/steering/README.md)
- [最终变更说明](STEERING-PR.md)；[逐条证据](evidence/steering-final.json)

包只含 README、manifest 和独立 JS，运行无需 one-shot worker 或原开发仓库。已在干净目录离线安装并由真实固定内核加载；另用系统 tar 解包验证得到相同 bundle。源码与验证过的精确包已同步主目录，完整原始证据保留。

本仓库的组合插件入口已经包含 steering；在其他项目独立安装时可选择 README 的 npm 方式，也可直接解包（无需 Node 安装器）：

```sh
mkdir -p "$HOME/.local/share/opencode-steering"
tar -xzf "/Users/penghao/Documents/opc/oneshot/oneshotcode/opencode-1.0old-branch/dist/oneshot-opencode-steering-0.3.1.tgz" -C "$HOME/.local/share/opencode-steering" --strip-components=1
```

然后在目标项目或用户 OpenCode 配置中添加 `$HOME/.local/share/opencode-steering/dist/index.js` 的实际绝对路径并重启。组合入口与独立包选一种加载，避免重复注册。

## 使用与结果

任务运行中，在同一会话直接输入修正，也可写 `steer: 保留已完成的工作，接下来改用新的目标`。未经过公开检查点的旧工具会被阻止，后续请求读取原指导并继续。成功结束但仍有符合条件的未处理指导时，会追加一个明确标记的 synthetic 控制记录来续跑，原用户消息与附件保持。

`steering_status` 区分保存确认、上下文准备、provider 收到与模型采纳；后两者在没有独立证据时保持 unknown。HTTP 请求被确认不等于模型已收到。

最终 7 项可信检查全部退出 0，57 项测试通过，其中 steering 组件 35 项；17 个实际固定内核场景通过。两个真实模型场景共 5 次独立 CLI 调用，分别证明旧动作被阻止后改向，以及 StructuredOutput 结束后收到指导并输出修订结果。模型收到的是实际 provider 消息、工具与 tool_choice。

两路独立代码评审发现并阻止了原生 `/review` 回归，修复后重新验证：原生命令及已处理历史可正常完成，未处理指导和普通模型旧 task 仍会被阻止。最终两路评审 findings 均为空。

## 能力边界与人工体验

公开 API 没有 Codex 的原子 turn 接收与取消/续跑事务；已通过检查点的工具、batch 内部调用及已启动子任务不能撤销。恢复有次数限制，未知结果不重试，重启不自动派发旧 pending。原生 subtask 与未处理真实 text/file 混合时保守拒绝，可能留下原生 running ToolPart，不能宣称这一分支能自动续跑。复杂媒体压缩和交互式 TUI 人工体验尚未完成。

请按 [人工体验清单](STEERING-TEST-MANUAL.md) 检查运行中插话、停止、状态查询及 `/review`。原始 TEST-MANUAL.md 也保留在 run artifacts。详细机制见 [STEERING-RECOVERY.md](STEERING-RECOVERY.md) 和 [STEERING-FEASIBILITY.md](STEERING-FEASIBILITY.md)。

## 实际工作流

Run：`run-09f76aad-178e-46c0-9eb6-3a7267a608d8`；状态：`awaiting_acceptance`。
原始 handoff：`/Users/penghao/Documents/opc/oneshot/oneshotcode/opencode-1.0old-branch/.codeagent/one-shot-steering/artifacts/run-09f76aad-178e-46c0-9eb6-3a7267a608d8`。
本次使用持久 runner 与实际桌面子 agent 的 AgentExecutor 完成，阶段错误、旧失败报告与修复过程保留。最终源码指纹检查及 handoff 均由原 runner 执行。固定内核 tracked 文件保持干净，没有推送、发布或合并。
