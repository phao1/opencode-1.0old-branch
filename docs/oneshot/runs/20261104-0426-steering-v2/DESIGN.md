# Steering v2 外置插件设计

版本：v1.1；更新日期：2026-11-04（Pacific/Auckland）

## 目标与范围

需求完整来源：本目录 REQUIREMENT.md；前期源码核对、默认假设见 BRAINSTORM.md。本设计必须足以让全新 Generator 独立实现。

在 OpenCode v1.3.17（只读 submodule `517e6c9aa`）上，用 `@opencode-ai/plugin@1.3.17` 公开 hooks 与 SDK 重写 steering。独立包 `external-plugins/steering/` 拥有自己的 src、test、package.json、构建与类型配置；单文件 dist/index.js 可直接由官方 `~/.local/opencode-1.3.17/opencode` 加载。保留唯一函数导出 SteeringPlugin，防止旧 loader 重复调用。聚合入口切换到新包；不改 kernel tracked 源码，不 import kernel 私有类型或 extension。

用户直接在运行中的会话输入纠偏；插件在尚未通过 gate 的工具入口阻断旧上下文，在下一请求明确“最新指导优先，保留已完成结果，报告跳过动作”，成功空闲后恢复本进程已观察但尚未准备的插话。不创建第二个消息库或复制用户消息。不提供独立队列命令、紧急中止或运行中子代理转发。

### 缺口裁决

| 缺口 | 范围 | 行为和边界 |
| --- | --- | --- |
| G1 工具间隙 | 部分做，MVP 必需 | 普通公开 before hook 尚未通过的旧上下文工具抛可识别 STEERING_STALE_CONTEXT，错误结果交给模型；同 assistant 所有后续 stale 调用都拦。已过 gate、batch 内部、StructuredOutput、native subtask 特殊路径不能承诺。 |
| G2 完成边界 | 做，有界、非原子 | 成功 idle 后核实仍有已保存未准备指导，最多一次/指导版本发 synthetic continuation，保留原指导。取消/错误/删除/压缩后不自动复活；重启不重放旧 pending。公开 API 无原子 cancel+dispatch，剩余竞态明确记录。 |
| G3 吸收提示 | 做 | 仅在请求副本加入明确 steering reminder（最新指导优先、保留已完成动作、跳过旧工具原因）；原始文本/附件不变。不宣称语义采纳。 |
| G4 用户反馈 | 做最小提示 | showToast 尽力提示插话已观察/准备/跳过/继续，失败不改变业务；steering_status 返回简洁进程内证据，provider/adopted 为 unknown。 |
| G5 子代理 | 不做运行中转发 | 正常 task 工具若尚未过 gate 可拦；已运行 task 等返回，native subtask 不在 hook 抛异常，避免悬挂。 |
| G6 长工具 | 不做紧急 abort | 已运行工具继续；用户仍可原生 Esc，插件不得把取消恢复成自动执行。 |
| G7 queue/follow-up | 不做 | 普通有效活动输入均为 steering；不引入第二队列。 |

## 验收标准

