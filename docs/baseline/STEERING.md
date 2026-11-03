# Steering v2.1 规范与验证索引（0.5.0）

版本：v3.2；更新：2026-11-04。

当前规范为 [本轮 DESIGN v1.3 / A1–A10](../oneshot/runs/20261104-0553-steering-v21/DESIGN.md)，实现和命令结果见 [本轮索引](../oneshot/runs/20261104-0553-steering-v21/README.md)，安装与完整边界见 [独立包 README](../../external-plugins/steering/README.md)。

Steering 只跟踪本进程最近明确普通或摘要 transform 后观察到的有效 user 输入。工具 gate 无历史读取；已知普通请求有 pending 时拒绝普通工具，status/native prt_ 豁免。每次 transform 同步消费全部 pending，仅本次包含有效同 ID 用户的普通请求加一次提醒；缺席或 overflow 换 ID 丢弃。压缩清空此前 pending 并关闭 gate，摘要不加提醒；摘要 transform 后的新插话仍观察，供后续普通请求消费或 idle 时有条件恢复。歧义 transform 失效全部关联，未知放行。消息/附件不复制改写，后置插件可改变共享输出，故 G1/G3 仅针对本 hook 检查点；需加载在变换用户消息插件之后。

只有 status-idle 摘取候选，延迟75ms 后单次 history 验证最新有效 user 属于候选且在最后一个 assistant（含 summary，须成功且不跳过失败/未完成者）的 parentID 用户之后；不比较 ID 大小。status/get 检查 idle/revert，自家 synthetic control 保存前复核许可；每次 await 核对 identity。新输入/transform/第二次 status-idle/错误/删除/revert/压缩失效，候选 part 更新也在 active 已删除后失效恢复；无关消息/part 删除同样保守放弃，失败或晚保存不重试。无插话及 autoResume:false 不读历史；正常请求/工具不因历史故障阻塞。

G2 保存的控制仅含原指导 ID 和简短的重新读取并继续要求。首个明确普通 transform 先捕获现有恢复候选，再同步失效许可，结合 active.pending 按有效 user ID 匹配后仅对本次输出附加 G3。该检查点消费全部候选，缺席或编辑无效的指导也在此消费。后续工具轮 G3 为零，取消或过期候选无法继承提示，摘要请求继续仅消费候选。

provider/adopted unknown；toast 尽力；活动 noReply 须 autoResume:false。内存随活动请求和期间输入增长，无拒绝输入的固定容量；idle/error 等清理，permit 5秒到期；按会话关联的本进程签发 key 记录在派发30秒后回收，只有其失效控制可拒绝，未知/过期/跨会话 key 与仅公开 metadata 标记按不确定放行。不提供永不漏拦、原子取消、运行中工具中止或回滚、运行中子代理转发、独立 follow-up queue、batch/StructuredOutput/native prt_ 覆盖或语义采纳保证。慢保存/过滤/编辑/压缩/重启/后置插件均可能漏拦。

v2.0 的指纹保存确认、摘要覆盖/overflow replay 关联、每轮提醒、未知证据持续阻断与硬容量全部放弃。根测试包含真实官方确定性内核；installed verify 从空cache离线安装后跑新契约。真实 headless/TUI 暂扣响应对照与 natural TUI 不暂扣对照分别留证，两边自然采纳时如实报告。

变更记录 2026-11-04，v3.2 同步 DESIGN v1.3 的 G2 控制与临时 G3 单次注入，官方 provider 验证一次后归零。v3.1 记录 DESIGN v1.2 的摘要忙碌观察、summary parent边界、恢复期间编辑失效及短期会话关联签发key。v3.0 对应 Steering v2.1/0.5.0；以下均为历史说明，不作为当前行为承诺。

---

## 历史：Steering v2.0 / 0.4.0（已被 v2.1 替代）

# Steering v2 规范与验证索引（0.4.0）

版本：v2.3；更新：2026-11-04。

当前规范是 [本轮 DESIGN v1.4 / A1–A10](../oneshot/runs/20261104-0426-steering-v2/DESIGN.md)。实现、验收命令、结果与真实模型/TUI 证据见 [本轮索引](../oneshot/runs/20261104-0426-steering-v2/README.md)；安装与限制见 [独立包 README](../../external-plugins/steering/README.md)。

