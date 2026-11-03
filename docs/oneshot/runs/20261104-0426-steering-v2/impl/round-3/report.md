已按 DESIGN v1.4 完成六项修复。未启动其他 agent、宿主或递归 Generator；未修改内核，未提交、合并或发布。

本轮修改：

- `external-plugins/steering/src/state.ts`：传递连续摘要覆盖；严格匹配原生 overflow 新 ID 重放；为摘要链和重放请求追加优先级提示；处理已保存指导的空编辑及恢复；回收安全 idle 的取消/失败会话。
- `state.test.mjs`、`kernel.test.mjs`：新增连续三次摘要、第二次失败/缺失覆盖、重放匹配反例、媒体占位、空编辑恢复、超过 128 个终止会话，以及真实内核 overflow 路径回归。
- `external-plugins/steering/package.json`：保留精确 1.3.17 dev/peer，将类型用途的 peer 标为 optional。
- `scripts/package-steering.mjs`：使用全新空 npm cache 离线安装，检查 optional peer 未安装，并验证单文件导出和字节一致。
- 同步包 README、baseline SPEC/DESIGN/STEERING 和本轮证据索引。

实现侧验收结果：

| 验收 ID | 本轮结果 |
| --- | --- |
| A1 | 类型、构建、空 cache 离线安装、唯一导出及安装产物内核测试通过 |
| A2–A3 | 原多工具拦截、晚保存及单次恢复回归通过 |
| A4 | 实际 provider body 验证摘要、连续摘要后请求和 replay 均含明确优先级提示 |
| A5–A6 | 无插话、取消、revert、native task、压缩失败及 overflow 回归通过 |
| A7 | 容量回收及边界保护通过；活动工作和未确认终止边界不会被淘汰 |
| A8 | 本轮未重跑真实模型/TUI，保留旧证据，由宿主执行正式验证 |
| A9–A10 | 根回归、文档同步、空编辑及恢复有效内容后的 gate 回归通过 |

执行结果均为退出码 0：

| 命令/检查 | 结果 |
| --- | --- |
| 根、独立包 `tsc --noEmit` | 通过 |
| Bun 独立包、聚合包 build | 通过 |
| 单元/组件测试 | **49/49** |
| `node --test external-plugins/steering/test/*.test.mjs` | **62/62** |
| `npm test` | **131/131** |
| `BUN_BINARY=… node scripts/package-steering.mjs` | 全新空 cache 离线安装、导入通过 |
| 安装产物运行 `kernel.test.mjs` | **13/13** |
| `node scripts/check-kernel.mjs` | 固定版本正确，tracked 内核源码干净 |
| `git diff --check` | 通过 |

无当前已知阻塞或设计偏离。摘要覆盖与静态提示不证明语义保留，provider/adopted 仍为 unknown。原生 replay 会将图片/PDF 转为占位文本，status 用 `mediaStripped` 明确标识；取消与派发仍非原子。

完整日志、原生消息和 provider 请求见[本轮证据索引](/Users/penghao/Documents/code/oneshot/one-show-code/opencode-1.0old-branch/docs/oneshot/runs/20261104-0426-steering-v2/README.md)。正式完整 verify 和独立验收留给宿主执行。