| ID | 可验证行为 | 检查方法 |
| --- | --- | --- |
| A1 | 包独立、精确公共 API、单文件构建，导出仅 SteeringPlugin，安装后可加载，无 kernel/extension 私有 import | 包 build/typecheck，scripts/package-steering.mjs 的 npm pack + offline 安装/import，真实官方内核加载 |
| A2 | G1 同一次模型响应的多工具调用，插话到达后尚未通过 gate 的旧调用均 error，旧文件不存在；新请求看到原指导，后续新动作成功 | 官方 OpenCode + 脚本 SSE OpenAI 模型；控制 first-call/后续调用释放屏障，至少两个 tool_calls 属同一 assistant。另测无插件对照旧动作确实执行 |
| A3 | G2 晚保存指导未进入请求且 ID 早于当前 assistant，原生完成后滞留；插件自动继续，指导恰好保留一次，控制不循环、普通 idle 不重启 | 公共 companion chat.message 双屏障：先分配 task、guide 原生 ID，释放 task 等 assistant 请求开始，再释放 guide 保存，最后释放模型 stop；同条件无插件确实只一请求，启用有唯一 continuation 和第二请求。参考旧 verify-steering-late-save.mjs:62-84；普通较晚 ID 输入另测原生已继续时无重复恢复 |
| A4 | G3 插话在模型请求中带明确最新优先/跳过旧动作提示，原始保存消息/附件保持；prepared 与 received/adopted 分离 | 抓取模型 HTTP body + session messages，单测附件/ignored/synthetic/空输入；真实运行证明请求确实带入 |
| A5 | 无插话时工具、消息与完成行为不变，插件不额外模型请求；多会话不串扰 | 确定性集成开/关插件对照 + 单测会话隔离 |
| A6 | dispatch 前已观察取消/错误/删除/压缩/revert 时抑制恢复；native subtask 特殊调用不在未捕获路径抛错；状态无磁盘文件损坏依赖 | 单测生命周期、dispatch 后控制保存前失效、重启历史不重放；真实内核 abort、revert-before-dispatch 和 SubtaskPart 集成（无遗留 running part），另测普通模型 task gate。最后检查之后的不可原子窗口明确列限制 |
| A7 | 不每个流式事件读全量历史，不每个正常工具重复全量读取；缓存有生命周期清理和明确上限，异步 event/toast/恢复失败不 unhandled rejection | SDK 调用次数测试（多工具、流式事件）、精简代码审查，根测试/typecheck |
| A8 | 真实模型 headless 开/关插件对照，多步任务运行中插话，启用后阻止尚未执行的旧动作并写 SUMMARY；真实 TUI 用 tmux 输入、capture-pane 留档，同条件关插件对照 | 可复现 scripts/steering-v2-demo.mjs（可选择 --tui）真实 Codex CLI bridge；存 messages、模型请求/响应与 Codex JSONL/usage、文件副作用、进程日志和屏幕，结果报告明确 source=real；失败不得替换成脚本模型 |
| A9 | 根默认测试包含确定性集成或文档明确 CI 命令；旧入口不再默认使用，README 与 baseline SPEC/DESIGN/STEERING 同步 | 根回归、kernel boundary、文档与引用核对；新验收成功后退役旧 ledger/旧测试与依赖 ledger 的历史探针 |
| A10 | 快速重复/冲突插话按稳定原生消息 ID 顺序处理，已保存各条原文均保留，旧工具不借新快照放行；删改不会永久卡住 | 真内核双插话用例，单测整条/部分删除、同 ID 内容更新、延迟事件和多附件保存；steering_status 在 pending/证据缺失/恢复失败时仍可调用 |

## 关键决策

| 决策 | 备选 | 选择与理由 | 代价/风险 |
| --- | --- | --- | --- |
| 状态 | 旧持久化 ledger / 内存小状态 / 新 SQL inbox | 内存，消息持久化交给原生内核；不复制 inbox | 进程重启无自动续跑、状态工具不展示旧进程证据 |
| 工具归属 | 每 gate 全量读 / 事件映射+快照+有界 fallback | 请求 transform 绑定当前 assistant 与指导版本；tool part 事件映射 callID→assistant；事件缺失时合并一次必要的公开 SDK 查询，不能把另一 assistant 的快照误用于旧调用 | 事件非 await，必须测试延迟与未知归属；无法确认时对 pending 的普通工具保守拒绝，native subtask 除外 |
| 指导生效 | chat.message 即认为 saved / 等持久化 / 每 gate 查全史 | chat.message 记录候选，保存事件或有界 SDK message 验证后确认为 saved；持续增长的内存不能依赖全量历史 | hook 在保存前，避免把失败保存永久当 pending；transform 可直接从已保存 history 校准 |
| 文本版本 | 仅 ID / 文本附件签名 | 对活动指导记录稳定的有效内容版本（排除 ignored/synthetic、归一化原生 reminder）；快照绑定该版本，不把普通 transform 包装算编辑 | 必须防止删改后误拦，压缩/undo 不复活旧 pending |
| 提示 | 修改原始消息 / 请求副本追加 | 请求副本追加简洁 steering reminder，并在 blocked error 中给模型明确重读指引 | 不证明模型语义采纳，无注入用户原文至磁盘日志 |
| 恢复 | abort/replay / 空消息 / synthetic 继续 | 成功 idle 后 debounce + SDK status/messages 复核 + 单飞的 promptAsync synthetic control，带唯一 metadata 标记与指导 ID；使用最新指导 model/agent。控制不算新指导，不复制用户内容，不降低权限或 format | 公开无原子 expected-turn；autoResume:false 可关闭；SDK v1 缺 runtime synthetic 等字段需窄类型适配 |
| 反馈 | 新 TUI / toast + status | 公共 showToast，限频且失败可忽略；steering_status 为进程内只读状态 | TUI QUEUED 仍由原生处理，toast 可被其他会话显示 |
| 旧代码处理 | 留双实现 / 立即删 / 验收后退役 | 新包验收成功再移除旧 ledger 与 plugin 测试；compose 保留且单测。scripts/verify-steering.mjs 指向新确定性入口；旧专属脚本移除或顶部明确 LEGACY 且不再推荐，历史文档不重写为新事实 | 避免破坏一键打包和 smoke；所有引用需要核对 |

