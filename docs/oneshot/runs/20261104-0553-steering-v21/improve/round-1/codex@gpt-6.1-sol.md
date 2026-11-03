建议修改后再进入实现。无 P0；发现 2 项 P1、1 项 P2。

1. **P1：G2 的“新于 assistant”判据会漏掉已有完成边界用例。**  
   设计要求最新有效用户消息“新于最新成功完成 assistant”（`docs/oneshot/runs/20261104-0553-steering-v21/DESIGN.md:24、51`），但没有明确比较对象。用户 ID 和创建时间在保存前分配（`agent-kernel/packages/opencode/src/session/prompt.ts:970`），现有确定性 G2 测试明确断言晚保存指导的 ID **小于**当前 assistant ID（`external-plugins/steering/test/kernel.test.mjs:100`）。若比较消息 ID 或创建时间，本轮会把必须恢复的场景排除。  
   建议明确：以忙碌期间观察且未被 transform 消费的候选为基础，历史查询确认其已保存，并结合最后 assistant 的 `parentID` 判断，而不是要求用户晚于 assistant 自身；保留现有双屏障用例。取舍是增加一条明确的关联规则，无需恢复全历史状态机。

2. **P1：需要明确区分重复 idle 通知与恢复等待期间的新取消。**  
   设计同时要求“idle 只处理一次”和“取消使恢复候选失效”（`docs/oneshot/runs/20261104-0553-steering-v21/DESIGN.md:50–52`），但缺少可执行的事件规则。固定内核在已经 idle 时收到取消，只再次发布 idle，不产生 assistant error（`agent-kernel/packages/opencode/src/session/prompt.ts:144–150`）；每次 idle 又会连续发布 `session.status` 和 `session.idle`（`agent-kernel/packages/opencode/src/session/status.ts:75–78`）。若统一忽略重复 idle，用户在 G2 查询期间取消可能无效；若所有重复 idle 都失效候选，正常恢复又会被第二条通知取消。  
   建议只用 `session.status: idle` 驱动边界、忽略旧 `session.idle`：有 active 时创建候选；无 active 但有候选时，后续新的 status-idle 使其失效。新增“正常双通知仍恢复”和“history/status/get 等待期间取消不派发”的测试。这能处理已观察到的取消，仍保留设计声明的原子性限制。

3. **P2：歧义 transform 的 fail-open 需要包含旧关联失效规则。**  
   prepare 写了“会话歧义放行且不创关联”，gate 则只检查已有普通请求状态和 pending（`docs/oneshot/runs/20261104-0553-steering-v21/DESIGN.md:46、48`）。若歧义分支直接返回，旧的可 gate 状态仍可能存在，此时已经无法证明后续工具属于旧请求。  
   建议明确：无法唯一识别会话的 transform，必须让可能受影响的旧请求关联失效。最简单的保守方案是关闭现存 gate 关联，等待各会话下一次明确 transform 重建；代价是偶尔漏拦，符合 fail-open。补充“已有 pending → 空/混合会话 transform → 工具放行 → 明确 transform 后恢复”的回归。

检查范围包括本轮需求、需求分析、设计、仓库 AGENTS.md、上一轮两轮评审汇总、当前 steering 实现与测试，以及固定内核的 prompt、runner、processor、compaction、事件和取消路径。全程只读，未修改文件或运行写盘测试。