# 旧 Codex 成果独立审计

审计日期：2026-11-04（Pacific/Auckland）。目标分支 `dev1104-oneshot-steering`，HEAD `5afc92399`；范围为 `2c6eb4241..915d9f9a8` 及基线快照 `5afc92399`。报告中的相对路径均以目标仓库为根，`旧包/`、`新包/`、`参考库/` 的含义见下文。历史日志是本次亲自读取的既存证据，不等于本次重新运行模型。

## 摘要

- 成果有真实实现与行为证据：88/88 指定测试、类型检查通过，旧工具拦截的历史原始消息和文件结果相互支持。
- 原始工程约束被大幅删写；现有三层结构是公开插件桥接的精简替代，不能视为原描述的内核扩展体系已经复刻完成。
- Steering 的有效增量是工具检查点拦截、证据和有限续跑；busy 输入、QUEUED 和普通自然继续来自原生内核。
- one-shot 有并行评审、角色调用和持久化 worker，但缺少按任务裁剪、自动探测/降级；三个主要 run 待人工验收，一个超时取消。
- 建议保留行为测试、公开 API 证据和最小 Steering 能力，重写 Codex 优先的流程入口；未发现足以定为 P0 的证据。

## 验证命令与结果

审计开始时 `git status --short` 无输出。没有执行仓库 checkout、stash、提交、merge、安装依赖或构建发布；本审计只写入本报告。收尾时 tracked diff 仍为空，未跟踪目录显示 `docs/review/` 及审计期间另行出现的 `docs/oneshot/`；后者不是本审计创建，未操作其内容。指定测试自身在系统临时目录建立、提交及清理 fixture Git 仓库，这是测试实现，不是对目标仓库提交。没有运行会在仓库 `.codeagent/`、`dist/` 或包目录写入新证据的集成脚本。

| 命令 / 检查 | 本次结果与输出摘录 | 解释 |
| --- | --- | --- |
| `git branch --show-current`、`git log --oneline 2c6eb4241^..HEAD` | `dev1104-oneshot-steering`；首项 `5afc92399 chore: snapshot uncommitted dev1024 work as baseline`，次项 `915d9f9a8 docs: record one-shot hardening validation and Claude review` | 审计的是快照后的工作区，不能只用 915d9f9a8 代表现有打包实现。 |
| `git show a5f1676cf:AGENTS.md` | 原文件 146 行；现 `AGENTS.md` 21 行 | 具体丢失内容见问题 1。 |
| `git diff --shortstat 2c6eb4241^ 2c6eb4241` | `4549 files changed, 208 insertions(+), 777268 deletions(-)` | 大规模源码迁移为 gitlink；不等于 Git 历史已丢失。 |
| `git submodule status` | `517e6c9aa4c61dbc125e7654fc596f1d529f20d9 agent-kernel` | 本机已初始化且固定。 |
| `node --test test/custom-hw/extension/*.test.mjs test/capability-watch/*.test.mjs test/one-shot/*.test.mjs test/steering/*.test.mjs test/packaging/*.test.mjs` | exit 0；`tests 88`、`pass 88`、`fail 0`、`skipped 0`、`duration_ms 45375.795208` | 约 45.4 秒。不是 88 项真实模型/OpenCode 集成测试。 |
| `node_modules/.bin/tsc --noEmit -p .` | exit 0，无诊断；`tsc --version` 为 `7.0.2` | 范围由 `tsconfig.json:15` 起限定：extension、external plugin、CLI；排除 agent-kernel，不覆盖大部分 `.mjs`/C/Python。 |
| `node scripts/check-kernel.mjs` | `OpenCode kernel pinned and tracked files clean: 517e6c9aa4c61dbc125e7654fc596f1d529f20d9` | 同时检查 HEAD 和 tracked diff；`git -C agent-kernel status --porcelain --untracked-files=no` 无输出。 |
| `git diff --check` | exit 0，无输出 | 没有格式诊断。 |
| `node --version`、`~/.bun/bin/bun --version` | `v24.22.1`、`1.3.11` | 现有 native package 构建脚本要求 Bun 1.4.2+，见 `scripts/build-test-package.mjs:13`；本次未重建包。 |
| Python 只读遍历 `git ls-files -z` + `os.path.getsize` | 审计前 118 个 tracked 条目；普通文件合计 668,999 字节；大于 1 MiB 的 tracked 普通文件为 `[]` | 不含 submodule 的内部文件；不含本报告。 |
| Python 逐项 SHA256 校验两个包的 `SHA256SUMS` | 旧包 45 项、新包现目录 31 项，均匹配，缺失/错误均为 `[]` | 旧报告描述的新包初版为 26 项，现目录已含 Codex 入口增补；不能混用。 |
| Python 只读检查两个 ZIP 的 SHA256/Unix mode | 普通 ZIP：38,023,054 字节，`179b115e8bdc4335c5be68ba6ebc26799e4f39a7b5da72023475a1b96cd8ccc3`；Codex ZIP：38,035,629 字节，`71c9cef388e14da70727e70e25fc825f711bf59d3a2fbab9b046eaf07ca3cec4`；两者 symlink 列表均 `[]` | 与新包两个版本的说明相符；不是本次重新启动 TUI 的证据。 |
| 四参考库 `git rev-parse HEAD`、`git status --porcelain -uno` | commit 均与旧对照报告相同，tracked 状态均干净 | 具体抽查见问题 8；未联网验证远端，也未执行四项目。 |

测试文件的顶层用例数：extension 2、capability-watch 2、one-shot framework 36、source 2、steering 41、Codex bridge 4、Mac launcher 1，共 88。通过用例包括 `per-assistant snapshots block every stale call...`、`a passing unrelated typecheck cannot substitute for the bound behavioral check`、`reviewers run concurrently...`。没有以测试数量推导产品完整性。

路径简称：

- `旧包/` = `/Users/penghao/Documents/code/oneshot/OpenCode-Mac-Test-915d9f9a8/`。
- `新包/` = `/Users/penghao/Documents/code/oneshot/OpenCode-Real-Package-20261028/`。
- `参考库/` = `/Users/penghao/Documents/code/CodingAgent/`。
- `实包证据/` = 本仓库 `.codeagent/package-real-steering-20261028/`。
- `参考流程` = `/Users/penghao/Documents/code/oneshot/reference/chencheng-oneshot-reference.md`，本次已全文读取，尤其第 1 节。

