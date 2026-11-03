# Brainstorm

## 需求与范围

原始需求：`add function`。在现有 `math.mjs` 中新增命名导出 `add(a, b)`，计算两数之和，保持现有 `sub(a, b)` 行为。

## 默认假设

- 无人值守，不提问。根据 run 名 `add-fn` 和现有减法函数，将需求理解为加法函数，而非任意新增函数；备选为通用函数扩展，但缺乏具体行为依据。
- 沿用现有箭头函数、ES module 命名导出和无分号风格，直接使用 JavaScript `+`。数字是目标输入；不增加输入校验、类型转换或精度处理。字符串等其他输入沿用原生运算符语义，不承诺额外行为。
- 使用 Node 内置测试，无外部依赖。允许本地 commit，按技能要求提交实现与稳定运行证据，不 push、merge 或发布。持续写入的 host.events.jsonl、host.log、host.last.md 属宿主运行日志，保留工作区，不纳入提交。
- 风险：原始需求较短，上述加法语义是基于仓库上下文的默认解释；浮点计算遵循 JavaScript 精度。

## 源码与边界证据

- `AGENTS.md` 要求最小改动、测试命令 `node --test`。
- 初始 `math.mjs:1` 仅有 `export const sub = (a, b) => a - b`；基准 commit 为 `5edbddb63430491da246383c1a75685282539565`。
- 实施文件：`math.mjs` 新增一行；`math.test.mjs` 验证加法典型数字输入与现有减法回归。流程证据仅写入本 run 目录。

## 尺寸与理由

S，用户在初始化时显式指定（state.sizeExplicit=true）。单行实现和小规模行为测试；按既定 S 路径 brainstorm → impl inline → verify → deliver 执行，不运行 M/L 的 design、improve、review。BRAINSTORM.md 作为设计与验收依据。

## 验收与验证命令

- A1：可从 `math.mjs` 命名导入 `add`；正整数、负数、零及可精确表示的小数相加结果正确，由 `math.test.mjs` 检查。
- A2：保留 `sub` 命名导出及减法结果，由同一测试文件检查。
- A3：无外部依赖、无其他产品范围改动；宿主审查相对基准的 diff 与未跟踪文件。
- 登记并执行：`node --test`，所有测试通过才完成 verify。