### 最小实现职责

可用 index.ts + 一个 state.ts（或同等简单结构），不要求特定类。不要重复 596 行旧 ledger；生产逻辑以几百行内可清晰审查为目标，超出应有具体原因。状态至少覆盖：当前会话 lifecycle/epoch、活动指导与其 saved/prepared 版本、assistant 请求快照、必要的 call 映射、单次恢复标记/计时器。idle/删除/压缩/错误及时释放不需要的映射；活跃会话和工具快照限额写明，不能静默丢弃 pending 后放行旧工具。不要引入通用事件框架。

事件驱动读取流式变化，避免每个 delta 扫历史；仅在真正需要确认保存/工具归属/idle 恢复时用公开 SDK，有界 timeout、合并同会话并发查询。未观察到活动状态的历史输入不触发自动恢复。event 回调立即更新取消/删除 epoch，异步 continuation 在每个 await 后重新检查，catch 全部错误；不在网络失败时自动无限重试。恢复最多一次/指导版本，失败报告需人工重试。

工具 before 输入只有 tool/sessionID/callID（无 messageID）；不可编造 API。原生 native subtask 用 part.id 的路径要通过实际 part 映射确认或用明确的安全豁免，不得让拒绝异常逃到未捕获路径。普通模型 task 仍经正常 tool-error 路径。MCP 过 gate 后的权限等待与 batch 内部子工具属于限制。

### v1.1 固定实现契约（独立评审后的裁决）