## 问题清单表

P1 表示显著偏离目标、交付或正确性问题；P2 表示维护、可复现性或局部风险。源码推断的风险均明确标注，不伪装成已复现故障。

| ID | 领域 | 严重度 | 问题 | 证据 | 建议处理(保留/修改/重写/删除) | 理由 |
| --- | --- | --- | --- | --- | --- | --- |
| L-01 | 用户约束 | P1 | 重写 AGENTS.md 丢掉 Karpathy 四原则、ACL、内部方案理由及文档维护约定 | `a5f1676cf:AGENTS.md:18`、`:32`、`:45`、`:65`、`:120`、`:124`、`:134`；现 `AGENTS.md:1` | 修改 | 新边界有价值，但不能用删掉原始约束代替落实；先恢复有效原则，再标记不适用的旧机制。 |
| L-02 | 内核来源 | P1 | submodule URL 与父仓库 origin 相同，内核来源和包装分支生命周期耦合 | `.gitmodules:3`；`git remote -v`；固定 gitlink 为 `517e6c9aa...` | 修改 | 固定旧提交当前可用；若对象失去远端可达性、错误追踪包装分支，初始化/更新可能失败或取错结构。新 clone 失败未核实。 |
| L-03 | 三层架构 | P2 | registry 同名但能力缩减；merge 只是复制无 bootstrap 的代码 | `agent-kernel-extension/scripts/merge-agent-kernel.mjs:14`、`:39`；`src/custom-hw/extension/global-extension.ts:5`、`bundled-global-extensions.ts:5`；extension `README.md:3` | 修改 | 明确这是公开 hook 桥接；不要把复制输出或占位目录当作原始完整扩展体系。 |
| L-04 | 外置边界 | P2 | 外置总入口直接依赖 extension 源目录，不能独立仅复制 external-plugins 构建 | `external-plugins/src/index.ts:2`、`:3`、`:10` | 修改 | 违反外置独立、external-first 的意图；但没有证据显示它导入内核私有服务，不能升级成“私有 API 入侵”。 |
| L-05 | 流程适配 | P1 | 一切任务强制 plan/design review；无小任务直达实现和不可用 reviewer 的减员降级 | `one-shot/types.ts:41`；`runner.ts:180`、`:185`、`:195`；`agents.ts:65`、`:91` | 重写 | 参考明确按场景组合及 agent 不可用不阻塞；当前是固定 worker 状态机加显式 fallback。 |
| L-06 | Codex 入口/视角 | P2 | 默认是 OpenCode 工具入队；不同角色/ID 不保证不同 agent 或模型 | `.opencode/command/one-shot.md:5`；`one-shot.config.example.json:11`；`types.ts:47`、`:50`；`scripts/agents/codex.mjs:20` | 重写 | 实际有 Codex command 适配，不能说“不支持 Codex”；仍缺 Codex 主控优先、CLI 探测及模型多样性证据。 |
| L-07 | 设计交付 | P2 | 默认 DESIGN 在被忽略的状态目录，未随实现提交；minor 建议不触发设计整合 | `runner.ts:118`、`:184`、`:199`、`:243`；`store.ts:72`；`.gitignore:8` | 修改 | 开启 publication 后 PR 正文会包含 design；默认本地流程缺少稳定仓库/PR 设计关联，且 Improve 被收窄成重大缺陷门禁。 |
| L-08 | Steering 性能 | P2 | 工具前反复读取全量消息，消息事件也全量查询并重写 ledger，无事件合并/队列上限 | `ledger.ts:163`、`:166`、`:440`、`:458`、`:582`；内核 `plugin/index.ts:227` | 修改 | 长会话/流式事件下有明显放大路径；性能下降幅度未测，不宣称已发生超时。 |
| L-09 | Steering 正确性 | P1 | native subtask 的 before hook 拒绝可能留下 running tool 和未完成 assistant；文件损坏可让本进程持续拒绝普通工具 | `ledger.ts:467`、`:476`；内核 `session/prompt.ts:580`、`:604`、`:615`；`ledger.ts:109`、`:141`、`:486` | 修改 | 这是有用户可见停顿的失败方式；README 已诚实说明 subtask 缺口，但说明不能替代可用恢复路径。 |
| L-10 | 持久化/并发 | P2 | ledger 只有实例内串行和 rename，无跨实例锁；capability-watch 同 PID 临时文件也无互斥 | `ledger.ts:58`、`:120`、`:139`；`capability-watch-extension.ts:15`、`:24` | 修改 | 并行实例可能覆盖状态；同进程并发 watch 可能争用临时文件。是源码风险推断，本次未构造写入复现。 |
| L-11 | 流程复杂度 | P2 | 1044 行 one-shot 框架把 issue/监控/来源抓取/信任解析一并置于必经入口 | `one-shot/types.ts:23`、`:33`；`trust.ts:27`、`:63`；`scripts/one-shot.ts:49`；skill `SKILL.md:13`、`:14` | 重写 | 哈希门禁有防“改测试过关”的价值，但对先复刻五节点流程过重；拆成可选 worker/批量扩展，保留验收绑定。 |
| L-12 | 测试接入 | P2 | 默认 88 项没有真实 OpenCode 启动，集成/真实模型需额外脚本；大部分脚本不在类型检查范围 | `package.json:13`；`tsconfig.json:15`；`test/steering/plugin.test.mjs:15`；`framework.test.mjs:530`；`scripts/smoke-one-shot.mjs:3` | 修改 | mock 用例有价值，但不会发现真实事件顺序、API 漂移或所有打包启动问题；保留轻 smoke 的独立职责。 |
| L-13 | 证据保存 | P2 | 三个成功主 run 仍在忽略的本机状态/worktree 中，无 publication；摘要样例未合入主入口 | 四个 state，见问题 4；`.gitignore:8`；`新包/测评报告.md:89` | 修改 | 自动流程执行过不等于成果进入可评审 PR；应导出精简设计/patch/检查清单并明确待验收，而非继续积累孤立 run。 |
| L-14 | 一次性脚本 | P2 | 11 个 probe/verify 共 1784 行，均有引用但默认测试不运行；Codex 入口 verifier 硬编码本机 Python 和既存 artifact | `scripts/verify-codex-user-entry.mjs:11`、`:12`、`:20`；`verify-steering.mjs:10`；问题 6 引用表 | 修改 | 不应按文件名前缀全删；将仍有行为价值的探针收拢，参数化路径，归档纯历史运行器。 |
| L-15 | 包可迁移性 | P2 | 旧包依赖绝对插件/解释器路径、原仓库对象和依赖；现环境不能直接重建新版 native 包 | `旧包/runtime/env.sh:4`、`config/full/opencode.json:4`、`project/.git/objects/info/alternates:1`；`scripts/build-test-package.mjs:13` | 修改 | 旧包已声明本机专用，无证据认定欺骗；仍不满足可迁移交付，需与新便携 TUI 包分开。 |
| L-16 | 报告口径 | P2 | 原 completion harness 的 automaticRecovery 标签过宽；26 文件/84 测试对应旧快照，现目录为 31 文件/88 测试 | `实包证据/final-tests/real-tui-completion-boundary/AUDIT-NOTE.md:1`、`ledger.json:209`；`新包/测评报告.md:57`、`:72`；`新包/Codex入口实测.md:10` | 修改 | 最终报告已纠正原生继续的归因；保留纠正，给包版本和原始记录明确关联，不能把历史数字直接当当前状态。 |
| L-17 | 源码对照精度 | P2 | “steer_input 验证取消”缺少所引函数的支持，混入了 mailbox 路径的取消检查 | `STEERING-SOURCE-COMPARISON-20261028.md:52`；参考 Codex `turn_input.rs:843`、`:853`、`:918`；`input_queue.rs:179`、`:189` | 修改 | active-turn 锁、ID/schema 校验和入队描述正确；收窄取消断言，避免把另一入口的检查移植成 steer 保证。 |

