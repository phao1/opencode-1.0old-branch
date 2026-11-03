# 需求：steering v2.1 —— 按验收意见返工为 fail-open、按请求作用域的语义

上一轮：`docs/oneshot/runs/20261104-0426-steering-v2/`（brainstorm→design→improve→impl×3→verify→review×2→deliver 已跑完，提交 c8c19bbe1..586505b21；最终 `external-plugins/steering/src/state.ts` 438 行，第 1 轮 322 行）。
v2.0 的 G1/G2/G3/G4 用户可见行为（真实模型 headless + TUI 对照）是对的，**本轮不改变产品目标与硬约束**（见上一轮 REQUIREMENT.md，全部继续有效）。
本轮由 Planner/验收人打回：两轮对抗 review 一共报出 10+ 个 P1/P2，它们有共同根因，继续逐个打补丁会让状态机越来越复杂（v2.0 已出现 summaryID 覆盖传递等补丁），因此在**设计层**返工。

## 验收人发现的根因
1. **fail-closed 语义**：v2.0 把"本进程见过的所有用户输入"都当作 gate 的比对对象，任何无法确认（快照缺失、历史查询失败/超时、压缩过滤、overflow 重放换 ID、编辑为空、保存中间态）都会导致工具被拦，且常常是永久拦截。这把一个"尽力而为的优化"（拦截旧决定）变成了可用性风险。
2. **追踪全部历史**：普通（非插话）输入也进入 guides 且不回收 → 容量上限 → 在 `chat.message` 抛错，导致用户无法发消息（review r1/r2 的 256/128 容量问题）。
3. **热路径读全量历史**：`prepare()` 每次 LLM 请求都调用 `session.messages`，即使从未插话。
4. **提示重复**：已吸收的插话之后每一轮请求都会再次附加 steering reminder。
5. **演示只有人工屏障场景**：缺少"不暂扣模型决定、自然时序下插话被吸收"的真实演示。

## 必须采用的设计原则（宿主可细化，偏离须在 design 写明理由并经 improve 评审）
- **fail-open**：只有在**确定**某个工具调用来自"构造时没包含某条插话的那次请求"时才拦截；任何不确定一律放行（= 原生 1.3.17 行为，模型下一轮仍会通过原生 system-reminder 看到插话）。插件永远不能让会话比没装插件时更"不可用"。
- **按请求作用域**：同一会话的 loop 是串行的，`tool.execute.before` 触发时，该工具调用必然属于该会话**最近一次** `experimental.chat.messages.transform` 对应的请求（需宿主对照 prompt.ts/processor.ts 核实这一点并写进 design）。因此不需要 callID→assistant 映射，也不需要读历史。
- **只追踪插话**：只有在会话忙碌（本插件见过该会话的 transform 且尚未 idle）时 `chat.message` 观察到的有效输入才登记为 pending 插话；idle、错误、取消、删除时清空该会话的状态 → 内存天然有界，不需要容量上限，`chat.message` 永不因容量抛错。
- **解除规则**：每次 transform 时，被本次请求包含（按 message id）的 pending 插话标记为已吸收（只在这一次附加 G3 reminder）；在本次 transform 之前就已登记、却不在本次请求里的插话（压缩/重放/保存失败等）直接丢弃（fail-open）。压缩请求（`experimental.session.compacting` 之后的那次 transform）不拦截、不附加提示。
- **原生 subtask**：内核对原生 subtask 以 `callID: part.id`（`prt_` 前缀）调用 before hook 且不在 catch 内（prompt.ts:604）——这种调用一律放行。
- **G2 完成边界**：仅当本进程在忙碌期间观察到插话、且 idle 时该插话仍未被任何请求包含，才在 idle 后用一次公开 SDK 读取确认（最新用户消息新于最新成功完成的 assistant，且不是用户取消/出错结束），然后最多一次 continuation（可沿用 v2.0 的 synthetic continuation + permit 思路，但要尽量简化）；`autoResume:false` 可关。
- G4：toast 继续保留（观察到/已吸收/已拦截/继续），失败忽略；`steering_status` 返回当前会话的简明状态。
- 生产代码目标 ≤ 200 行（不含类型声明与注释），超出需在 design 说明原因。

## 验收（在上一轮基础上新增/修改）
- 两轮 review 报出的每一个场景都要有回归测试，并统一断言"**不会永久拦截、不会阻止用户发消息**"：单次压缩、连续压缩、overflow 重放换 ID、编辑为空/ignored、保存中间态、慢保存、并发 task、取消 129 个会话、单会话 >300 条普通输入、历史查询失败。能在真实官方内核里复现的用确定性集成测试（脚本化假模型），其余用单元测试。
- G1/G2/G3/A5（无插话行为不变且插件不读历史：用 SDK 调用计数断言）继续通过；真实内核确定性集成测试继续覆盖 G1 多工具、G2 完成边界。
- 演示：保留上一轮的"暂扣真实决定"开/关对照（headless + TUI）；**新增自然时序演示**：真实模型 + tmux TUI，多步任务每步含耗时工具（例如 `sleep 8` 后写文件），在运行中直接输入插话（不暂扣任何模型响应），抓屏显示 agent 吸收插话并改变后续步骤；插件开/关各一次，如实记录两者差异（可能只有提示/拦截差异，不夸大）。
- 文档：包 README、`docs/baseline/STEERING.md`（版本 + 变更记录）同步新语义；在 DESIGN.md 写明与 v2.0 的差异和放弃了哪些"保证"。

## 可复用
上一轮的 `external-plugins/steering/test/kernel.mjs`（真实官方内核 + 隔离 XDG）、脚本化 SSE 假模型、`scripts/steering-v2-demo.mjs`、`scripts/lib/codex-cli-bridge.mjs`、包结构与打包脚本。

