---
name: external-plugin-dev
description: 在固定 OpenCode 内核上设计、实现或评审外置插件，通过公开 plugin Hooks 和 SDK 集成；适用于 one-shot worker 的开发阶段与直接插件开发请求。
---

# 外置插件开发

先读当前根和目标目录的 AGENTS.md，核对 Git 分支、工作区状态、内核 gitlink 和真实目录。`external-plugins/` 是优先落点；不要编辑 `agent-kernel/` 原生源码。资料中的版本名不替代 commit 证据。

如果来自 worker，仅执行本次 role，返回其 schema 要求的 JSON。不要调用 one_shot_start、创建嵌套 worker、提交或发布。plan/revise 把设计放在 JSON 的 design 字段；review/evaluate 不写文件。直接开发请求按同样标准完成必要阶段，不强制启动后台队列。

## 从能力到实现

1. 将用户行为写成可验证标准；列出非目标。检查已有实现，优先扩展已有模块。
2. 读 `agent-kernel/packages/plugin/src/index.ts`、`tool.ts`、实际 plugin loader 和所需 SDK 方法的类型/调用路径。只读查看内核是允许的，禁止修改或从插件导入其私有模块。子模块未初始化时只恢复固定 gitlink，不用 update --remote 升级。
3. 在已有设计中记录“用户行为 → hook/tool/SDK 方法 → 参数与返回 → 触发/加载路径 → 验证方式”。区分导出的类型、运行时注册、实际触发：只复制文件不是集成成功。公共 API 缺口需证据；不能靠猜测 internal extension point 绕过。
4. 覆盖与本次行为有关的生命周期：重复事件、并发 session、取消/超时、错误传播、资源释放和必要日志。只选相关情形，避免把小功能扩成通用框架。
5. 实现在 `external-plugins/`，复用已有公开桥接约定。不从 `Bus`、`Session`、`SessionStatus` 或私有 `@/` 模块导入。确需内部能力时记录公共 API 不足和已验证的激活路径；路径不存在就停止该方案，不修改固定内核凑效果。
6. 对照每条标准做行为检查，验证真实加载和关键失败路径。worker 的可信 checks 不由模型改写；发现检查不足应明确报告，不能把成功的通用检查冒充具体需求证据。
7. 更新已有 `docs/baseline/SPEC.md`、`DESIGN.md` 和相关文档。交付改动、验证证据及未验证项；遇到重复修复失败，应检查根因和架构，不削弱断言或删除要求。

## 参考其他 agent 源码

用户提供参考仓库后才读，具体流程见 [references/source-comparison.md](references/source-comparison.md)。学习机制并映射到固定公开 API，不照搬其内核。参考库与目标库保持明确区分。
