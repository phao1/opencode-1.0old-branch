P0：未发现。

P1：

1. 当前 assistant 与请求快照的关联规则不够可实现。设计称在 transform 阶段绑定当前 assistant（`DESIGN.md:44`），但内核先读取 `msgs`（`agent-kernel/packages/opencode/src/session/prompt.ts:1348`），随后新建当前 assistant（`:1433-1448`），最后仍把旧 `msgs` 传给 transform（`:1499`）；该 hook 也没有 sessionID 或 assistantID（`agent-kernel/packages/plugin/src/index.ts:242-250`）。若实现仅查看 hook 参数，会绑定历史 assistant 或得不到归属，导致所有工具误放行或误拒绝。建议明确算法：从 transform 消息推导 session/parent，用一次合并的公开 `session.messages` 查询定位“唯一、未完成、parentID 匹配且不在 transform 输入中的 assistant”；不唯一则不建快照并 fail closed。代价是每次请求至多一次 SDK 查询，但符合 A7。

2. `noReply` 兼容边界从 Brainstorm 丢失。`BRAINSTORM.md:16` 已指出公开 `chat.message` 无法辨认 noReply；hook 输入确实没有该字段（`agent-kernel/packages/plugin/src/index.ts:200-209`），而内核保存后会直接返回、不启动模型（`agent-kernel/packages/opencode/src/session/prompt.ts:1305-1322`）。当前恢复设计（`DESIGN.md:18,48`）可能把明确的“只保存”输入自动唤醒成一次模型调用。需要在设计中明确取舍：接受并文档化这一不兼容；或仅对显式 `steer:` 自动恢复，普通输入仍靠原生调度。两者分别牺牲 noReply 兼容性或普通输入的完整 G2 保证，不能静默声称两者都满足。

3. “最新指导优先”没有定义权威顺序，也没有重复插话验收。设计承诺最新指导优先（`DESIGN.md:11,19,47`），但 A2–A4 都只有单条指导（`:30-32`）。事件 hook 又不会被内核 await（`agent-kernel/packages/opencode/src/plugin/index.ts:227-234`），并发或快速连续输入不能按异步回调完成顺序判新旧。建议以持久化消息顺序/稳定 message ID 为唯一顺序，快照记录有序指导集合；增加“两条相互冲突插话快速到达、旧工具全部拦截、恢复只针对最新版本一次”的真内核集成测试。保留全部原消息用于审计，但只给最后一条增加“最高优先级”提示。

4. native subtask 的验收仍以源码观察代替行为验证。该路径正是旧实现 L-09 的已知正确性问题（`REQUIREMENT.md:10`、`docs/review/legacy-codex-audit.md:57`），且 before hook 位于错误捕获区外（`agent-kernel/packages/opencode/src/session/prompt.ts:580-615`）。A6 只要求查看 callID/part.id 差异并做普通 abort 集成（`DESIGN.md:34`），不足以证明不会再次留下 running tool。建议用真实内核提交一个 `SubtaskPart`，验证 hook 不抛、assistant/tool 最终离开 running；另测模型生成的普通 `task` 仍受 stale gate。安全豁免会降低 native 路径的拦截能力，但优于会话悬挂。

5. “可在 CI 跑”缺少二进制供给方案。需求明确确定性集成须可在 CI 运行（`REQUIREMENT.md:34`）；设计只规定 `OPENCODE_BINARY` 可覆盖、缺失即失败（`DESIGN.md:62`），验证命令也未说明 CI 如何得到固定 1.3.17 二进制（`:84`）。本机绝对路径不能形成可复现 CI 验收。建议明确 CI job 的固定二进制来源、版本/SHA 校验和缓存方式，或提供基于已固定 submodule 的受支持启动入口；否则应把“CI-ready”降级为本机验收。不要使用 AGENTS.md 已禁止的历史 `bun run serve` 路径。

P2：

1. synthetic continuation 的上下文字段需要逐项定义和测试。设计一处仅说复制最新 model/agent，另一处又承诺不降低 format（`DESIGN.md:48`）。运行时用户消息还包含 `format/system/variant`（`agent-kernel/packages/opencode/src/session/message-v2.ts:357-377`），但生成 SDK 类型不完整。建议明确复制 model、agent、system、format、variant，明确不复制 tools，并在 A3 抓取 continuation 请求验证；或者明确哪些字段故意重置及原因。

2. 消息撤销/局部附件删除缺少验收。设计承认删改后不能误拦（`DESIGN.md:46`），但 A4/A6 没有区分 session 删除、`message.removed` 与 `message.part.removed`；公开事件分别存在于 `agent-kernel/packages/sdk/js/src/gen/types.gen.ts:152-157,414-420`。建议增加整条消息撤销、单个文本/附件删除和同 ID 内容变化测试，确保旧版本不会永久 fail closed，也不会因撤销而复活。

3. 应明确 `steering_status` 绕过 stale gate。它是用户诊断失败状态的唯一入口（`DESIGN.md:20`），但最小职责只泛称普通工具 gate（`:58`）。若状态工具由旧 assistant 调用，也被判 stale，用户恰好无法看到拒绝原因。建议把该只读工具列为显式豁免，并测试 pending、证据缺失和恢复失败时仍可调用。

4. 新独立包与聚合入口的依赖方式尚未闭合。计划要求 `external-plugins/src/index.ts` 引用新包（`DESIGN.md:71`），但当前根 workspace 不含 `external-plugins/steering`（`package.json:6-9`），聚合包也没有声明该依赖（`external-plugins/package.json:8-16`）。建议明确采用 workspace 包依赖并更新锁文件，或明确相对源码入口及其构建边界；同时为聚合构建增加干净安装测试，避免只验证 standalone 包成功。

5. “唯一函数导出可防重复调用”的表述过强（`DESIGN.md:9`）。旧 loader 的去重仅发生在单个模块的导出集合内（`agent-kernel/packages/opencode/src/plugin/index.ts:70-80`）；若用户同时配置 standalone 包和聚合入口，仍会注册两套 gate、toast 和 recovery。建议至少在 README 和 A1 中验证并警告二选一；若做运行时去重，则需谨慎处理不同项目/目录实例，避免全局 guard 互相污染。