未发现 P0。设计方向符合需求，但以下 P1 建议在交给 Generator 前补齐。本次为只读源码评审，未修改文件或运行测试。以下 `DESIGN.md` 指本轮 `docs/oneshot/runs/20261104-0426-steering-v2/DESIGN.md`。

1. **P1：A3 的测试时序不能可靠触发 G2，可能把原生继续误判为插件恢复。**

   证据：`DESIGN.md:31、64` 计划在最终响应返回前保存插话，再释放终止响应。但普通成功响应在 `agent-kernel/packages/opencode/src/session/processor.ts:486–488` 返回 `continue`；随后 `session/prompt.ts:1348、1373–1380` 重读消息，并比较最新 user 与 assistant ID。此时插话通常比当前 assistant 新，原生就会继续。

   建议明确采用能直接退出的成功路径，例如 `session/prompt.ts:1523–1527` 的 StructuredOutput 分支：保存插话后释放结构化最终结果。必须增加关闭插件的同条件对照，证明指导确实滞留；启用后再断言 synthetic control 和额外请求。普通文本场景可以保留，作为“原生已经继续时插件不重复恢复”的测试。代价是 fixture 稍复杂，但能真正验证 G2。

2. **P1：恢复前需要检查 session 的 revert 状态，消息列表不足以证明指导仍有效。**

   证据：`DESIGN.md:46` 承诺 undo 不复活旧 pending，但 `:48、56` 的恢复流程只明确复核 status/messages。实际 `agent-kernel/packages/opencode/src/session/revert.ts:82–90` 先设置 revert 标记；消息删除延迟到 `:104–144` 的 cleanup。新的 prompt 又会在保存控制消息前调用 cleanup（`session/prompt.ts:1307–1309`）。

   因此，用户在恢复 debounce 期间撤销后，旧指导仍可能出现在 messages 中；自动 continuation 可能主动触发清理并继续运行。

   建议监听公开 session 更新中的 revert，并在派发前通过 SDK 读取 session 复核。最简单的策略是任何 revert 都抑制当前恢复资格，等待新的真实用户输入；精确裁剪撤销范围更复杂，本次没有必要。补充“idle 后撤销、计时器尚未派发”的确定性用例。

3. **P1：需要明确候选指导、完整保存与 gate 的状态转换。**

   证据：`DESIGN.md:45` 将确认条件写成“保存事件或 SDK message 验证”，但内核在 `agent-kernel/packages/opencode/src/session/prompt.ts:1299–1300` 先保存 message，再逐个保存 part。收到 `message.updated`，甚至收到第一个 part，都不代表整条指导和附件已经保存完成。旧测试已覆盖这个问题：`test/steering/plugin.test.mjs:296`。

   如果 gate 只阻止 saved 指导，保存间隙会放行旧工具；如果所有候选永久阻止，又可能因保存失败卡住会话。

   建议规定：候选记录预期有效内容版本；只有完整 part 集合匹配后才能标记 saved。gate 遇到尚未确认的候选时，执行合并且有时限的确认，确认不了时明确拒绝本次普通调用，并规定后续解除条件。恢复则始终要求完整 saved。增加多附件分批保存、保存失败、事件延迟与并发 gate 用例，避免 Generator 自行猜测。

4. **P1：请求快照与 native subtask 的归属规则仍需具体化。**

   证据：`DESIGN.md:44、58` 要求绑定当前 assistant，并允许 native subtask 安全豁免，但尚未定义唯一识别规则。公开 transform 的输入没有 assistant ID（`agent-kernel/packages/plugin/src/index.ts:242–249`）；正常请求在读取历史之后才创建并保存当前 assistant（`session/prompt.ts:1348、1433–1448`），因此不能直接把 transform 历史中的最后一个 assistant 当作当前请求。压缩也调用同一个 transform，且其 summary assistant 更晚才创建（`session/compaction.ts:221–250`）。

   建议写明唯一候选条件、事件缺失时的 SDK 校准方式，以及如何区分压缩请求。native task 应明确按 tool part 的 `id` 识别特殊路径，普通调用按 `callID` 识别。特别需要裁决“task 归属未知且查询失败”：保守拒绝可能重现未捕获异常，直接豁免则扩大 G1 缺口。

   为避免重新引入 L-09，A6 应加入真实 native subtask 集成测试，验证没有遗留 running part；仅检查源码中的 ID 差异不够。

5. **P1：补全 continuation 从派发到保存的协议，保留旧实现已有的防重入措施。**

   证据：`DESIGN.md:48、56` 描述单飞、epoch 和 await 后复核，但没有明确控制消息重新进入 `chat.message` 时的处理。旧实现指出 `promptAsync` 会重入 hook，派发必须放在会话串行区之外（`external-plugins/src/steering/ledger.ts:254–256`），且 HTTP acknowledgement 可能早于控制消息 hook（`:295–296`）。旧测试覆盖了这一时序及派发后的取消、新输入：`test/steering/plugin.test.mjs:583、609、620`。

   建议明确：串行区内预留 attempt/permit，区外派发；控制消息进入 `chat.message` 时重新校验 permit、epoch 和指导版本；新用户输入使旧 permit 失效；超时记为结果未知且不重试。这不能消除最后的非原子窗口，但可以避免死锁和已有机会拦住的陈旧续跑。

6. **P2：把自动恢复的参数保留规则写成字段级契约。**

   证据：`DESIGN.md:48` 只明确继承 model/agent，以及“不降低权限或 format”。实际上，最新 user 的 `system` 会进入模型系统提示（`agent-kernel/packages/opencode/src/session/llm.ts:109–110`）；synthetic control 成为最新 user 后，遗漏它会改变请求语义。`variant` 也影响后续请求。旧实现保留了 `system/format/variant`，并刻意省略 `tools`（`external-plugins/src/steering/ledger.ts:274–279`）；因为发送 `tools` 会更新 session 权限（`session/prompt.ts:1312–1318`）。

   建议明确继承最新有效指导的 `agent/model/system/format/variant`，不发送 `tools`，不改变现有 session 权限，并迁移 `test/steering/plugin.test.mjs:562–576` 的字段断言。这是已有行为契约，无需增加新的配置能力。