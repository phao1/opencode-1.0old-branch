# DESIGN v1.2 固定公开 API 核对

2026-11-04；只读核对 agent-kernel HEAD 517e6c9aa4c61dbc125e7654fc596f1d529f20d9，官方 OpenCode 1.3.17。

- server/routes/session.ts:535–544：公开 summarize 创建原生 compaction trigger，然后进入 SessionPrompt.loop。
- session/compaction.ts:184–185：公开 experimental.session.compacting 在 summary transform 前调用，可由同进程公开 companion 插件暂停。221：summary transform；224–227：之后才分配 summary assistant，parentID 为 trigger ID。
- session/prompt.ts:1263–1305：公开 chat.message 运行在用户消息与parts保存之前。compacting 暂停期间可分配并暂扣 guide；释放 compacting 后，等实际 summary provider 请求到达，再释放 guide 保存。
- session/prompt.ts:1373–1384：最后 user ID 小于已结束 assistant ID 时退出 loop。测试严格建立 trigger ID < guide ID < summary assistant ID；因此即使 guide 在 summary 进行中保存，原生 loop 在 summary 成功后也可能停止。
- session/message-v2.ts:903–918：filterCompacted 由成功 summary 的 parentID 找 compaction trigger 截止历史。最后 assistant（含summary）的 parent用户位置可排除 trigger 之前的已过滤指导；trigger之后的guide留在普通续接provider集合。
- session/index.ts:595–599：公开 messages 返回原生 stream reverse。恢复边界继续使用历史数组中的 parent用户位置，不比较用户和assistant ID大小。
- server/routes/session.ts:850–857：promptAsync 异步失败发布 session.error。已签发失效控制仍用随机错误token忽略对应迟到错误；unknown/expired/cross-session key 不进入拒绝路径。

新增 fixture 使用公开 companion compacting/chat.message hooks 和公开HTTP summarize/prompt_async/messages；provider 为本地SSE确定性服务，内核进程为真实官方二进制。没有私有 import、假state替代或内核改动。
