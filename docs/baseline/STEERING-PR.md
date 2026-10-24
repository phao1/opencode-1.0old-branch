# 同会话 steering 与有界结束恢复

运行中收到修正后，固定 OpenCode 仍可能执行旧模型的工具；某些成功结束路径还会留下已保存、未进入后续请求的指导。此变更按消息和 assistant 请求记录证据，在公开工具检查点阻止旧动作，并通过一次可识别的 synthetic 控制记录恢复符合条件的结束窗口。原指导、附件及已完成工作不重放。

插件可独立打包安装；`steering_status` 提供保存、准备、运输和采纳的分层证据。恢复请求不复制历史 tools 权限配置。原生 `/review` 使用单独的严格来源关联，普通模型 task 仍经过原快照检查。

验证：7 项可信检查、57 项测试、17 个真实内核场景全部通过；两个真实模型场景共 5 次 CLI 调用。最终独立 evaluator 覆盖原 ST-01..07，两路最终代码评审无 findings；实际 run 已 handoff，等待人工验收。

产物：`dist/oneshot-opencode-steering-0.3.1.tgz`；SHA256：`6bf16ee3198a23532848b5108d83d7f30d981b139f26b23405e9b8ec00b1a4d6`。

公开 API 无原子 turn/取消事务；已通过检查点的执行不能撤销。未知恢复不重试，重启不自动续旧 pending；原生混合 pending 输入可能保留 running task，交互式 TUI 与复杂媒体组合尚需人工体验。

证据见 [steering-final.json](evidence/steering-final.json)；安装及人工体验见 [STEERING-DELIVERY.md](STEERING-DELIVERY.md)。原 runner 的 PR.md、TEST-MANUAL.md 与 EVALUATION.json 保留在交付页列出的 artifacts 目录。