## 值得保留的资产清单

| 具体文件 | 保留理由与条件 |
| --- | --- |
| `external-plugins/src/steering.ts`、`steering/ledger.ts` 中 `prepare/gate`、`external-plugins/steering/package.json` | 旧上下文工具拦截有真实对照价值；保留公开 API、单独包入口及明确限制，精简查询/持久化成本并处理失败恢复。 |
| `test/steering/plugin.test.mjs` | 41 项包括同 assistant 覆盖、撤销/删除、附件、压缩、取消和异步控制竞态；是重写时可复用的行为契约，需配真实内核 smoke。 |
| `docs/baseline/STEERING-FEASIBILITY.md`、`STEERING-RECOVERY.md`、`STEERING-SOURCE-COMPARISON-20261028.md` | 记录不能实现的原子边界、失败和机制差异，价值高于只报“完成”；修正本报告指出的精度问题。 |
| `agent-kernel-extension/src/codeagent/one-shot/runner.ts` 的 criterion/evaluation 校验、有界修复；`test/one-shot/framework.test.mjs` | 防止无关绿灯替代验收、manual 冒充自动 PASS；状态机可作为可选持久 worker，而非强迫每个小任务使用。 |
| `.opencode/skills/one-shot/references/stages.md`、`.opencode/skills/external-plugin-dev/SKILL.md` | 角色责任、真实 API 核对、不可伪造证据的要求可迁入 Codex 主控流程；入队/信任预检部分应简化。 |
| `scripts/agents/codex.mjs` | 确有独立 Codex CLI 调用、只读/可写 sandbox 与结构化结果转换；可提炼为适配器。当前固定 high 推理，不等于历史最终 medium 运行器。 |
| `scripts/lib/kernel-lab.mjs`、`scripts/smoke-one-shot.mjs`、`scripts/verify-packaged-steering.mjs` | 区分源码内核启动、包内二进制和真实模型行为，具备复现实验骨架；路径/依赖参数化后接入合适测试层。 |
| `scripts/mac-native-launcher.c`、`test/packaging/mac-native-launcher.test.mjs` | 对首次 OSC 11 查询兼容的责任明确，测试实际编译 C 并覆盖流式分块；保留为单独 macOS 兼容资产，勿混成 Steering 功能。 |
| `scripts/lib/codex-cli-bridge.mjs`、`test/packaging/codex-cli-bridge.test.mjs` | 有协议、取消、超时和 UTF-8 分块覆盖；属于可选模型桥接层，不能以组件 backend 测试替代真实账号/模型验收。 |
| `scripts/check-kernel.mjs`、merge 脚本的 generated-marker 拒绝覆盖逻辑 | 固定基线和避免覆盖 tracked 原生代码的保护有效；不代表 merge 后的文件已被激活。 |
| 三个成功 run 的 DESIGN、评审输出、EVALUATION、PR.md 和 `implementation.patch`（如存在） | 可审阅的历史研发证据；导出后再决定接纳样例，保留 awaiting_acceptance 身份，不直接当主线交付。 |

## 逐问题回答

### 1. 结构、AGENTS.md 与自引用 submodule

**原始内容确实丢失，但不能把原文描述的一切都视为原仓库曾经存在的代码。** `git ls-tree a5f1676cf agent-kernel agent-kernel-extension external-plugins` 无输出；原始文档描述的三目录在该树不存在，与参考流程第 0 节的确认一致。因而不能指控旧 Codex “删除了一个已经工作的 ACL/ServerExtension”；可以确认它没有完整补齐该蓝图，并重写了约束。

| 原始 AGENTS.md 内容（`git show a5f1676cf:AGENTS.md` 的行号） | 当前状态 |
| --- | --- |
| `:18–77` Think Before Coding、Simplicity First、Surgical Changes、Goal-Driven Execution | 四节均不在现 21 行文件中；只保留最小实现/先写验收的部分意思。尤其“无投机抽象/配置”“每条改动追溯需求”的约束丢失。 |
| `:79–101` 初始化、安装、serve、Bun/Jest 两种测试及 mock 约定 | 整段删除，现 package 改用 Node test。原 `submodule update --remote` 不适合固定基线，不建议机械恢复此命令。 |
| `:107–116` merge 三段依赖、src/migration/script/SDK 合并及五个全局 transform 点 | 当前只有 `.mjs` 复制两个命名空间的 `.ts`，无依赖/migration/SDK 合并，无原列五个 transform。 |
| `:120–127` 外置仅经 SDK、只有 SDK 无法满足才内置且要说明理由；每模块 kernel/ ACL | 现文件只剩禁止私有导入，未保留内置理由及 ACL 原则。 |
| `:130–137` alias、GlobalConfig、disabled_hooks/tools、编码风格；更新既有设计、版本和变更记录、同步 SPEC/DESIGN/README/CHANGELOG | 多数删除；当前仅要求证据放 baseline。 |
| `:139–146` extension/external 的 CLAUDE.md、server/internal-plugins/kernel/hooks 类型入口索引 | 多数对应文件不存在；不是路径都已实现。 |