1. **快照关联**：transform 的 msgs 不含刚创建的当前 assistant，不能取数组末尾 assistant。由历史推导 session、最新 user parent；合并一次 SDK session.messages（或已确认同等新鲜的事件缓存）定位唯一“未完成、parentID 匹配、非 summary、且不在 transform 输入”的当前 assistant。候选不唯一不建快照，普通有 pending 的调用 fail closed。压缩期间不建普通快照，compaction transform 不得覆盖真实 assistant 快照。每个真实请求至多一次校准，不在每个 gate 重新全史扫描。
2. **输入状态**：chat.message 记录候选及全部有效 part 内容版本；message.updated 仅证明 info 保存，全部预期有效 part 匹配才 saved。指导集合按原生 message ID 排序，与 SDK 原生消息顺序一致；不按异步事件完成顺序。候选不完整时 gate 合并有时限的 message 查询；失败拒绝本次普通调用并报告未知，不能无限永久待定。失败候选在后续完整校准确认缺失后退出，删改按新版本重算。附件生成的 synthetic 文本保留给模型，签名只算有效用户 part，归一化原生 system-reminder。
3. **恢复 permit**：串行区内预留一次性 permit（session/epoch、指导有序版本、成功终止 assistant），区外 promptAsync，避免重入死锁。控制重新进入 chat.message 时校验 permit 与当前 epoch/版本；取消、新真实输入、已被正常请求准备、删除/压缩/revert 都使旧 permit 失效并拒绝控制保存。超时结果记 unknown，不盲重试。promptAsync 204 不等于控制已保存。dispatch 前已观察取消可保证抑制；idle cancel 没专用事件、最后检查后取消无法保证原子拒绝，文档必须直说。
4. **恢复约束**：从最新有效指导继承 model、agent、system、variant、format（后者在 SDK v1 声明缺失，做局部窄适配），不发送 tools，沿用当前 session permission 而非重写它。字段无法安全还原时不自动恢复并报告原因。真实/单元测试核对控制与权限保持。
5. **revert**：session.updated 出现 revert 立即抑制资格；派发前 SDK session.get 复核，任何 revert 都停止本批恢复，等待新真实用户输入。不自动触发 revert cleanup；真内核测试验证撤销范围保留且可 redo。message/part removed 分别调整候选，不能把删除内容复活。
6. **native subtask**：part.id 匹配特殊 before 路径，callID 匹配普通模型工具；事件缺失时一次 SDK 校准。未知 task 且查询失败采取无异常安全豁免并记诊断（不以任意 task 声称 G1），不能在该未知路径 fail closed 重现 L-09。真内核提交 SubtaskPart 并验证 assistant/tool 最终离开 running；正常模型 task 可确认归属时仍 gate。
7. **诊断与边界**：steering_status 永远豁免 stale gate，只读不唤醒；活动 noReply 无法辨认，可能被恢复，README 提供 autoResume:false 并明确此不兼容。单一函数导出只防模块内重复调用；独立包与聚合入口二选一安装，禁止将其说成跨配置去重。
8. **包与 CI**：聚合入口相对 import `../steering/src/index.ts`，由 Bun 聚合构建包含，不增加 workspace 发布依赖；新包独立声明公开 dev/peer 1.3.17。验证聚合构建（根 include 覆盖）与独立打包。CI 文档给出从 npm 精确安装 `opencode-ai@1.3.17` 的命令及 OPENCODE_BINARY 指向其 bin/opencode，运行 --version 必须等于 1.3.17；npm lock integrity/平台子包固定并由 npm 校验，不能使用 @latest 或宿主本机路径。也可使用只读固定源码的明确启动适配，但不得历史 serve/merge。真实模型演示单独执行，不混入离线确定性 CI。

### 确定性集成设施

使用真实官方 1.3.17 server，隔离 XDG_CONFIG_HOME/DATA_HOME/CACHE_HOME/STATE_HOME、OPENCODE_TEST_HOME，禁项目配置、禁模型抓取，title/summary 禁用以避免干扰请求计数。可复用 scripts/lib/kernel-lab.mjs 的生命周期思想，但不要为了测试改只读内核；优先给新包建立小的独立 fixture，OPENCODE_BINARY 可覆盖，缺二进制时明确失败而非 silent skip。

本地 HTTP 服务实现 OpenAI chat completions SSE，脚本返回真正 tool_calls（支持同一 response 多个）。工具使用真实 bash 或精简 fixture tool 作为可观察屏障；假模型不替代 OpenCode。测试按保存消息/进入 provider 请求等条件同步，不用大 sleep 猜时序。G1 的流式响应先释放一个调用或先持有全部调用，保存插话后释放至少两个未过 gate 的旧调用；一并记录 concurrency 的 gate 边界。G2 使用 A3 双 chat.message 屏障，按内核自然分配 ID 制造晚保存，不伪造 ID、不改 kernel；关闭插件必须确实滞留。仅延迟普通 final response 不足以证明 G2；可额外覆盖 StructuredOutput 直接 break，但不能替代普通 late-save 对照。测试均有超时与 finally kill/close，错误保存服务日志；CI 不需要登录或付费网络模型。

真实演示可复用 scripts/lib/codex-cli-bridge.mjs；已有桥接一次一个工具足以跨请求演示 stale response（在真实 Codex 作出下一工具决策后、转发给 OpenCode 前设可观察屏障，提交插话，随后释放原始决策；启停条件一致）。如扩展多工具必须向后兼容既有测试。不得把脚本决定工具冒充真实模型；记录 Codex 原始 JSONL/最终响应/usage，敏感凭据不得写入证据。headless 和 tmux TUI 均用真实模型各做启/停对照，tmux 使用唯一 socket/session、捕获屏幕、清理自己创建的会话，不干扰用户 tmux。演示命令提供输出目录参数，完整可读日志可以保留 .codeagent（ignored），在 run 保存精简可审查报告、相关关键片段/屏幕，证据索引链接到实际文件。

