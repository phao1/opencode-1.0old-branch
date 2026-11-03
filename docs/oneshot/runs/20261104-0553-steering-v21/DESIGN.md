# Steering v2.1 — fail-open 请求作用域设计

版本：v1.0；更新日期：2026-11-04。

## 目标与范围

按本 run REQUIREMENT.md 完整返工上一轮 steering，所有原始产品目标及硬约束继续有效。实现仅用 @opencode-ai/plugin@1.3.17 公开 Hooks/SDK，放在 external-plugins/steering/，不修改 agent-kernel tracked 文件，不导入内核私有模块或 extension。宿主维护设计，Generator 实施，Evaluator 只读。无人值守默认见 BRAINSTORM.md。

G1 在 before 检查点拦截确定属于旧请求的普通工具；G2 成功结束后对未吸收插话做最多一次有条件 continuation；G3 仅首次包含 pending 的普通请求附加最新优先、保留完成结果、报告跳过动作提示；G4 保留尽力 toast 与简明 steering_status。G5 不转发运行中子代理；G6 不 abort/回滚已开始工具；G7 不增设 follow-up 队列。

### 固定版本请求归属证明

agent-kernel HEAD=517e6c9aa4c61dbc125e7654fc596f1d529f20d9。prompt.ts:1353–1387 串行 loop 读取消息，:1499 调用 messages.transform，:1510–1526 等待 handle.process，处理退出才在 :1559–1569 进入下一 loop；effect/runner.ts:111–135 同 session Running 时仅 join 现有 Deferred，不能并发开启另一 run。processor.ts:182–211 当前 assistant 工具事件配合 prompt.ts:449–458 的 before，全部发生在该请求处理内。因此该 session 的普通工具必然对应最近一次 transform，无需 callID→assistant 或历史快照。不同会话/父子会话分别按 sessionID 隔离。原生 subtask 为特例：prompt.ts:604 使用 part.id 且 before 不在 execute catch 内，对 callID 以 prt_ 开头的路径一律放行（保守豁免，即使普通模型碰巧生成该前缀）。compaction.ts 的 compacting hook 先于 summary transform，Generator 核对精确行号并在报告留证据。

chat.message（prompt.ts:1263–1305）在消息保存前执行，所以观察不等于已保存。以“transform 之后新观察的有效输入”证明该请求不包含该输入即可在当前请求短暂 gate；不等待保存确认，不比较指纹。新 transform 不含旧 pending 直接丢弃，结束也清空，防止保存失败/慢保存永久拒绝。

## 验收标准

| ID | 可验证行为 | 检查方法 |
| --- | --- | --- |
| A1 | 只有本进程已见普通 transform 且未结束才登记有效插话；普通空闲输入不留历史状态，不抛容量错误 | 单测 >300 普通输入、129 取消会话、不同 session、ignored/empty/synthetic、重启；SDK 调用计数为零 |
| A2 | G1 只拦最近普通请求构造后到达的有效插话；无已知请求/compaction/不确定一律放行；status/native prt_ 放行，普通 task 仍检查 | 单测并发 bash/task、missing/cross-session；真实官方内核一次响应多工具开/关对照及原生 subtask |
| A3 | transform 同步移除开始前全部 pending；包含 ID 的有效插话只在这一次加 G3，不含的丢弃；摘要请求不 gate、不加提示 | 单测提醒次数、编辑为空/ignored、overflow 新 ID、单次及连续压缩；真实官方 summarize/overflow fixture |
| A4 | G2 仅成功 idle 且仍有本进程忙碌期间未吸收 pending 时，一次公开 messages 读取确认最新有效用户比最新成功非摘要 assistant 新，然后最多一次 synthetic continuation | 单测调用次数、失败/超时/慢保存、重复 idle、控制失效、metadata/agent/model/system/variant/format 继承、tools 不继承；真实官方 G2 保存时序开/关对照 |
| A5 | 没插话不改请求、不调 session.messages，常态 transform/gate/streaming 不读历史；查询失败不阻止普通输入或任何新请求工具 | SDK spy，真实内核无插话开关对照，历史异常回归 |
| A6 | 前 run review 每场景有对应回归，统一证明不会永久拦截/阻止发消息 | 单次与连续压缩、overflow 换 ID、empty/ignored 编辑、info-only/部分保存/慢保存、并发 task、取消129会话、>300普通输入、历史失败、聚合autoResume:false、空cache离线安装；可官方复现的走确定性内核测试，余者单测 |
| A7 | G4 toast observed/absorbed/blocked/continuing 尽力，失败忽略；status 简洁且 provider/adopted unknown | 单测离线 toast、status 不读历史，实际 TUI 屏幕/消息证据 |
| A8 | 生产 state.ts+index.ts ≤200 非空非注释非类型行；类型、构建、根回归、打包安装与内核边界通过 | 报告注明统计法、行数及文件；不压成超长行规避。已有安装验证使用实际安装入口跑新契约 |
| A9 | 保留真实模型暂扣决定 headless/TUI 开关对照，并新增不暂扣模型响应的真实自然时序 tmux TUI 开关对照 | scripts/steering-v2-demo.mjs 既有两命令；新增 --natural --tui，任务含 sleep 8 再写文件、运行中在真实 TUI 直接提交插话；每例保存屏幕、原始模型请求/响应、原生消息、文件、日志、结果；自然对照如两者均正确采纳如实说明 |
| A10 | 文档和公开限制与实现一致，不宣称永不漏拦/原子取消/语义采纳 | 包 README、docs/baseline/STEERING.md、SPEC.md、DESIGN.md 同步当前 v2.1，旧 v2.0 段落清楚标历史，CHANGELOG 仅如包版本需更新；本 run README 索引完整 |