三层实际情况：

- `agent-kernel/` 本机为完整固定 OpenCode 源码，tracked 源码干净。根仓库的删除规模已实测；它以 gitlink 引用旧源码，不是抹掉所有历史。
- `agent-kernel-extension/` 有 10 个 one-shot TS 文件（1044 行）、2 个 capability-watch 文件、2 个 registry 文件及 merge/run 脚本。registry 仅 `[CapabilityWatchExtension, OneShotExtension]`，类型只允许 `event/tool`（`global-extension.ts:5`）。没有 Init/Server/InternalPlugins/Permission/Tool 五扩展，没有业务 `kernel/` ACL，没有 GlobalConfig。
- `external-plugins/` 有总桥接入口和 651 行 Steering/compose 源码及独立包 manifest/README。`sdk/js-agentkernel/README.md:3` 明说 no SDK merge active；`codecov/README.md:3` 明说当前没有 Jest 配置；`agents/README.md:3` 只是预留角色。

启动链可从源码确认：`.opencode/opencode.json:3` → 外置 `src/index.ts:9` → `composeGlobalExtensions` → 两个 registry 扩展，再组合 Steering。原生加载器 `agent-kernel/packages/opencode/src/plugin/index.ts:89–99` 调用插件，`:227–233` 转发事件。`agent-kernel-extension/README.md:3–5` 明说固定基线没有原描述的 global bootstrap；拷贝同名文件不会激活。当前实现也没有假装调用 transformServer，属于能力缩减后的桥接。

merge 的正面保护：`merge-agent-kernel.mjs:11` 核对固定 HEAD，`:30` 拒绝覆盖没有 marker 的既存文件，`:39` 只走 custom-hw/codeagent。局限：不会清理失效 generated 文件，没有原始依赖/迁移合并；业务仍从 extension 原目录被 bridge 加载，复制出来的内核目录不是必要启动路径。

`.gitmodules:3` 的 URL 为 `https://github.com/phao1/opencode-1.0old-branch.git`，与 `origin` 相同。**固定提交自身没有该嵌套 submodule，故目前不能称为必然无限递归。** 风险是内核 fork 与包装项目共仓库：错误使用 `--remote` 可能跟到包装分支而非原 OpenCode 树；对象可达性/强推/迁移影响新环境能否 fetch 固定对象；完整 clone 还会携带不相关包装历史。本机对象存在且初始化成功，未在干净网络环境验证远端对象可达性，不能说“已证明 clone 失败”。建议独立内核远端/可达固定 tag，并去掉追踪包装分支的更新习惯。

### 2. external-plugins 的依赖边界

亲自全量搜索两层 TS import 后，发现 `external-plugins/src/index.ts:2–3` 确实跨目录导入 `agent-kernel-extension/src/custom-hw/extension/*`；因此“external-plugins 完全不依赖 extension”是错误说法。独立 Steering 入口只导入公共 plugin 类型、Zod、Node 标准库和自己的 ledger，包构建也直接用 `src/steering.ts`（`scripts/package-steering.mjs:14`），不加载 one-shot。

没有发现 external 插件导入 `agent-kernel/packages/...`、`@/session`、Bus/GlobalBus/Session/SessionStatus 私有服务。ledger 的内核查询/续跑经 `input.client.session.messages/status/promptAsync`，分别见 `ledger.ts:166`、`:237`、`:290`。Node 文件系统不是“内核私有 API”；不能把本地 ledger 写文件本身算成此项违约。

按原始“外置只能用 SDK client 与内核交互”的严格口径，**总桥接不是纯独立 SDK 插件包**：它加载 extension 业务，one-shot 的 OpenCode 适配器还用直接 `fetch` 调公开 HTTP 路由（`one-shot/agents.ts:37–51`），而非 generated SDK client。但这属于目录隔离/调用方式偏离，HTTP 路由仍是公开接口，没有证明它绕过内核权限。当前 AGENTS.md 只明确禁止私有导入，该项未发现硬越界。没有私有内核依赖时，缺 `kernel/` ACL 并不等于已有 ACL 泄漏；也不应为占位强加一层空适配器。

### 3. Steering 实际行为、原生重叠与风险

用户直接在当前 TUI 提交普通指导即可，`steer:` 可选。`ledger.ts:359–361` 只是识别显式前缀并拒绝空 `steer:`；`:362` 后对普通有效文本/文件同样观察。插件不删除前缀，不把普通输入统一转系统指令，也不创建独立“插话 UI”。用户可通过 `steering_status` 查询 saved/prepared/pending；provider/adopted 永远保留 unknown（`:157–158`），不是语义采纳测量器。

时序：

1. `chat.message` 在内核保存用户消息**之前**触发（内核 `prompt.ts:1263`，之后 `:1300` 保存 parts）；插件记录期望指纹，不凭 hook 已执行就说保存成功。
2. `experimental.chat.messages.transform` 在准备下一模型请求时对已保存消息关联 assistant snapshot，必要时把已知未覆盖、压缩遗漏的原指导补回上下文（`ledger.ts:390–448`）。prepared 是准备证据，不是 provider 收据。
3. 普通工具 `tool.execute.before` 读取当前已保存历史，与产生该调用的 assistant snapshot 比较；新指导未覆盖时抛 `STEERING_STALE_CONTEXT`，本工具不执行（`:451–486`）。已越过检查点的工具不能撤销。
4. 若本进程运行中观察到的指导在成功完成/idle 后仍未准备，默认等待 50ms 后重查状态，再发一次 synthetic continuation（`:241–290`）。有 epoch、取消抑制和按指纹 attempt 去重，但派发与取消不是原子事务；重启不自动重跑历史 pending（`:85`、`:104`、`:225`）。

