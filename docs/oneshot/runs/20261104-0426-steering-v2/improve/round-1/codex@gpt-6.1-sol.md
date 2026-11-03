未发现 P0。建议在交给 Generator 前补齐以下设计细节：

1. **P1：A3 的测试时序通常触发原生继续，不能证明 G2 修复。**  
   设计要求在最终响应返回前保存插话（`docs/oneshot/runs/20261104-0426-steering-v2/DESIGN.md:31`、`:64`），但普通文本响应完成后，processor 返回 `continue`，loop 会重新读取消息；若插话 ID 晚于 assistant，原生就会继续处理。证据：`agent-kernel/packages/opencode/src/session/processor.ts:486`、`agent-kernel/packages/opencode/src/session/prompt.ts:1373`。  
   建议复用现有 late-save 屏障：先分配指导 ID，再延迟保存，确保 `guidance.id < assistant.id` 且指导未进入请求；关闭插件时断言孤立，开启时断言唯一 synthetic control 引发恢复。现有实现可参考 `scripts/verify-steering-late-save.mjs:62`、`:84`。另一方案是利用 StructuredOutput 的直接退出分支，构造更简单，但覆盖的是不同终止路径，不能替代普通 late-save 用例。

2. **P1：恢复协议需要明确“控制消息重新进入 chat.message 时”的校验。**  
   当前只规定派发前复核、每次 await 后检查 epoch（`docs/oneshot/runs/20261104-0426-steering-v2/DESIGN.md:48`、`:56`），没有规定控制消息保存前的准入规则。`prompt_async` 返回 204 不代表消息已经保存，后台任务此后仍可能进入 hook；期间取消、新输入或正常请求已覆盖指导，都可能使原派发失效。证据：`agent-kernel/packages/opencode/src/server/routes/session.ts:845`。  
   建议明确一次性 permit，绑定 session、epoch、指导版本及终止 assistant；控制消息进入 `chat.message` 时重新校验，失效则拒绝保存。派发须在会话串行区外执行，避免重入死锁。保留现有测试契约：`test/steering/plugin.test.mjs:583`、`:609`、`:620`。这增加少量进程内状态，但可以收窄竞态，不能全部归入“公开 API 非原子”的限制。

3. **P1：undo 的抑制必须覆盖 revert 标记，不能只等待消息删除事件。**  
   设计承诺“压缩/undo 不复活旧 pending”，但没有定义 undo 的失效事件和验收（`docs/oneshot/runs/20261104-0426-steering-v2/DESIGN.md:46`）。实际 revert 先保留历史并设置 `session.revert`；下一次 prompt 才清理撤销范围，而且 cleanup 在 `chat.message` 之前执行。证据：`agent-kernel/packages/opencode/src/session/revert.ts:82`、`:104`，`agent-kernel/packages/opencode/src/session/prompt.ts:1307`。  
   建议收到含 revert 的 `session.updated` 时立即取消恢复资格，派发前通过公开 session 查询复核；存在 revert 时停止自动恢复。增加真实内核用例：恢复待派发时 undo，不产生控制消息、不清理撤销历史、仍可 redo。代价仅是恢复路径增加一次查询，无须扩大工具热路径。

4. **P2：写清请求快照如何绑定当前 assistant。**  
   设计直接规定 transform 绑定“当前 assistant”（`docs/oneshot/runs/20261104-0426-steering-v2/DESIGN.md:44`），但公开 transform 输入为空，历史数组也不包含刚创建的当前 assistant：它先被单独保存，随后传入原有 `msgs`。证据：`agent-kernel/packages/plugin/src/index.ts:242`、`agent-kernel/packages/opencode/src/session/prompt.ts:1448`、`:1499`。  
   建议指定事件缓存的关联条件、缺事件时的公开查询条件，以及候选不唯一时的行为；同时区分 compaction transform，后者发生在 summary assistant 创建之前（`agent-kernel/packages/opencode/src/session/compaction.ts:221`）。保留“一次必要查询”的方案即可，不必回到每个 gate 全量扫描；增加延迟事件和历史 assistant 干扰用例。

5. **P2：将 continuation 的参数继承写成明确契约。**  
   当前只明确继承 model/agent，并笼统要求保持权限和 format（`docs/oneshot/runs/20261104-0426-steering-v2/DESIGN.md:48`）。synthetic control 会成为最新 user；遗漏 `system`、`variant`、`format` 会改变后续请求，而盲目复制 `tools` 会再次写入会话权限。证据：`agent-kernel/packages/opencode/src/session/prompt.ts:975`、`:1312`，`agent-kernel/packages/opencode/src/session/llm.ts:109`。  
   建议明确：继承最新有效指导的 model、agent、system、variant、format；不发送 tools，沿用当前会话权限。将字段保持与权限不变纳入验收，参考 `test/steering/plugin.test.mjs:562`。这只需固定字段规则，无须引入通用配置继承机制。