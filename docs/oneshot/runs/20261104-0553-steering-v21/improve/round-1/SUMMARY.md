# Improve round 1 — 宿主裁决

日期：2026-11-04。四份成功评审均 Codex，同一 agent、不同模型；非 DEGRADED。无 P0。设计 v1.0 → v1.1。

| Agent | 模型 | 状态 | 原因 | durationMs |
| --- | --- | --- | --- | --- |
| codex@gpt-6.1-sol | gpt-6.1-sol | ok | - | 143518 |
| codex@gpt-6-astra | gpt-6-astra | ok | - | 122942 |
| codex@gpt-6.1-terra | gpt-6.1-terra | ok | - | 39167 |
| codex@gpt-5.6-sol | gpt-5.6-sol | ok | - | 162074 |
| claude | - | unavailable | authentication required / not logged in | 0 |
| qodercli | - | unavailable | binary not found | 0 |
| agy | - | unavailable | binary not found | 0 |
| gemini | - | unavailable | binary not found | 0 |
| dsh | - | unavailable | authentication required / not logged in | 0 |
| codebuddy | - | unavailable | authentication required / not logged in | 0 |
| opencode | - | unavailable | binary not found | 0 |

| 建议（P0/P1/P2） | 来源 agent（模型） | 采纳/部分/拒绝 | 理由与证据 |
| --- | --- | --- | --- |
| P1 G2排序与原双屏障正例冲突 | sol/astra/5.6-sol | 部分 | 采用sol的last assistant.parentID处理边界，以SDK历史数组位置比较候选latest user；不采astra放弃原正例备选，也不采单纯比较user/assistant数组位置。prompt.ts:970与kernel.test.mjs:100证明ID先分配；设计v1.1明确偏离字面排序及代价，保留G2正例和非单调ID回归 |
| P1 已idle后取消只发idle，不能忽略所有重复通知 | sol | 采纳 | prompt.ts:144–150/status.ts:73–80核实；仅status-idle驱动，deprecated idle忽略，无active的后续status-idle失效候选 |
| P1/P2 有效输入谓词缺少file-only等定义 | 5.6-sol | 采纳 | 旧state.ts:21语义可复用，设计v1.1定义有效text/file与原生wrapper，不追踪内部parts |
| P1 自家控制拒绝错误迟到影响新请求 | terra | 采纳 | routes/session.ts:853确实另行发布session.error；随机token只识别自家拒绝并短期回收，新增迟到错误回归 |
| P1 多插件transform共享输出与最终请求不等价 | terra | 部分 | plugin/index.ts:243–250核实；声明检查点与加载顺序边界，检测歧义放行、测试前后置变换；不追求无法公开观测的最终provider集合 |
| P2 空/跨会话transform不能保留旧gate和压缩标记 | sol/astra/terra | 采纳 | 歧义同步清空关联/标记/恢复，后续明确transform重建；明确代价为漏拦 |
| P2 idle事件先于status map删除 | terra/5.6-sol | 采纳 | 延迟75ms执行一次检查，缺省status视idle；不做无限重试 |
| P2 noReply限制必须在独立设计与文档可见 | 5.6-sol | 采纳 | 设计v1.1明确保留autoResume:false建议，公开hook缺字段是已知边界 |
| P2 ≤200行统计可执行化 | 5.6-sol | 采纳 | state.test加入AST+scanner固定统计断言，npm test登记已覆盖，避免新生产抽象，宿主人工复核长行 |

## 结论、未解决项与下一步

无未解决设计P0/P1；G2是明确的小幅设计偏离，由本轮独立意见提出并裁决，不静默删既有正例。其余放弃保证仍见DESIGN。实现未开始，全部行为待Generator与正式verify证明。默认一轮，无P0不增加改善轮；下一步全新Generator按v1.1实现，不自行提交或改内核。