**原生内核已有什么：** `prompt.ts:1309–1322` 保存新输入并进入 loop；`:1344–1348` 每轮重读消息；`:1373–1380` 根据最新 user/assistant 和 tool calls 决定退出；`:1481–1494` 包裹后来用户消息为 system-reminder；`:1573` 调用 Runner.ensureRunning。`effect/runner.ts:111–130` 在 Running 状态等待已有 done，不开第二个 loop。TUI `routes/session/index.tsx:1236` 计算 queued，`:1300` 显示 `QUEUED`。所以普通 busy 输入、显示排队和下一轮看到新要求，均不能算插件原创能力。

**新增价值有实证：** 亲自读取 `实包证据/final-tests/real-tui-repeated-steering/messages.json:162`，旧 bash 状态为 error，错误含 `STEERING_STALE_CONTEXT`；该目录 `project/` 只有 `completed.txt=KEEP`、`final.txt=FINAL`，没有 old/intermediate。对应无插件 `baseline-tests/real-tui-baseline-without-plugin/project/` 同时有 `old.txt=OLD` 和 `final.txt=FINAL`。原始 `model-2/status.json:2` 为 code 0，`events.jsonl:1,4` 有 thread.started、turn.completed 和 usage；这支持“历史真实模型决定 + 实际 OpenCode 工具执行”的记录，不只是一份自评 JSON。本次未重跑该实验。

复杂度实测：ledger 596 行/40,275 字节，入口 25 行、compose 30 行，共 651 行。按 TS 类型声明计，顶层 State 有 15 个命名字段，Entry 18 个（均含可选字段），类有 18 个私有成员；另有 prepared/snapshot/recovery/dispatch 类型。状态文件在 `$XDG_STATE_HOME/codeagent-steering/<namespace>/<session hash>.json`，默认 `~/.local/state/codeagent-steering`；namespace 只哈希 directory/project（`:73–81`），不是项目 `.codeagent`，也不含 OpenCode server/profile 标识。使用 0700 目录、0600 文件、随机临时文件 rename，路径不含指导原文，这是正面设计。

成本与风险：

- 每个普通工具 gate 都请求 `client.session.messages`，最多三次，每次 1500ms 超时，中间两次等待 20ms（`:166`、`:458–464`）；`steering_status` 豁免 gate，但执行 status 仍查询 messages/status。
- `message.updated`、`message.part.updated`、status/idle 等事件也逐个 reconcile + 全量 persist（`:582–585`）；内核不 await event。队列只串行，不合并、不限制长度。长流式输出可能形成查询/I/O 积压，尚无性能 benchmark。
- messages、snapshots、prepared、recovery attempts 不做正常会话裁剪，只有 diagnostics 限 100 条（`:126–128`）。每轮快照重复保存覆盖关系，长会话内存和 JSON 会增长。
- serial 是**一个 ledger 实例内**的队列，rename 只防半文件，不防多个实例/进程在同 namespace 丢更新。默认路径跨 profile 共用是风险条件，本次未复现冲突。
- 损坏/写失败会加入 storageErrors，代码没有清除此集合的恢复分支（`:109`、`:148`）；该实例之后 persist 跳过、工具继续拒绝。故障报告诚实，但可用性恢复偏重启/人工。
- 原生 subtask 已先保存 running tool，再触发 before hook（内核 `prompt.ts:580–604`），其执行 catch 在更后面 `:615–651`。插件拒绝时可能留下 running/未完成 assistant，README `:52` 已公开这一限制；不能保证普通 follow-up 就能恢复。
- 取消与 SDK 派发存在最后检查后的竞态，batch 内部子工具/StructuredOutput 不受逐步 gate 完整覆盖。代码和 README 均承认，不能宣称全局即时中断或 exactly-once。

判断：若目标只是在 busy 时输入新要求，额外 ledger 明显过重；若目标是阻止已经生成但尚未执行的旧动作，则 gate 有明确价值。建议保留该最小差异和诚实证据字段，减轻事件全历史扫描，把复杂恢复按实际边界独立评估。

### 4. one-shot 与参考流程逐节点对照及真实 run

| 参考节点 / 原则 | 已有实现 | 偏离或缺口 |
| --- | --- | --- |
| Brainstorm | skill `:12` 要提取目标/非目标/标准；plan prompt 要读真实接口，runner `:181` 调 planner | worker 内没有独立对话式 brainstorm 阶段；先要 issue/checks 完整才能入队，无法自然逐步讨论后再裁剪流程。 |
| Save Design | runner `:184` 保存 DESIGN.md，修订 `:204` 更新；state 也存 plan.design | 文件在忽略的 artifacts 目录，默认不进实现 commit。publish 开启时 `:243` 将 design 全文写进 PR body，再由 workspace `:96` 建 draft PR，所以不是“永远没有附设计”。本机三个成功 run 均 publish=false，无实际 PR。 |
| 并行 n agent Improve Design | runner `:189` 用 Promise.allSettled 并发 designReviewers；有真实时间重叠 | 有，并非缺失。但 `blockers()` `:118` 排除 minor，只有非 minor 才交 planner revise；没有统一采纳/拒绝所有改进建议的执行保证。reviewer 数量至少 1，流程不能跳过。 |
| Impl | `:209` 独立 builder，`:214` 命令检查、`:224` 独立 evaluator | 有实际文件/命令；框架附加检查和信任要求很多，不是纯五节点编排。 |
| 可选并行 Review | codeReviewers 可为空；`:232` 按数组决定是否进入；同一并发分支执行 | 有。有界修复/复评；配置能并发同 CLI 的不同会话，不能保证不同模型或不同 agent 工具。 |
| Planner / Generator / Evaluator 分离 | 每次 command/HTTP 调用新进程/新 session（agents `:28`、`:45`） | 是调用上下文隔离，不保证不同观点；schema 不禁止 planner/builder/evaluator 选同一个 ID/模型。 |
| 按大小裁剪 | 可关代码 review，能调 fanout/预算 | 没有小任务直达 impl、跳 design review 或节点独立组合的配置。 |
| 后台、可恢复 | `scripts/one-shot.ts:49–65` 持续 worker；store 锁和快照，runner 保存 phase/calls | 有单机恢复，不是启动 TUI 自动起 daemon；skill `:21` 已区分 queued 与进程存活。 |
| agent 不可用降级 | agents `:65–91` 依序试显式配置 fallback | 无 CLI 可用性自动探测；fallback 耗尽会抛错，一个 reviewer 失败导致整轮 blocked（runner `:195–196`），不符合“不可用减员而不阻塞”。不能把失败算通过，但可以明确降级结果。 |
| Codex 先执行，主 agent 指挥 | 有 `scripts/agents/codex.mjs`，真实历史 run 使用 Codex CLI | 仓内 skill/command 面向 OpenCode tool + 独立 Node worker，example 默认连 OpenCode 4096；不是已交付的 Codex 原生主控 skill。说完全不支持 Codex也不准确。 |

