# Generator round 4 实施详情

版本 v1.0，日期 2026-11-04。本轮按 DESIGN v1.3 和 review round 2 采纳的 P2 修复。累计基准 commit 为 586505b2160b7428300ae5df4efb40d3e67dbce1。[设计](../../DESIGN.md) [修复意见](../../review/round-2/findings.md)

## 修改文件

- `external-plugins/steering/src/state.ts` 在首次明确 transform 中先捕获现有 recovery，再同步失效许可。普通请求将 recovery.pending 和 active.pending 的有效 user ID 一起匹配，仅向本次输出附加 G3。G2 控制文本保存原指导 ID 及简短的重新读取继续要求。
- `external-plugins/steering/test/state.test.mjs` 新增三项行为回归，验证控制保存内容、恢复候选首次消费、缺席或编辑无效、取消和过期、未知候选、摘要边界、后续普通输入与工具。
- `external-plugins/steering/test/kernel.test.mjs` 扩充原普通 G2 和摘要 G2 官方开关正例。实际 provider 的首次恢复请求含一个提醒，下一工具轮为零，原生控制消息中提醒数为零。普通 G2 还通过后续普通消息和文件写入验证可用性。
- 包 `README.md`、`docs/baseline/STEERING.md`、`SPEC.md`、`DESIGN.md` 更新当前 DESIGN v1.3 链接及一次性 G3 语义。
- 本 run `README.md`、`impl/round-4/report.md`、本文件和 `evidence/` 索引本轮实现与验证。

本轮生产改动集中于捕获恢复候选、匹配候选 ID 和缩短控制文本。恢复匹配复用现有候选 Set。累计 diff 中其他实现和宿主设计变更的来源见各轮报告。

## 失败到通过

| 检查 | 修复前 | 修复后 |
| --- | --- | --- |
| 新单测 | 3 项中 1 项失败，已保存控制包含 `[Steering reminder]` | 全部 29 项单测通过，保存控制和原生消息均无完整提醒，首次 transform 一次，下一次零次 |
| 普通官方 G2 | 开启插件的 provider 提醒计数为 `[0,1,1]`，下一工具轮仍有提醒 | 开启插件为 `[0,1,0,0,0]`，包含后续普通消息和工具。关闭插件为 `[0,0,0]` |
| 摘要官方 G2 | 开启插件的 provider 提醒计数为 `[0,0,1,1]` | 开启插件为 `[0,0,1,0]`。关闭插件为 `[0,0]` |
| 已保存控制 | 两个开启用例均包含完整 G3 | 两个开启用例均仅保存引用 ID 的简短续接要求 |

原始失败与修复后日志、实际请求、原生消息和内核日志均存入本轮目录。[单测失败](evidence/unit-before.txt) [单测通过](evidence/unit-after.txt) [官方内核失败](evidence/kernel-before.txt) [官方内核通过](evidence/kernel-after.txt) [修复前原始证据](evidence/before-kernel-index.json) [修复后原始证据](evidence/after-kernel-index.json)

## 验收 ID 对应结果

| ID | 本轮实施验证 |
| --- | --- |
| A1 | 原忙碌观察、摘要观察、350 普通回合、129 取消会话及有效输入回归通过 |
| A2 | 原普通工具、task、native prt_、status、跨会话及摘要 gate 回归通过。G2 续接和后续普通输入的当前工具完成文件写入 |
| A3 | 首个普通 transform 使用现有恢复候选做有效 ID 匹配，临时附加一次后消费。缺席、空白、ignored、synthetic、错误 role、重放新 ID 均消费且后续恢复内容不会补发提醒。取消、过期、编辑失效、未知候选及摘要保持各自边界 |
| A4 | 原普通 G2 与摘要 G2 官方开关正例均通过。保存的控制只引用原指导 ID。模型、agent、system、variant、format 继承和 tools 省略回归通过。各 await 的取消与编辑、许可复核、签发身份及错误 token 回归通过 |
| A5 | 首次恢复 transform 复用 Map/Set 同步匹配。SDK spy 验证单次 history。普通请求、gate、streaming、status 和 autoResume:false 的现有调用计数断言通过 |
| A6 | 全部原保存、编辑、压缩、overflow、历史异常、并发 task、容量和离线安装回归通过。新增单测及官方普通 G2 用例验证后续输入和工具继续可用 |
| A7 | 原 toast 和简洁 status 回归通过，provider/adopted 继续标记 unknown |
| A8 | state.ts 157 行加 index.ts 17 行，共 174 有效生产行。类型、根回归、独立打包与空 cache 离线安装、实际安装入口官方测试、聚合构建及内核边界通过 |
| A9 | 修复意见将三组真实模型演示交由宿主正式 verify。现有模型证据属于各自生成轮次，本轮完成确定性官方内核验证 |
| A10 | 包 README、baseline 三文档及 run 索引同步 DESIGN v1.3，明确恢复 G3 的临时单次注入及候选失效边界 |