当前独立包使用公开 1.3.17 Hooks/SDK，进程内观察普通活动输入，绑定 assistant 请求快照，拦截所有未过 gate 的旧普通工具，附加最新优先提醒，并在成功 idle 后最多一次/指导版本恢复晚保存输入。原始消息/附件不变，控制只引用 ID。取消/错误/删除/压缩/revert、新输入和正常准备使 permit 失效；provider/adopted 始终 unknown。

native SubtaskPart 与未知 task 安全豁免；已确认 callID 的模型 task 正常 gate。已过 gate 的工具、batch 内部、StructuredOutput、运行中子代理转发、紧急中止和独立 follow-up queue 不提供保证。取消与派发不是原子；idle cancel 没专用事件；未完成的 revert 或最终检查后的取消仍可能竞态。活动 noReply 用户应关闭 autoResume。重启不重放旧 pending。

变更记录：2026-11-04，v2.0 用 A1–A10 与新包取代默认 ledger；下面原规范及其证据保留历史身份。

---

## 历史：v0.3 及更早规范（不作为 v2 当前实现声明）

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

### Steering v2 round 2 修复（2026-11-04）

按 run DESIGN v1.3 修复：仅 info/空 parts/长时间历史缺席不清退已观察候选，保留原预期 part 指纹及后续保存确认能力，无法确认时在 status 给出未知/人工检查诊断；不再按 1.5 秒年龄删除。所有并发 gate 等待同一 in-flight history，fallback 标记不再让普通 task 提前套用 native 豁免。

压缩开始标记由 summary transform 消费，完成事件清除而非重新置位；记录本次 summary 实际包含的指导版本，仅成功后标 compacted，保持与普通 prepared 分离。后续包含对应 summary 的请求可获得该覆盖；后到/编辑版本与失败 summary 不继承退役。成功终止且 idle 时释放 settled/compacted 证据和无用快照，保留 pending/unknown；256 上限约束未解决输入，不再限制整个会话普通输入总数。聚合入口原样转交第二参数（含 autoResume:false），扩展注册和 worker 行为不变。

变更记录：2026-11-04，第二轮实现及回归；[本 run 索引](../oneshot/runs/20261104-0426-steering-v2/README.md) 保存结果，旧轮报告/原始评审证据不改写。本轮未重新运行真实模型演示，正式全量验证由宿主执行。

### Steering v2 round 3 / DESIGN v1.4（2026-11-04）

连续摘要只在输入包含旧 covering summary 且当前内容版本未变时继承覆盖，成功后替换为新 summaryID；失败/未包含/编辑/晚到版本不继承，不建无限 lineage graph。摘要请求、覆盖摘要后的普通请求及 native replay 请求均带静态最新优先/保留完成结果/报告跳过动作提示；安全 idle 后仅保留一个最新 summary 提示标记，不宣称摘要语义完整。

overflow replay 使用当前压缩窗口、公开 auto/overflow trigger、成功 summary、相邻 native 新 ID、严格内容及 model/agent/system/variant/format/tools 对照，只在真实请求包含完整匹配的 replay 时将原指导版本绑定为 prepared。新真实输入/取消失败/新压缩/首次后续请求关闭窗口；不把任意同文历史当原指导。text/plain 及生成文本保持；image/*、application/pdf 按固定源码转换为 Attached 占位文本，原媒体不在 replay 请求中。status 的 replayedAs/mediaStripped 明确此区别，不重注大附件。

新候选的 info-only/慢保存继续保守保留；已保存输入经公开编辑及当前历史校准为空白/ignored/synthetic 后不阻断或恢复，观察仍保留时改回有效内容重新 gate。取消/失败会话只有明确 idle 且无 running/permit 才清理，active 或未确认边界保留安全容量上限。独立包 exact public plugin dev/peer 仍为 1.3.17，peer optional 表示类型/host API 约束；单文件 runtime 依赖继续内嵌，packaging 使用全新空 npm cache 真实离线安装并检查 peer 未安装。

变更记录：2026-11-04，第三轮六项采纳修复与客观回归；完整正式 verify（含真实 headless/TUI）由宿主执行，旧轮评审/证据不改写。