过度设计的判断须区分历史原因：trustedFiles/sha256/allowUnpinned 不是完全没有用途。`ONE-SHOT-HARDENING.md:9–15` 和通过的反例测试证明它们针对改写检查/skill、无关 typecheck 冒充行为成功等真实问题。`trust.ts:27–72` 还解析解释器、脚本扩展名、option=value、内联开关及路径例外；它无法穷尽动态依赖，更不是安全沙箱。用于日常人工主控的五节点工作流，这些应是可选执行器策略，不必成为启动前长清单。issue 队列、GitHub todo/release/source loops（loops/source 共 248 行）属于参考第 1.3 节的批量扩展方向，不应替代先交付第 1.1 节的简单可组合流程。

四个主要 worktree 对应的真实状态：

| run | state 文件及精确定位 | 本次读取的结论 |
| --- | --- | --- |
| `run-a2555548-2189-4de3-88fa-39a73d517111` | `.codeagent/one-shot-e2e-validation/state/state.json:223–225`；checks `:248`，calls `:296`，workspace `:547` | base `e6e149179`，handoff / awaiting_acceptance；7 calls done，5 checks exit 0，设计/代码各 2 reviewer，有时间重叠；无 publication。旧 criteria 未绑定 checks，不满足现格式恢复要求。 |
| `run-31f771ec-873f-4773-aa48-21ea14f71ef5` | `.codeagent/one-shot-hardening-20261025/state/state.json:510–512`；checks `:549`，calls `:597`，workspace `:876` | base `e83bf6346`，handoff / awaiting_acceptance；7 calls done、5 checks exit 0，checks/manual 绑定已存在；无 publication。 |
| `run-d583d984-4f60-483f-b427-77bfe106532f` | `.codeagent/one-shot-hardening-20261025/final-state/state.json:639–657`、`:686–687` | base `bfe6ea7ad`；designing，planner 10 分钟超时，run cancelled，checks=[]，无实现/交付；issue 条目的 `:58` 仍 blocked，和 run cancelled 是两层状态，不应只取一个字段写全程成功。 |
| `run-1e5b897b-36ce-47a6-a9da-ffec7d9fb465` | `.codeagent/one-shot-hardening-20261025/verified-state/state.json:704–706`；checks `:729`，calls `:777`，workspace `:1040` | base `2ea87f6f6`，handoff / awaiting_acceptance；7 calls done、5 checks exit 0，修订/修复均 0，无 publication；最终版仍待人工验收。 |

五组检查 ID 为 typecheck、regression、package、summary-contract、kernel-summary。三个成功 worktree 的 `git status --short` 都列出同样六个未提交文件：SPEC、DESIGN、plugin-guide、steering.ts、独立包 README、steering 测试；主线 `external-plugins/src/steering.ts:12` 仍仅 messageID 参数，没有 summary。实际任务是**给 steering_status 加 summary:true 小功能**，并非四轮都开发了全新 Steering 或四个不同需求。

并行不是只看配置猜测。例如最终 run 的两次 design review 分别 `06:28:31.629Z→06:28:59.459Z`、`06:28:31.661Z→06:29:02.849Z`；code review 也重叠。亲自抽读其 `.codeagent/agent-calls/1c446ede-f495-4154-84ad-8efd10807756/events.jsonl:1,4–5`，有真实 Codex thread、读取 AGENTS/skills 的命令及结果；该 reviewer result 报无具体缺陷。最终运行器指向 `.codeagent/.../codex-medium.mjs`，而 tracked `scripts/agents/codex.mjs:21` 固定 high：重现最终 run 不应只调用 tracked high 脚本并称参数相同。

另见 `.codeagent/claude-skill-review-20261024/intake-probe/state.json` 的 queued / 0 calls，以及 evidence-gate-fixture 的 fixture 成功；这些不能与四个主要真实研发 run 混作产品验收。未重新调用模型；模型身份、质量和全部历史输出真实性不作超出既存 trace 的保证。

### 5. 测试质量与 OpenCode 集成

指定两条命令均已运行通过，结果见前表。测试同时包含用户行为契约和实现协议断言，不宜统称“只测实现细节”：

- Steering fixture 在 `test/steering/plugin.test.mjs:15–19` 伪造 SDK messages/status，手动安排用户保存、assistant、工具 part 和 hook 顺序。旧调用拒绝、取消不续跑、输入/附件保持原样是有价值行为；prepared 指纹、snapshot、native subtask 精确 shape 又高度依赖当前实现和内核布局。无法证明真实事件时序全部一致。
- one-shot fixture `framework.test.mjs:18–32` 真建临时 Git 仓库/worktree、执行确定性 agent 子进程和 answer=42 检查，`:40–52` 验证文件及人工接纳/退回，是编排集成。`:530–550` 的“OpenCode HTTP adapter”是本地 Node HTTP mock，**没有启动 OpenCode**。
- capability-watch 的 2 项测试测 release 游标；未覆盖其工具包装的并发文件写入。extension 2 项只测 hook/tool composition。
- packaging 的 4 项桥接测试明确是 component backend；Mac launcher 测试用 clang 编译 C 再执行分块协议断言，是真 C 组件行为，不是真完整 TUI。

**确有真正启动 OpenCode 的测试脚本，但不在本次 88 项内。** `scripts/smoke-one-shot.mjs:3–17` 通过 kernel-lab 启动固定源码，查询真实工具列表并提交 noReply 消息核验原样保存，不调用模型；`kernel-lab.mjs:38` 才是 `bun src/index.ts serve` 的实际启动。`scripts/verify-steering.mjs:8–13` 引入真实内核及多个探针；`verify-packaged-steering.mjs:101` 经 PTY 启动包内 Mach-O。`.github/workflows/macos-test-package.yml:33–37` 将默认测试、构建和 native package smoke 分开，配置了 arm64/x64 matrix；本次未核实 GitHub Actions 是否实际成功运行，不能拿 YAML 当执行证据。

