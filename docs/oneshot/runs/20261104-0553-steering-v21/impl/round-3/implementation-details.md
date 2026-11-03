# Generator 修复报告 — round 3

版本 v1.0；日期 2026-11-04。唯一实施设计 DESIGN v1.2；修复依据 [review round 1 findings](../../review/round-1/findings.md)；累计基准 586505b2160b7428300ae5df4efb40d3e67dbce1。

## 本轮修改文件

- `external-plugins/steering/src/state.ts`：已知普通/摘要请求均观察有效输入并可摘取idle恢复候选；ordinary仅控制gate/本次提醒。恢复检查历史最后assistant（含summary），要求成功并使用其parent用户位置。候选part更新在active删除后也同步失效recovering。增加按session关联的本进程签发key短期Map，派发30秒后回收；未知/缺失/跨session/过期key按synthetic普通路径放行，已签发失效控制保留随机错误token拒绝。许可仍5秒到期。
- `external-plugins/steering/test/state.test.mjs`：新增6项回归，覆盖摘要观察、summary parent及失败/未完成边界、普通消费仅一次提醒、messages/status/get等待编辑、控制get/status保存检查编辑、未知/跨session/已签发旧控制、签发记录过期；保留原G2正例，更新不再有效的“summary一律不可恢复”旧断言。
- `external-plugins/steering/test/kernel.test.mjs`：companion增加可选公开compacting屏障，新增2项真实官方开/关用例；严格构造trigger分配→compacting暂停→guide分配并暂扣保存→summary请求/assistant分配→保存guide→成功idle。开启插件有一次续接，关闭停住，普通续接工具完成。
- 包 `README.md`、`docs/baseline/STEERING.md`、`SPEC.md`、`DESIGN.md`：同步摘要观察、最后assistant含summary、恢复编辑边界、无关删除保守放弃及30秒签发身份边界。包版本保持尚未发布的0.5.0，没有无关版本/依赖改动。
- 本run `README.md`、本报告及 `impl/round-3/evidence/`：增加本轮索引、失败复现与修复后证据；round 2与review原始证据不改写。

累计diff仍包含round 2实现和宿主预先更新的run设计，本轮未编辑run DESIGN、内核、skill、其他run或demo脚本。没有commit/checkout/stash/reset/push/merge/发布，没有启动one-shot宿主或递归Generator，没有自评审。

## 验收与修复结果

| ID | 本轮结果与证据 |
| --- | --- |
| A1 | 摘要请求仍登记transform后有效插话；新增摘要观察、unknown marker/key放行和跨session单测。350普通回合/129取消会话/无容量拒绝等原回归保留。 |
| A2 | ordinary仅控制gate，摘要期间即使pending非空也放行工具。原G1多工具、普通task、native prt_等官方回归通过。 |
| A3 | 摘要不附G3，摘要期间新指导在后续普通transform仅消费一次。官方summary请求无指导/提醒；G2普通续接实际provider含指导且仅一个提醒，下一工具轮不新增提醒。G2控制中保存的同一个提醒文本可继续出现在原生历史，未额外追加。 |
| A4 | 已采纳3项修复全部有先失败后通过回归；last summary成功/失败/未完成及trigger前候选单测；messages/status/get等待与control get/status检查期间empty/ignored/synthetic编辑都使许可失效；unknown/expired/cross-session key无验证SDK查询、无输入异常；本进程签发旧控制在有效签发记录窗口内可拒绝。原普通请求G2双屏障正例原样保留通过，新增摘要G2官方开关通过。 |
| A5 | 编辑直接失效许可，不增加history校准；无插话和autoResume:false仍零恢复history。新输入/新transform/工具可继续。 |
| A6 | 新增编辑等待矩阵与失效控制回归均在失效后验证普通输入及工具继续；原压缩/overflow/空编辑/保存中间态/取消/容量/离线安装反例全部随根回归通过。无关删除仍保守放弃恢复，已明确为接受的best-effort限制。 |
| A7 | status/provider/adopted/toast行为未扩展，离线toast与简洁status回归通过；本轮不重跑真实TUI，旧屏幕保持历史。 |
| A8 | TypeScript AST去纯类型声明/import type，scanner去注释，再计非空物理行：state.ts **155**，index.ts **17**，合计 **172≤200**；混合类型/执行行计入。类型、构建、根110项、安装验证41项及内核边界通过；其中15个官方内核用例确实使用本次安装入口。 |
| A9 | 按修复指令“无需重跑三组真实模型演示（宿主正式 verify 会完整执行）”，本轮没有执行三组demo，没有把round 2模型证据声明为新代码验证。由宿主正式verify完整复跑。 |
| A10 | 包README、baseline三文档及run索引已同步v1.2与上述边界，保留活动noReply须autoResume:false、非原子取消、未知provider/adopted和后置插件限制。 |

