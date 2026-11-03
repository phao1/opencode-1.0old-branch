未发现 P0。建议先解决以下验收冲突，再进入实现。

1. **P1：明确 G2 的“新于”判据，并处理它与现有真实内核验收的冲突。**

   设计要求最新有效用户消息“新于最新成功 assistant”才恢复，却同时承诺保留 G2 保存时序验收。现有确定性测试专门构造了 **用户消息先分配 ID、后保存** 的情况，并明确断言 `guide.info.id < assistant.info.id`；插件开启时仍要求自动 continuation。如果“新于”按 ID 或创建时间判断，新设计必然拒绝这个既有正例。

   证据：
   - `docs/oneshot/runs/20261104-0553-steering-v21/DESIGN.md:24`
   - `docs/oneshot/runs/20261104-0553-steering-v21/DESIGN.md:51`
   - `external-plugins/steering/test/kernel.test.mjs:87`
   - `external-plugins/steering/test/kernel.test.mjs:100`
   - `external-plugins/steering/test/kernel.test.mjs:104`

   建议优先遵循本轮简化原则：明确采用的排序字段，将这个旧 ID 晚保存场景标为有意放弃的自动恢复保证，改为验证“不自动恢复、不永久拦截、后续真实输入正常”；另外增加**最后一次 loop 读取之后、idle 之前保存新插话**的确定性测试，证明缩小后的 G2 确实成立。若仍要求旧正例继续通过，则必须重新设计恢复资格判据，并说明新增复杂度。不能只删除旧断言后宣称“G2 继续通过”。

2. **P2：把无法确定 session 的 transform 写成明确的状态失效规则。**

   当前 `prepare` 仅写“歧义放行且不创关联”，但 `gate` 依据已有 Active 和非空 pending 拦截。如果实现遇到空消息列表或混合 session 时直接返回，旧请求的 pending 仍可能被用于拦截新请求，违反“不确定一律放行”。公开 transform 输入没有 sessionID，不能依靠调用参数补回归属。

   证据：
   - `docs/oneshot/runs/20261104-0553-steering-v21/DESIGN.md:46`
   - `docs/oneshot/runs/20261104-0553-steering-v21/DESIGN.md:48`
   - `agent-kernel/packages/opencode/src/session/prompt.ts:1499`
   - `agent-kernel/packages/opencode/src/plugin/index.ts:250`：各插件依次修改同一个 output。

   建议明确：出现归属歧义时，使可能受影响的旧请求 gate 资格失效；完全无法定位会话时，保守使全部现有 gate 资格失效，等待各会话下一次可识别 transform 重建。代价是可能漏拦，符合本轮取舍。补充“已有 pending → 空/混合 session transform → 普通工具放行 → 正常 transform 恢复请求关联”的单测，避免只测试空状态下的歧义输入。

本次仅进行了只读设计与源码核对，覆盖原始及本轮需求、需求分析、仓库约束、前 run 两轮评审汇总、现有插件与测试，以及固定版本的请求、压缩、工具和生命周期路径；未修改文件或运行测试。