为遵守只写报告，本次未跑这些会创建仓内 fixture、安装配置依赖和模型请求的脚本；历史原始集成证据已读并在问题 7 核对。测试覆盖有限不等于“从未做过真实集成”。

### 6. Git 产物、大文件与 probe/verify 脚本

`git ls-files` 不跟踪 `external-plugins/steering/dist/index.js`、`dist/*`、worker bundle、ZIP、`.codeagent/*` 或包目录；对审计提交范围执行 `git log --format= --name-only 2c6eb4241^..5afc92399 -- external-plugins/steering/dist dist .codeagent` 也无输出。该独立 dist 文件本机存在但 ignored；`.gitignore:1–8` 忽略 node_modules/dist/coverage/log/.codeagent。`scripts/package-steering.mjs:14` 写 dist entry、`:17` npm pack，`build-test-package.mjs:68–69` 分别生成 codeagent.js 和 one-shot.mjs；**生成脚本和生成产物必须区分**。`scripts/smoke-one-shot.mjs` 虽文件名含 one-shot.mjs，但它是 1665 字节手写 smoke 源码，不是 worker bundle。

审计前根仓库 118 个 tracked 条目，最大普通文件为 `test/steering/plugin.test.mjs` 40,793 字节，次为 `ledger.ts` 40,275 字节、framework test 38,561 字节、`docs/baseline/evidence/steering-final.json` 36,904 字节。四个 baseline JSON 是跟踪的运行证据，可视为生成型文档资产；没有大于 1 MiB 的 tracked 普通文件。submodule 内部和旧 Git 历史未计入此测量，不据此宣称整个 `.git` 很小。

11 个 probe/verify 脚本合计 1784 行；对全部 tracked 文本按文件名查引用，结果如下。“有引用”不等于当前默认自动运行：

| 文件 | 其他 tracked 文件中的引用 |
| --- | --- |
| `probe-steering-api.mjs` | STEERING-FEASIBILITY.md、STEERING.md |
| `probe-steering-late-save.mjs` | STEERING-FEASIBILITY.md、STEERING-RECOVERY.md |
| `probe-steering-lifecycle.mjs` | verify-steering.mjs |
| `probe-steering-resume.mjs` | STEERING-FEASIBILITY.md |
| `probe-steering-termination.mjs` | STEERING-FEASIBILITY.md、steering-termination.json |
| `verify-steering.mjs` | DESIGN.md、STEERING-DELIVERY.md、plugin-guide.md、独立包 README |
| `verify-steering-history.mjs` | verify-steering.mjs |
| `verify-steering-late-save.mjs` | STEERING-FEASIBILITY.md、verify-steering.mjs |
| `verify-steering-native-task.mjs` | verify-steering.mjs |
| `verify-packaged-steering.mjs` | STEERING-PACKAGE-REAL-20261028.md |
| `verify-codex-user-entry.mjs` | CODEX-USER-ENTRY-ACCEPTANCE-20261028.md |

因此没有证据支持“全部无人引用，直接删”。主要债务是历史 probe 与当前 verifier 重叠、依赖旧 dist/report，且部分入口硬编码日期/路径。例如 Codex verifier `:12` 必须先有 `.codeagent/codex-user-entry-20261028/artifact.json`，`:20` 硬编码 Python，无法在普通新 clone 直接复现。建议保留行为矩阵和通用 harness，把必要 case 参数化接入 tests/smoke；仅有历史意义的脚本与当时证据一起归档。

### 7. 两个包与报告是否自洽、是否依赖本机

**旧包**没有名为“测评报告.md”的文件；主要说明为 `旧包/先看这里.md`。`:6` 明确复用旧内核二进制，`:14` 明确是 PTY 而非 Terminal.app GUI，`:93–94` 明确依赖本机环境，不是可搬迁安装器。这些限制与实际文件相符：

- `runtime/env.sh:4–7` 固定 Codex runtime Node、原仓库 `.codeagent/tooling` Bun、ChatGPT.app CLI。
- `config/full/opencode.json:4` 和 sample 配置指向旧包绝对路径；`project/one-shot.config.json:19–23` 等重复固定解释器/适配器路径。
- `project/.git/objects/info/alternates:1` 指向原仓库 `.git/objects`，移动/删除原仓库可能破坏对象读取；依赖也有本机共享。
- SHA256 清单 45 项本次全部匹配；`:104–107` 对启动、确定性 provider 与真实完整任务未重跑的区分合理。其“原代码83/83”是 915d9f9a8 的历史数字，不是现 HEAD。

**新包普通版**的 `测评报告.md:25–31` 描述公开加载链、外置 JS 与未修改内核、dirty 包装源码、arm64 portable ZIP；`:39–43` 区分真实 Codex CLI 中继、未知确切型号、独立 PTY 与 GUI。这些和本次读到的 BUILD、ZIP、trace 相符。没有发现它把 Finder 双击、Intel 或免费 Zen 失败宣称通过。

本次从原始文件抽查而非只引用 final-audit：

| 报告结论 | 本次证据核对 | 判断 |
| --- | --- | --- |
| 旧 bash 被拦、保留完成结果 | `实包证据/final-tests/real-tui-repeated-steering/messages.json:162` 的 error；同目录 project 实际 `KEEP`、`FINAL`；ledger `:286` stale-tool-blocked | 相互支持。 |
| 关闭插件后旧动作仍发生，最终也能改向 | `baseline-tests/real-tui-baseline-without-plugin/messages.json` 的 bash completed；project 有 OLD、FINAL、KEEP | 支持原生继续与插件 gate 的差异；不是性能比较。 |
| completion 自动恢复 | completion `ledger.json:209` attempts=[]；messages 没有 synthetic 控制记录；`AUDIT-NOTE.md:1` 纠正原标签 | 只能证明原生 automaticContinuation，最终报告 `:57` 已正确收窄；不得再次宣传为插件 recovery 分支实测。 |
| 取消后未自动续跑 | explicit-cancel ledger=cancelled、attempts=[]，project 为空 | 支持记录中的观察期结论，不能保证任何未来时刻/全部竞态。 |
| 17 次模型调用及身份 | 5/1/4/3/4 个 model 目录与 final-audit 分项对应，抽读真实事件有 usage 和成功退出 | 有较强历史 trace 支持；本次没有逐次重算全部 usage，也没有重新调用账号，确切模型型号仍未核实。 |
| ZIP/二进制校验及无源目录 symlink | 普通 ZIP SHA256 与报告 `:13` 一致，两 ZIP symlink=[]，现目录 SHA256 全匹配，kernel hash 与 BUILD 一致 | 本次独立核验成立。 |

