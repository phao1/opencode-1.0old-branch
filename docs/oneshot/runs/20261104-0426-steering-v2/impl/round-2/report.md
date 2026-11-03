已按 DESIGN v1.3 完成本轮七项修复，未调用其他 agent、宿主或递归 Generator，未修改内核、提交或发布。

本轮修改：

- `external-plugins/steering/src/state.ts`：保留 info-only、空 parts 和慢保存候选，移除按 1.5 秒年龄删除的逻辑；并发 gate 等待共享查询；修正压缩生命周期，记录成功 summary 包含的指导版本；成功 idle 后清理 settled 证据，保留 pending/unknown。
- `external-plugins/src/index.ts`：向 SteeringPlugin 转交第二参数，支持聚合入口的 `autoResume:false`。
- `state.test.mjs`、`kernel.test.mjs`：补齐七项修复的回归，包含真实延迟保存、manual summarize、310 次普通串行输入和聚合入口行为。
- 更新包 README、外置插件 README、baseline SPEC/DESIGN/STEERING，以及本轮证据索引；旧轮评审和原始证据未改写。

实现侧验收结果：

| 验收 ID | 本轮结果 |
| --- | --- |
| A1 | 类型、独立/聚合构建、离线安装、唯一导出及安装产物内核测试通过 |
| A2–A4 | 空/慢保存期间旧调用仍拒绝，保存后指导可进入唯一恢复请求 |
| A5–A6 | summarize 后首个普通工具及后续请求成功；失败压缩、后到指导不被错误退役 |
| A7 | 并发查询等待及缓存清理通过；310 次普通输入不触发容量错误 |
| A8 | 本轮未重跑真实模型/TUI，保留既有证据，交由宿主正式验证 |
| A9–A10 | 根回归、文档同步、删改/延迟事件及聚合配置回归通过 |

执行结果均为退出码 0：

| 命令/检查 | 结果 |
| --- | --- |
| 根、独立包 `tsc --noEmit` | 通过 |
| Bun 独立包、聚合包 build | 通过 |
| `node --test external-plugins/steering/test/*.test.mjs` | **42/42** |
| `npm test` | **111/111** |
| `BUN_BINARY=… node scripts/package-steering.mjs` | 打包、离线安装和导入通过 |
| 安装产物运行 `kernel.test.mjs` | **11/11** |
| `node scripts/check-kernel.mjs` | 固定版本正确，tracked 内核源码干净 |
| `git diff --check` | 通过 |

无设计偏离或当前阻塞。未知保存结果会继续保留并阻断旧普通工具，需等待保存、检查原生输入或明确删除；成功压缩仅证明版本进入摘要请求，不证明语义保留。原有非原子取消和 native task 安全豁免边界不变。

完整证据见[本轮索引](/Users/penghao/Documents/code/oneshot/one-show-code/opencode-1.0old-branch/docs/oneshot/runs/20261104-0426-steering-v2/README.md)。按修复意见，正式完整 verify 与独立评审由宿主执行。