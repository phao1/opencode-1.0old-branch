# Generator 实施报告 — Steering v2.1

版本 v1.1；日期 2026-11-04；实施设计 DESIGN v1.1；累计基准 586505b2160b7428300ae5df4efb40d3e67dbce1。

## 修改范围

- `external-plugins/steering/src/state.ts`：重写为当前请求作用域；只记录忙碌请求后有效输入及原有效 part ID，删除历史指纹、assistant/callID 快照、摘要覆盖和容量拒绝。所有同步 hook 状态过渡先于 await；未知/歧义/摘要 fail-open。
- `external-plugins/steering/src/index.ts`：保持唯一函数导出与公开 hooks，更新 status 描述。
- `external-plugins/steering/test/state.test.mjs`：20 项新契约行为回归，SDK spy、350 普通完整回合、129取消会话、并发task、压缩/编辑/保存失败、G2所有异步等待取消、控制错误token及可执行规模检查。
- `external-plugins/steering/test/kernel.test.mjs`：保留13项真实官方内核对照和原 G2 双屏障正例；慢保存新transform消费缺席ID，摘要/连续压缩/overflow不再要求提醒传递。
- `scripts/steering-v2-demo.mjs`：新增不暂扣响应的 natural TUI，运行中直接输入；每个工具sleep8后写文件；已有目录先归档；保留失败消息和可归档内核日志。
- `external-plugins/steering/package.json`、包 README、`CHANGELOG.md`：包升0.5.0，公开声明语义变化和移除的v2.0保证。
- `docs/baseline/STEERING.md`、`SPEC.md`、`DESIGN.md`：同步v2.1，旧v2.0清楚标历史；新增本run README及本轮实施证据。

累计基准diff另含宿主预先写入的REQUIREMENT/DESIGN/brainstorm/improve；本Generator未改这些文件。

无内核 tracked 改动、无私有 import、无其他run/skill变更、无 commit/checkout/stash/reset/push/merge/发布。未调用 one-shot 宿主、未递归启动 Generator、未进行自评审。

## 验收映射

| ID | 实施验证 |
| --- | --- |
| A1 | 350普通完整回合与129取消session SDK调用为零，不建空闲输入历史、不抛容量异常；空白/ignored/synthetic/file-only、跨会话/重启回归。 |
| A2 | 并发bash/task拦截，status和所有prt_豁免，未知/跨会话放行；官方同响应多工具开关对照与原生SubtaskPart完成。 |
| A3 | 有效同ID普通请求一次提醒、原附件不变；缺席/空编辑/换ID丢弃；单次/连续压缩摘要不gate不加提醒；官方summarize/overflow执行当前工具成功。 |
| A4 | 单history读取、最后非摘要assistant成功和parent用户位置边界、继承字段/省略tools；失败/超时/慢保存、各await期间取消、双通知、失效控制token回归；保留官方原G2 ID更小的late-save正例与关闭对照。 |
| A5 | 无插话常态请求/工具/stream/status不调history；普通回合无session SDK；查询失败后输入/新请求工具正常；官方无插话开关对照。 |
| A6 | 新契约覆盖前run所有列举反例，均释放/消费旧pending并允许普通输入/工具；aggregate autoResume:false与空cache离线实际安装通过。 |
| A7 | observed/absorbed/blocked/continuing尽力toast，offline不影响gate；status只给请求/pending/recovery，provider/adopted unknown；真实TUI证据见下。 |
| A8 | state.ts 146 + index.ts 17 = **163**有效行，AST删除纯类型声明/import type，scanner去注释，再计非空物理行；混合类型/执行行计入。仅静态提醒字符串超过180字符，无多语句超长行规避。类型、根回归、独立构建/实际离线安装/installed内核验证及边界通过。 |
| A9 | 三组真实模型开关对照见下方执行结果及证据索引。自然模式不创建响应屏障。 |
| A10 | 包README/baseline三文档/本run索引已同步，明确后置插件、noReply须autoResume:false、慢保存可能漏拦、无原子取消或语义采纳承诺。 |

## API核对

[固定内核精确位置记录](evidence/kernel-api.md)。compaction.ts:184–185 compacting 先于221 transform；同session串行loop在prompt.ts:1499 transform后等待1510–1526 process，1559–1569才进入下一轮；runner.ts:111–135 Running只join既有Deferred。G2使用session/index.ts:595–599公开history返回顺序与parent用户边界，不比较user/assistant ID大小。

## 执行命令与结果

