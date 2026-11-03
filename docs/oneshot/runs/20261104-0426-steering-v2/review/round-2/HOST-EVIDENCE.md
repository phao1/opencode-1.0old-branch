# 第二轮宿主验证

日期：2026-11-04。以下是 host 的独立核对，不冒充 Evaluator。

- `node .codeagent/steering-v2-host-round2-state-proofs.mjs`：首次摘要后的工具通过，未经过 idle 的第二次摘要后工具报 STEERING_STALE_CONTEXT，旧指导 m04 仍绑定首份 summary；同脚本把已保存 m04 文本改为空，再创建包含新输入的新请求，工具仍因旧 m04 被拒绝。支持连续摘要 P1、空编辑 P2。
- `node .codeagent/steering-v2-host-overflow-proof.mjs`：模拟固定源码实际公开事件/消息形状：已观察旧指导未 prepared，摘要不含它，内核新 ID user/parts 重放原文，新请求明确含重放文本。输出 REPLAY_TEXT_PRESENT true，工具仍报旧 m04 stale。核对 compaction.ts:167-180、:288-313 的真实路径，支持 overflow P1。
- G3 源码核对：state.ts:145-153 的 compaction transform 直接 return，:178-180 仅设置覆盖，没有 priority reminder；compact() 已令 eligible=false，后续普通请求也不会选中这些指导追加 reminder。采纳提示覆盖修复；不要求外置 hook 证明摘要语义保留，这仍是 provider/adopted unknown 的限制。
- `node .codeagent/steering-v2-host-cancel-capacity.mjs`：128 个不同会话各保存/准备一次输入，再收到 MessageAbortedError 和 idle；第 129 会话保存前抛 STEERING_CAPACITY。支持取消容量 P2。
- 用全新 install prefix 和全新空 npm cache 执行 `npm install --cache <empty> --offline --ignore-scripts <当前0.4.0.tgz>`，实际退出 1，ENOTCACHED，尝试获取 @opencode-ai/plugin peer。fixture `.codeagent/steering-v2-empty-cache-zYdvUu`。此前默认 npm cache 已有公共 plugin，掩盖该离线安装缺陷。类型 import 擦除，bundle 已打入 runtime 依赖，optional peer + 空 cache 验证是允许的最小路径。

首轮七项均已关闭，见 impl/round-2 与 verify（10 checks PASS）。本轮发现修复前仍未关闭；两轮上限已达到，不执行第三轮 fanout，不把 host 验证冒充独立 approve。

## 最终修复后的宿主独立复核（正式 verify 前）

- 再跑 round2-state-proofs，输出 FIRST_SUMMARY_TOOL_ADMITTED、SECOND_SUMMARY_TOOL_ADMITTED、EMPTY_EDIT_TOOL_ADMITTED；相同公共 hook 复现已不再误拦。
- 再跑 cancel-capacity，128 个终止会话后输出 NEW_SESSION_ADMITTED。
- 在额外全新 install prefix/cache 中离线安装当前 tgz，added 1 package，退出 0；fixture .codeagent/steering-v2-empty-cache-fixed-0Zb5Sg。
- 核对最终状态机：连续 coverage 仅在成功且版本未改时传播；原生 overflow replay 要求当前 overflow compaction 控制、正确成功摘要、紧邻原生新消息、精确去 ID 内容/元数据、实际请求包含，单窗口消费；媒体占位明确 mediaStripped。摘要链的 G3 reminder 传播与普通 prepared 分层。
- overflow 与三次摘要/G3 的官方内核原始 provider/消息/工具证据由 impl/round-3/evidence 的索引提供；正式 verify 将重跑其完整测试集合。
- 最终 Generator 报告：新包 62/62、根 131/131、安装产物 13 项真内核；旧正式 verify 归档 verify-before-review2-fix 和 .codeagent/steering-v2-verify2-{headless,tui}。尚待最后完整 verify，不提前标记 review/deliver 完成。

最终正式 verify 已全部 PASS；最终测试数新包/安装入口集合各 62，根 131，其中真实官方内核 13 项；真实模型 headless/TUI 四组启停对照通过。最终原始证据索引 verify/evidence/real-evidence-index.json，raw 文件保留 .codeagent/steering-v2-demo-{headless,tui}。