## 先失败后通过的证据

- `node --test --test-name-pattern='R3-' external-plugins/steering/test/state.test.mjs`：修复前6/6新用例失败，明确复现摘要丢弃、恢复编辑失效遗漏及公开标记误拒绝。[原始结果](evidence/unit-before.txt)。
- `node --test --test-name-pattern='R3-P1' external-plugins/steering/test/kernel.test.mjs`：修复前关闭通过，开启停在摘要idle后，无自动续接，1/2失败。[原始结果](evidence/kernel-before.txt)。修复后2/2通过，[结果](evidence/kernel-after.txt)。
- [4个focused官方fixture索引](evidence/focused-kernel-index.json)：case 01/02修复前，03/04修复后，包含requests/native messages/内核日志/公开配置。
- [summary parent证明](evidence/summary-parent-proof.json)：真实IDs满足trigger < guide < summary，summary.parentID=trigger；4个实际provider请求的指导存在性为`false,false,true,true`，提醒数为`0,0,1,1`。单次continuation后当前工具成功，无重复控制。
- [固定API精确源码核对](evidence/kernel-api.md)：公开compacting/transform、原生消息分配/过滤、summarize HTTP和promptAsync错误事件顺序，无私有import或tracked内核改动。

## 执行命令与结果

以下最终检查均exit 0：

1. `node_modules/.bin/tsc --noEmit -p .` — [根类型日志](evidence/typecheck-root.txt)。
2. `node_modules/.bin/tsc --noEmit -p external-plugins/steering` — [独立包类型日志](evidence/typecheck-package.txt)。
3. `npm test` — **110/110**，含全部15项真实官方内核用例及26项Steering单测。[完整结果](evidence/npm-test.txt)。
4. `node scripts/check-kernel.mjs` — 固定517e6c9aa且tracked文件干净。[日志](evidence/kernel-boundary.txt)。
5. `node scripts/verify-steering.mjs` — **41/41**（26项源码单测+15项使用安装入口的真实官方内核测试）；重新构建/pack/全新空cache离线安装、归档/安装字节一致、唯一函数导出、可选精确peer未安装均通过。[结果](evidence/verify-steering.txt)、[包报告及SHA](evidence/package-report.json)、[15项安装内核原始证据索引](evidence/installed-kernel-index.json)。
6. `/Users/penghao/.bun/bin/bun run --cwd external-plugins build` — 聚合入口Bundled 86 modules。[结果](evidence/aggregate-build.txt)。
7. `node --test external-plugins/steering/test/state.test.mjs` — **26/26**，[单测结果](evidence/unit-after.txt)。
8. `git diff --check` — 通过。

[机器可读汇总](evidence/verification-results.json)。本轮只运行一次最终installed verify，无失败复验；未写宿主verify RESULT或修改既有模型证据。

## 偏离、阻塞与限制

没有新增设计偏离或剩余实现阻塞。v1.2优先裁决覆盖v1.1旧“普通请求才观察/非摘要assistant”字面规则，本轮未扩大范围。正式独立评审与真实模型复验仍由宿主执行，Generator不作正式评审结论。

恢复候选任一part更新可保守放弃，任何同session消息/part删除（含无关删除）也可放弃一次G2；不额外区分删除历史、不查询校准、不阻止后续输入或工具。签发记录30秒到期后key未知即放行，因此晚到控制可能不再被识别为可拒绝的自家控制；这是有限记录与非原子取消边界。原有慢保存晚于单次history检查、过滤/overflow换ID/重启漏拦、后置插件变化、活动noReply、已过gate工具/StructuredOutput/batch/native prt_等限制继续有效。

变更记录：2026-11-04，按DESIGN v1.2及review round 1采纳项完成三处修复，补充六项单测和两项官方压缩双屏障回归。

Host recovery note: restored from Generator events after case-insensitive REPORT.md/report.md collision. Final CLI output remains in report.md.
