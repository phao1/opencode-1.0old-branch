# 固定 API 实施核对（2026-11-04）

只读源码：agent-kernel HEAD 517e6c9aa4c61dbc125e7654fc596f1d529f20d9，官方 v1.3.17。

- session/prompt.ts:1353–1387 逐轮读消息；1499 transform；1510–1526 等待 handle.process；1559–1569 再进入下一 loop。
- effect/runner.ts:111–135 ensureRunning 在 Running/ShellThenRun 状态 join 现有 Deferred，不另开同 session run。
- session/processor.ts:182–211 处理当前 assistant 工具事件；prompt.ts:449–458 普通 before 位于当前工具 execute 路径。
- prompt.ts:604 native subtask before 传 part.id，在 execute catch 前；因此所有 prt_ callID 保守放行。
- prompt.ts:1263–1305 chat.message 在 updateMessage/updatePart 保存前调用，不能把观察当保存确认。
- session/compaction.ts:184–185 compacting，221 messages.transform；故一次性 compacting 标记能识别紧接的摘要 transform。
- session/status.ts:73–80 先 publish status-idle，再 deprecated idle，再删 busy；因此只监听 status-idle，并延迟75ms查询。
- prompt.ts:144–150 无 busy runner 的 cancel 仍 publish status-idle；恢复候选期间第二个 status-idle 是新取消边界。
- session/index.ts:595–599 messages 返回原生 stream reverse；G2 用返回数组中的 parent 用户位置，不使用消息 ID 或创建/完成时间比较。
- plugin/index.ts:243–253 依序把同一 output 传给各 hook；本插件后面的变换仍可改内容。公开说明要求 Steering 加载在变换用户消息的插件之后。
- server/routes/session.ts:853 promptAsync 异步失败转 session.error；仅随机 token 匹配的自家失效控制错误被忽略。

实现只使用公开 PluginInput client 的 session.messages/status/get/promptAsync、tui.showToast 和公开 hooks，无内核私有 import。