前5条按 DESIGN 顺序运行，全部exit 0：

1. `node_modules/.bin/tsc --noEmit -p .` — 通过，[日志](evidence/typecheck-root.txt)。
2. `node_modules/.bin/tsc --noEmit -p external-plugins/steering` — 通过，[日志](evidence/typecheck-package.txt)。
3. `npm test` — 102/102，通过，[完整日志](evidence/npm-test.txt)。
4. `node scripts/check-kernel.mjs` — 固定提交且tracked文件干净，[日志](evidence/kernel-boundary.txt)。
5. `node scripts/verify-steering.mjs` — 33/33，通过；0.5.0构建、npm pack、全新空cache离线安装、精确字节/sole export/可选peer检查，再由安装入口跑13项官方内核用例，[日志](evidence/verify-steering.txt)、[包报告](evidence/package-report.json)、[13项原始证据索引](evidence/installed-kernel-index.json)。
6. `node scripts/steering-v2-demo.mjs --out docs/oneshot/runs/20261104-0553-steering-v21/verify/evidence/headless` — exit0，开/关均通过，各4请求；关闭写出obsolete.md，开启原生tool-error含STEERING_STALE_CONTEXT且文件未写，均保留checkpoint.md；开启SUMMARY明确跳过原因。[报告](../../verify/evidence/headless/report.json)。
7. `node scripts/steering-v2-demo.mjs --tui --out docs/oneshot/runs/20261104-0553-steering-v21/verify/evidence/tui` — exit0，开/关均通过，各4请求；关闭写出obsolete，开启1次旧工具拒绝且不写obsolete。真实TUI显示Guidance observed toast和STEERING_STALE_CONTEXT工具错误，完成总结说明跳过原因。[报告](../../verify/evidence/tui/report.json)、[toast屏幕](../../verify/evidence/tui/enabled/guidance-submitted.txt)、[完成屏幕](../../verify/evidence/tui/enabled/completed.txt)。
8. `node scripts/steering-v2-demo.mjs --natural --tui --out docs/oneshot/runs/20261104-0553-steering-v21/verify/evidence/natural-tui` — exit0，开/关均通过，各3请求。没有任何响应屏障，两边均自然采纳并跳过obsolete；不宣称拦截差异。关闭/开启的首工具实际运行8008ms/8005ms，插话创建分别晚于工具start 73ms/57ms，且在end之前。[报告](../../verify/evidence/natural-tui/report.json)、[关闭屏幕](../../verify/evidence/natural-tui/disabled/guidance-submitted.txt)、[开启屏幕](../../verify/evidence/natural-tui/enabled/guidance-submitted.txt)。

三组6例原始消息的工具时间、插话时间、请求数、拒绝数和文件结果另见[汇总JSON](evidence/real-evidence-summary.json)。每例完整模型HTTP请求、原响应decision/usage、Codex JSONL、原生messages、文件、TUI屏幕、内核日志和报告均在verify/evidence对应目录。临时XDG数据库/cache在本机kernel子目录保留并由每例.gitignore排除，完整日志另导出kernel-log.txt。

最终额外检查：`node --test external-plugins/steering/test/state.test.mjs` 20/20；`node --check scripts/steering-v2-demo.mjs`、`git diff --check`通过。命令日志以.txt副本保留，避免根*.log忽略规则丢失证据。

## 偏离、阻塞与限制

无剩余阻塞。A1–A10实施检查均有通过证据，正式独立评审仍由宿主/Evaluator执行。未引入未经宿主裁决的设计偏离。G2按设计v1.1已裁决的parent边界保留正例。部分保存编辑通过有效原part ID保守删除整条pending，可能漏拦但不阻塞。

已知公开限制：保存晚于单次history检查不恢复；摘要/overflow换ID/过滤/进程重启会漏拦；后置插件可改变最终provider集合；活动noReply必须autoResume:false；取消/dispatch/save无原子事务；已过gate工具、batch内部、StructuredOutput、native prt_、运行中子代理转发不受G1覆盖；provider/adopted均unknown。

初始调试遇到Node strip-only不支持参数属性、TS7 AST入口不同和慢保存断言误含历史工具错误，均已改正。一次后续类型检查发现可选链未收窄Recovery，已修正并复跑。首轮通过日志保存在evidence/initial；最终结果以本报告下方命令为准，不复用旧run产物。

Host recovery note: restored from Generator events after case-insensitive REPORT.md/report.md collision. Final CLI output remains in report.md.