## 关键决策

| 决策 | 备选 | 选择与理由 | 代价/风险 |
| --- | --- | --- | --- |
| 请求作用域 | 保留快照/assistant/callID/全历史 | 只存当前请求类型和 transform 后 pending ID/必要用户字段，同步 hook 过渡，不在热路径 await 历史 | 依赖固定串行 loop，升级需复核 |
| fail-open | 保存确认失败就阻断 | 每次 transform 消费全部已有 pending，缺席丢弃；摘要清空且关闭 gate；无已知状态直接放行 | 保存失败、压缩过滤/换 ID、编辑或进程重启可能漏拦；这是有意放弃旧“未知也拒绝”保证 |
| 内存 | 追踪全部输入并设256/128硬限 | 只给已见 transform 的运行会话建状态；idle/error/cancel/delete清空，恢复候选放短期单独许可中并在完成/失败/超时释放 | 活动会话数及当前请求期间插话量决定内存，不声称固定字节上限；不设拒绝输入的容量阈值 |
| G3 | 每轮重发、摘要链传递 | 只对本次 ID 命中有效 pending 的普通请求加一次 synthetic reminder；原输入/附件内容不改 | 被过滤指导不再附加，不保证摘要完整性或模型采纳 |
| G2 | 每次请求全量查询/无限重试/直接 loop 私有接口 | idle 一次公开 history 确认 + status/get 安全检查 + 带 permit 的 synthetic promptAsync；控制仅引用原消息ID | 无原子事务；保存晚于单次检查则不恢复，错误/不确定则放弃恢复，用户可手动继续 |
| 实现规模 | 保留438行状态机 | 重写核心而非逐项补丁，目标总生产有效行≤200（类型/注释除外） | 不用手工指纹/summaryID传递/重放内容映射换取更少保证和更高可用性 |

### 最小状态与过渡