## 实施计划

1. `external-plugins/steering/src/index.ts`、必要时 `state.ts`：上述 public Hooks、只读 status、提示、gate、恢复。包 `package.json` 改 v2 版本（例如 0.4.0）、固定 plugin peer/dev 1.3.17，独立 build 脚本/tsconfig；自己的 test/ 下有行为测试和真实内核集成。
2. `external-plugins/src/index.ts` 引用新包。保留 `external-plugins/src/steering/compose.ts` 合并工具与 event 能力。新包不得反向 import 聚合入口或 extension。
3. `external-plugins/steering/test/` 单元与确定性集成；测试共享设施按需放同级 fixture/helper，内核启动进程、HTTP 流、状态轮询有超时。根 package.json 纳入新测试；根 tsconfig 包含新包代码。
4. `scripts/package-steering.mjs` 改新入口并保持 npm pack / 干净安装 / 唯一导出 / 私有引用扫描；`scripts/steering-v2-demo.mjs` 提供 headless/TUI 可复现真实演示；`scripts/lib/codex-cli-bridge.mjs` 仅按演示留档需要最小扩展，不改模型选择行为。`scripts/verify-steering.mjs` 改为新集成入口或明确委托。
5. 在新实现验收成功后移除 `external-plugins/src/steering.ts`、`external-plugins/src/steering/ledger.ts` 与旧 `test/steering/plugin.test.mjs`（有价值契约迁入新测试）；依赖 ledger 的专属 probe/verify 顶部标 LEGACY 并说明替代命令，或有证据后删除。不要改无关 worker/capability-watch/one-shot 框架或其他 run。
6. 更新 `external-plugins/steering/README.md`（安装、构建、普通输入、autoResume、status、G1-G7 限制、CI/演示命令）、`external-plugins/README.md` 必要入口、`docs/baseline/STEERING.md`、`SPEC.md`、`DESIGN.md` 的 steering 段（版本与更新记录）；保留旧证据的历史身份。关键验证汇总写本 run 的实现报告及 README 索引。

## 验证命令

均从仓库根执行，CLI checks 逐条登记；Bun 用绝对路径避免 PATH 差异。

1. `node_modules/.bin/tsc --noEmit -p .`
2. `node_modules/.bin/tsc --noEmit -p external-plugins/steering`
3. `/Users/penghao/.bun/bin/bun run --cwd external-plugins/steering build`
4. `node --test external-plugins/steering/test/*.test.mjs`（包括真实官方 OpenCode 确定性集成，按实现文件名安排）
5. `npm test`
6. `BUN_BINARY=/Users/penghao/.bun/bin/bun node scripts/package-steering.mjs`
7. `node scripts/check-kernel.mjs`
8. `node scripts/steering-v2-demo.mjs --out .codeagent/steering-v2-demo-headless`（真实模型 headless 开/关对照）
9. `node scripts/steering-v2-demo.mjs --tui --out .codeagent/steering-v2-demo-tui`（真实模型 tmux TUI 开/关对照）

若演示脚本支持 --check 验证已有证据，仍必须先运行真实完整演示；不能只验一份旧 JSON。实现过程中命令如有必要更改，必须宿主回写设计和 checks，不能静默跳过验收。

## 变更记录

| 版本 | 日期 | 改动与理由 |
| --- | --- | --- |
| v1.0 | 2026-11-04 | 原生/四参考实现调研后初版：内存状态、公开 gate、有界 continuation、确定性真内核集成与真实模型/TUI 对照。 |
| v1.1 | 2026-11-04 | 采纳四 Codex 模型评审：真实 late-save 双屏障、完整 part 保存、快照唯一归属、控制 permit、revert/取消边界、字段继承、native subtask 真内核验收、重复/删改输入、noReply/重复安装与 CI 供给契约。 |
