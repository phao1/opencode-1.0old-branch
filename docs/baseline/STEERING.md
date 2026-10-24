# Steering 行为与可行性验收

日期：2026-10-23。目标内核：`517e6c9aa4c61dbc125e7654fc596f1d529f20d9`（v1.3.17）。

本文取代 SPEC/DESIGN 中以提示词包装为验收目标的 steering v0.1 条目。用户要求的是运行中引导当前任务；单纯增加提醒文案不满足要求。原有 v0.1 保留为待替换的历史实现，不能作为完成证据。

## 必须验收的用户行为

| ID | 行为与证据 |
| --- | --- |
| ST-01 | 用户可在任务执行中提交修正，保留会话、已有消息、附件和完成的工作；真实内核记录接收的消息，不能重复提交、另开任务或 abort 后重放。 |
| ST-02 | 引导在下一次可用的模型调用中进入上下文；验收必须检查实际 provider 请求及模型输出，不能仅断言字符串被包装。已在执行的工具允许完成，不承诺回滚。 |
| ST-03 | 尚未通过插件工具执行检查点的旧计划工具，在有未送入模型的引导时不得开始副作用；真实工具探针证明被阻止，并验证后续模型获得新指令后能继续工作。已经通过检查点的工具存在无法撤销的边界，须明确说明。 |
| ST-04 | 多次引导不丢失，顺序有明确依据；其他会话不受影响。空输入、重复观察、重启、取消、失败和任务结束竞态有明确行为及证据。 |
| ST-05 | 区分已保存、已进入模型请求、模型实际采纳；不把 busy 快照、hook 调用或请求发送称为模型已遵循。提供可查询的消息级证据，未知状态明确标识。 |
| ST-06 | 输入保留用户权限；普通输入中的 shell/file 标记不执行命令或扩展文件。插件不导入内核私有模块，不修改固定内核原生文件。 |
| ST-07 | 插件可独立构建为 tgz，在干净目录安装，并由真实固定内核加载；包中不依赖原开发仓库路径或 one-shot worker。 |
| ST-08 | 用真实模型的 one-shot run 完成设计、并行独立评审、实现、检查、独立评估，产出逐条证据及本地交付文档。编排 fixture 测试不能替代该 run。 |

## 必须明确告知的能力边界

- Codex 的 `expected_turn_id` 检查与接收在活动 turn 锁内执行。固定内核公开 `chat.message`、`session.status` 和 `session.prompt` 没有这个原子操作；外置插件不得宣称提供同等保证。结束边界可能按内核规则形成下一轮，不能承诺严格拒收失效 turn。
- 没有公开接口能够强制正在进行的 provider 请求读取后到的消息；生效点只能是后续模型请求。
- Pi 的 follow-up 队列和新版 OpenCode 的持久化 inbox 是参考机制；本目标并未自动扩展为完整复制这些产品。若设计需要它们而公开 API 不足，必须记录缺口，不能用文本前缀伪装调度语义。
- “已进入模型请求”不等于模型一定遵从；真实模型验收和可重复协议探针分别提供质量及调度证据。

## 公开 API 证据（待运行验证）

| 能力 | 固定内核调用链 | 当前结论 |
| --- | --- | --- |
| 接收与持久化 | `session/prompt.ts:createUserMessage` → `chat.message` → 保存 message/parts | hook 在持久化之前，不能在此时报告已保存。 |
| 活动循环复用 | `session/prompt.ts:loop` → `effect/runner.ts:ensureRunning` | 运行中 prompt 复用活动循环；需覆盖结束竞态。 |
| 下一轮上下文 | `runLoop` 重新读取持久化消息 → `experimental.chat.messages.transform` → `toModelMessages` → processor | 可观察/调整下一轮上下文；transform 早于 provider 调用，不能报告已发送。 |
| 工具副作用检查点 | `resolveTools` → `tool.execute.before` → 工具 execute | hook 抛错发生在工具 execute 前；processor 对普通 tool-error 不设置权限拒绝 blocked，可能允许下一轮，待真实验证。 |
| 状态与证据查询 | SDK `session.messages/message/status`，公开 `event` hook | 可用于核对持久化和生命周期；事件回调未被 loader await，不能依赖其构建原子接收。 |

## 运行记录

- 2026-10-23：确认本机 Codex CLI 可执行且已登录；未输出或复制凭据。旧 smoke 混用了宿主配置，新的验证需隔离 XDG、测试 home 和项目配置。
- 2026-10-23：用正式 npm registry 在隔离配置目录安装公开 `@opencode-ai/plugin@1.3.17` 成功，退出码 0；不修改 kernel 源文件或制造 package-lock 来跳过依赖安装。

### 已通过的真实内核协议探针

命令：`node scripts/probe-steering-api.mjs`（需可用 Bun）。`test/steering/fixtures/public-api-probe.ts` 是可行性探针，不是产品插件。证据在 `.codeagent/steering-api-svyKjT/`：report、完整 provider 请求、保存消息及工具事件。

- 两组都加载真实固定内核，经公开 HTTP prompt_async 提交两条用户消息。测试 provider 延迟首次响应，确保插话先持久化，再返回旧工具调用。
- baseline：工具执行顺序为 old → revised。仅让下一轮读到消息不能阻止旧请求的后续工具。
- gate：公开 tool.execute.before 查询已保存用户消息，与 messages.transform 的上下文集合比较，抛普通错误阻止旧动作；实际执行仅 revised。下一次 provider 请求含修正，tool-error 没有终止整个任务。两组都只有两条用户消息、三次 provider 请求。
- 这是确定性协议验证，不是真实模型质量验收，也尚未覆盖关闭竞态、重启、压缩、权限及生产插件。
- `node scripts/smoke-one-shot.mjs` 已通过真实插件入口加载、四个 one-shot 工具注册、普通/显式文本持久化、删除会话。日志在 `.codeagent/kernel-lab-scG4WE/kernel.log`。修复通过隔离配置及正式依赖安装完成，没有修改内核。
- Codex CLI 默认模型连通检查及 one-shot JSON 适配器检查均通过。后续阶段使用独立 session、同一默认模型，不能称为多模型评审。CLI 遇到 WebSocket TLS EOF 后自动回退成功，保留事件日志。