有效行数由测试中的 TypeScript AST 排除纯类型声明和 import type，再由 scanner 去注释，最后统计非空物理行。混合类型与执行语句的行参与计数。[统计输出](evidence/unit-after.txt)

## 执行命令与结果

1. `node --test --test-name-pattern='R4/' external-plugins/steering/test/state.test.mjs` 修复前退出 1，复现控制持久化提醒。[日志](evidence/unit-before.txt)
2. `node --test --test-name-pattern='late-save native-ID double barrier|summary-period late save' external-plugins/steering/test/kernel.test.mjs` 修复前两项开启用例失败，修复后 4/4 通过。[失败日志](evidence/kernel-before.txt) [通过日志](evidence/kernel-after.txt)
3. `node --test external-plugins/steering/test/state.test.mjs` 29/29，通过。[日志](evidence/unit-after.txt)
4. `node_modules/.bin/tsc --noEmit -p .` 退出 0。[日志](evidence/typecheck-root.txt)
5. `node_modules/.bin/tsc --noEmit -p external-plugins/steering` 退出 0。[日志](evidence/typecheck-package.txt)
6. `npm test` 113/113，通过，包含全部 15 项真实官方内核测试。[日志](evidence/npm-test.txt)
7. `node scripts/check-kernel.mjs` 退出 0，固定 commit 为 517e6c9aa4c61dbc125e7654fc596f1d529f20d9，tracked 文件干净。[日志](evidence/kernel-boundary.txt)
8. `node scripts/verify-steering.mjs` 44/44，通过。其中 29 项为源码单测，15 项真实官方内核测试使用实际安装入口。空 cache 离线安装、精确 peer、唯一函数导出、归档和安装字节检查均通过。[日志](evidence/verify-steering.txt) [包报告](evidence/package-report.json) [实际安装内核证据索引](evidence/installed-kernel-index.json)
9. `/Users/penghao/.bun/bin/bun run --cwd external-plugins build` 退出 0，聚合入口构建通过。[日志](evidence/aggregate-build.txt)
10. `git diff --check` 退出 0。[日志](evidence/diff-check.txt)

首次安装验证通过 44 项后，检查发现包 README 缺少源文件最后补入的 DESIGN v1.3 链接，因此重新打包并运行完整安装验证。首次日志与包报告归档在本轮 initial-install 目录，最终包 README 与源文件逐字节核对。[首次安装结果](evidence/initial-install/verify-steering.txt)

## 偏离、阻塞与已知限制

本轮设计偏离与剩余实现阻塞均为空。宿主负责正式 verify 与交付判断。

恢复候选在首次明确 transform 中即消费，内容缺席、编辑失效或已过期时，后续请求只能通过新的有效输入重新建立 pending。模型最终语义采纳、后置插件改写、活动 noReply、原子取消、已开始工具、batch 内部及 StructuredOutput 仍受公开 API 边界约束。任何同会话消息或 part 删除可保守放弃 G2。签发 key 的短期识别窗口和许可复核沿用 DESIGN v1.3 约定。

变更记录 2026-11-04，修复 review round 2 采纳的 G2 持久化 G3 问题。恢复请求中的 G3 改为检查点临时注入，官方 provider 验证一次后归零。
