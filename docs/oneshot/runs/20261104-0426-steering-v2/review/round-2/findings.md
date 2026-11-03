# Round 2 accepted fixes — DESIGN v1.4

继续原 Generator，仍不 commit、不改 kernel、不启动 agent/host。达到 review 两轮上限，本轮修复必须有客观回归与完整报告，不能留下 P0/P1 后声称通过。HOST-EVIDENCE.md 有独立复现。

1. **P1 连续压缩覆盖传递**（6.1-sol/astra/5.6-sol）：新摘要包含旧 summaryID，应继承它覆盖的当前内容版本，成功后替换 summaryID；未包含/版本已改/失败不继承。测三次连续压缩、失败第二次、晚到新指导不被继承。不要建无限 lineage graph。
2. **P1 overflow replay 新 ID**（6.1-sol）：内核 compaction.ts:167 排除 latest guide，:288 重放新 user/part ID。当前按旧 ID 永久 stale。结合有界当前压缩窗口与严格内容/元数据匹配确认 native replay，只有真实请求含其有效内容才绑定旧指导版本 prepared。避免任意同文历史误认，支持普通文本/文本附件，媒体转换按固定源码实际规则测试或明确限制。优先增真内核脚本 provider context-overflow→summary→replay→工具路径；不可改 kernel。
3. **P1 G3 压缩链缺提示**（5.6-sol，部分采纳）：给压缩请求与仅含覆盖摘要的后续请求均加入 latest-priority/保留完成结果/报告跳过动作的明确提示；抓实际 provider body 验证。不能保证摘要语义保留，继续 unknown；不因这一限制拒绝可做的静态提示，也不全量重注大附件破坏 compaction。
4. **P2 已保存指导编辑为空**（astra/5.6-sol）：与新候选尚无 parts 分开，已确认公开更新/历史校准证明无有效内容时不再 gate/恢复；仍观察期间从空白恢复有效内容应重新阻断旧 snapshot。测 whitespace/ignored/synthetic 及恢复，保留 info-only/slow-save 回归。
5. **P2 取消/失败会话全局容量泄漏**（terra/6.1-sol/5.6-sol）：安全 idle 且无运行/permit 的终止会话可清理/淘汰；128 次取消/失败不阻断新会话。保留 active/pending 的安全上限，增加 cancelled 与 failed 的 >128 回归。
6. **P2 空 npm cache 离线安装失败**（host）：public plugin 类型依赖运行时已擦除，将精确 peer 标 optional 或同等最小方式避免离线取 registry。scripts/package-steering.mjs 的 install 用全新空 cache，必须真实 npm pack/install/import 成功，并保持 exact dev/peer 1.3.17。补 README 说明 optional peer 是类型/host 兼容约束，不把包运行依赖外置化。

运行新增测试、根/包类型、构建、根回归、干净离线安装及安装产物真内核测试；完整登记 verify（含真实 headless/TUI）由宿主执行。若自己演示必须新输出目录，不能污染已有证据。同步当前 docs/README 行为与限制，不改旧轮原始评审。最终答复给完整修改与验证结果，自动写 impl/round-3/report.md。