源码对照报告的中文文件与仓库 baseline 文本相同。新包另有 `Codex入口实测.md:5–12` 和第二个 ZIP；其 88 项默认回归对应本次实测。普通报告 `:23/:72` 的 26 文件/84 测试描述初版，现解压目录 SHA256SUMS 是 31 项（含 codex-bridge 和新入口）。两个 ZIP 都保留且 hash 各有说明，属于版本口径漂移，不足以判定伪造；应把初版报告和增补报告分别绑定 ZIP hash。

新包的 TUI 主启动器按自身路径找 kernel/.opencode（`scripts/mac-native-launcher.c`，以及包 `start-opencode.sh:7–16`），ZIP 没有指向源码的 symlink，**没有证据表明其普通 TUI 必须依赖旧仓库绝对路径**。但 worker `start-worker.sh:9` 仍需要 Node 和开发项目/Git/模型；包示例不构成已配置好可运行的完整研发环境。Codex 可选入口需要已登录 CLI 和 Node，`scripts/start-with-codex.mjs:16–18` 优先 ChatGPT.app 约定路径，也允许 CODEX_BINARY/PATH。测试程序 `verify-codex-user-entry.mjs:20` 的 Python 绝对路径是 verifier 的不可迁移性，不应错误归给普通 TUI。

剩余未核实项：本次未重新启动包内 TUI/真实模型、未重建二进制、未验证 Finder 来源弹窗/签名、未在 Intel/其他机器运行；“从源码可完全重复构建同样字节”也未核实。当前 Bun 1.3.11 不满足构建脚本的显式门槛；旧 BUILD.bunVersion=1.4.2，不能把现环境测试绿灯当包可重建证明。

### 8. 对四份参考源码的抽查

以下均亲自读本地源码；没有依赖旧报告的网页链接来替代核对。`参考库/` 四仓库 HEAD 与 `docs/baseline/STEERING-SOURCE-COMPARISON-20261028.md:9–12` 完全一致，tracked 工作区干净：

| 库 | 本次 HEAD |
| --- | --- |
| opencode/opencode | `4d30794bcf4dccdcadbcb1f62bb35b4943a96426` |
| pi/pi | `936e5f40aede9327b9142b63506ed2b68bc6b4ac` |
| DSH/deepseek-harness | `687f282e8625c6b8d11ff58211a90524be2e4317` |
| codex/codex | `a96fa4f220700544a1202ec7ae411e432715151f` |

| 抽查的旧报告断言 | 本次参考源码证据（均为 `参考库/` 下路径） | 结论 |
| --- | --- | --- |
| `:44` DSH steer→next-step，followup→next-turn，inject 不唤醒；cancel 默认清 inbox | `DSH/deepseek-harness/packages/core/agent-loop/src/agent.ts:154–180`：send 的 target/wakeup、三方法参数、keepInbox 分支均明确 | 准确；abort 后 waking 输入重分类 next-turn 也在 `:157–160`。 |
| `:44` DSH inbox 可由事件重建、检查跨队列重复、claim next-step 优先 | 同库 `.../inbox.ts:26–54` 定义投影及 splice 边界/重复 ID 检查；`:109–112` 先 mutate 全部 next-step，再最多一条 next-turn | 准确。不是单纯一块内存数组；也不能因此推断 steer 会撤销当前外部工具。 |
| `:52` Codex 在 active_turn 锁内检查 turn ID/任务类型/schema，接收入队 | `codex/codex/codex-rs/core/src/session/turn_input.rs:853–895` 锁、活动 task、expected mismatch、Review/Compact 拒绝、空输入/schema；`:918–928` 入队并返回 turn/root IDs | 主要描述准确；文件 `:1–6` 明确响应不等待 hook、上下文、落盘或 sampling，旧报告对此的限制准确。 |
| 同一句 `:52` “验证取消” | 上述 `steer_input:843–929` 没有显式 cancellation_token 检查；旧报告另一引用 `.../input_queue.rs:179–204` 是 mailbox delivery，`:189` 才出现 token 条件 | 表述过宽，应删除或补精确 steer 生命周期调用链。不能由 mailbox 检查证明 steer_input 本身检查取消；是否由更外层状态转换间接保证，未核实。 |
| `:62–64` Pi 两个队列，开始/准备后/turn 结束消费 steering，自然停止时消费 follow-up；当前 batch 不自动撤销 | `pi/pi/packages/agent/src/agent.ts:197–198`、`:255–256`、`:308–324`；`agent-loop.ts:185`、`:210–214`、`:279`、`:304`、`:311` | 准确。executeToolCalls 返回后才再领取 steering；应用层可能另有持久化，不能扩大为整个 Pi 产品无持久化。 |
| `:70` 新 OpenCode SQL inbox、enqueued_seq、每会话锁、steer 优先和 compaction/move 边界 | `opencode/opencode/packages/core/src/session/sql.ts:127–144` 定义表/seq/index；`inbox.ts:59–62` 锁；`:505–536` serialized promote、steer/queue 范围；`:552–556` compaction 不越过 move | 准确，且有明确源码细节；“opencode2.0”只是用户对参考新版的称谓，本次未确认该 commit 发布版本号。 |

总体上，旧源码对照的核心机制有可靠依据，并明确限制，值得保留。主要修正是 Codex 取消检查的精度，以及不把“机制已读”推断为“旧 one-shot 每轮已完整审计四库”。后者旧报告 `:88` 自己已经否定，本次读取三个成功 run 的设计也没有发现四库完整来源清单；plan schema `one-shot/types.ts:61` 没有 sourceAudit 字段。这是流程验收缺口，不是证明旧 agent 从未读任何参考代码。