- Map<sessionID, Active>：普通/摘要请求标记、pending Map<messageID,必要用户信息及有效性>、toast节流可选。状态不保留历史消息、工具、快照、摘要覆盖或 attempts 数组。
- prepare：从 messages 的 sessionID 唯一确定会话，歧义放行且不创关联；消费一次 compacting 标记（可用独立 Set 并在终止清理）。普通请求对开始前 pending 按 message ID 检查是否实际含有效用户内容，命中才 append 一次 static reminder，随后全部清空；标记当前普通请求已知。摘要则 pending清空且当前请求不可 gate。整个状态切换在任何 await 前完成，避免观察竞态。
- observe：优先识别自家 synthetic control；普通有效输入只在已知忙碌状态中记 pending 并 toast。不抛普通消息异常，无哈希/保存确认/容量。删除/空编辑等事件可直接丢弃对应候选，证据不确定时宁可漏拦；不能保留 dirty 永久 gate。
- gate：status/native prt_ 或无已知普通请求放行；当前 pending 非空证明在其 transform 后收到插话，抛 STEERING_STALE_CONTEXT（原生工具错误，含最新优先提示），不查询 history。多个工具均按检查当时状态决定，已过 gate 不撤回。
- compact：清空当前 pending、使普通 gate 失效、标下一个 transform 为摘要，同时失效恢复许可。摘要后普通 transform 正常重置，不因 session.compacted 事件重复设 compacting。
- event：idle只处理一次（内核可能同时 idle/status idle），立刻从 active Map 删除；若有 pending且未见取消/错误/revert，复制为一个恢复候选并调度一次。message.updated assistant error / session.error / session.deleted / revert 清理active/compaction/恢复许可，不能因异步事件抛出。session.status busy不创建假 transform 关联。
- G2 recover：候选 identity/generation 用于每次 await 后失效判断；messages仅一次（带短超时）确认候选最新有效用户已保存且新于最新非摘要成功完成assistant（无error、有completed和有效finish；structured成功兼容），不确定返回。必须检验最后assistant并非失败/未完成而不能跳过它选更早成功。status/get确认idle且无revert；从最新有效用户继承model/agent/system/variant/format但不继承tools。promptAsync仅一次，metadata标自家control+随机permit；observe控制保存前再次核对许可/取消/revert/status。拒绝仅限自家失效控制，不得拒绝真实用户消息；该错误不得清理别的新轮状态。候选定时过期/任何失败清理；重复idle不重派。
- 真实用户新输入、正常transform、取消/错误/删除/revert/压缩使旧恢复候选失效；SDK无法保证观察之前的取消或派发后取消原子性。autoResume:false完全不做恢复 history 查询。

## 实施计划

1. external-plugins/steering/src/state.ts 重写上述最小状态，index.ts保持唯一函数导出与公开hooks；options继续由 external-plugins/src/index.ts 转交。先写新契约回归，再替换实现。删除只服务旧契约的断言（无限保存/覆盖保证）但保留对应反例；tests明确映射前run两轮每项发现。
2. external-plugins/steering/test/state.test.mjs 更新/精简单测，spy保证无插话零messages读取；test/kernel.test.mjs 复用test/kernel.mjs真实官方运行与SSE fixture，覆盖G1多工具、G2边界、native subtask、单/连续摘要、overflow、慢保存。测试不通过私有 import，不用假 state 冒充内核验证。
3. scripts/steering-v2-demo.mjs 添加 --natural（须 --tui），保留现有暂扣响应路径。自然任务以多步sleep 8文件写入，观察第一个工具 running 后直接TUI提交插话；不建立响应屏障，保留原生可能正确采纳的对照。两种模式证据结构明确区分。若需小改scripts/lib/codex-cli-bridge.mjs仅为保持真实桥接协议，不脚本化选择行为。
4. scripts/package-steering.mjs / scripts/verify-steering.mjs / test/packaging/* 仅在契约或包版本需要时最小更新，继续空cache离线安装。README/baseline同步新语义并写v2.0保证放弃清单。包版本若调整按既有惯例递增，不无关改动依赖。
5. Generator 报告应列diff范围、A1–A10映射、行数、实际执行命令与证据路径（本run impl轮目录）。禁止动其他run/skill/内核；不自行提交。宿主检查再正式verify、review。

## 验证命令

以下命令均在仓库根顺序运行，宿主用 checks add 原样登记。真实模型耗时不是超时，可留长会话等待结束。

1. node_modules/.bin/tsc --noEmit -p .
2. node_modules/.bin/tsc --noEmit -p external-plugins/steering
3. npm test
4. node scripts/check-kernel.mjs
5. node scripts/verify-steering.mjs
6. node scripts/steering-v2-demo.mjs --out docs/oneshot/runs/20261104-0553-steering-v21/verify/evidence/headless
7. node scripts/steering-v2-demo.mjs --tui --out docs/oneshot/runs/20261104-0553-steering-v21/verify/evidence/tui
8. node scripts/steering-v2-demo.mjs --natural --tui --out docs/oneshot/runs/20261104-0553-steering-v21/verify/evidence/natural-tui

修复复验若输出目录已存在，脚本必须支持安全复跑并保留前证据（例：归档旧目录或新子目录，禁止因残留文件假通过）。verify最多修复复验3次。独立review最多2轮，无被采纳P0/P1停止；达到上限仍存在P0/P1则阻塞，不假报完成。

## 变更记录

| 版本 | 日期 | 改动与理由 |
| --- | --- | --- |
| v1.0 | 2026-11-04 | 初版，核对固定串行loop，按验收人要求采用fail-open请求作用域；明确放弃历史版本/摘要覆盖保证与一次性G2边界，新增自然TUI演示 |
