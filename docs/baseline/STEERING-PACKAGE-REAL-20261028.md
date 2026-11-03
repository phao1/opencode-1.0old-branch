# Mac 实际运行包与 Steering 测评报告

日期：2026-10-28（Pacific/Auckland）。结论：**普通 TUI 的实际包启动、四项真实模型行为和无插件对照已完成；已测 Big Pickle 免费直连因额度限制未通过。** 本报告保留失败与未覆盖项，不等同于全部平台、全部模型或发布验收通过。

## 交付文件和实际打包机制

可直接使用的本地目录：

`/Users/penghao/Documents/code/oneshot/OpenCode-Real-Package-20261028/codeagent-opencode-darwin-arm64`

压缩包：`/Users/penghao/Documents/code/oneshot/OpenCode-Real-Package-20261028/CodeAgent-OpenCode-Mac-arm64.zip`，38,023,054 字节。

ZIP SHA256：`179b115e8bdc4335c5be68ba6ebc26799e4f39a7b5da72023475a1b96cd8ccc3`。

| 包内文件 | 责任 |
| --- | --- |
| opencode | 新增的原生 arm64 Mach-O 入口，自动设置包内插件配置并处理首次颜色查询兼容 |
| opencode-kernel | 重新从固定源码构建的 OpenCode 1.3.17 内核；没有改其 tracked 源码 |
| .opencode/plugins/codeagent.js | 外置 JS bundle，含 registry bridge、OneShot、capability watch 和主 steering |
| .opencode/skills、command | 研发 skills 与命令 |
| one-shot.mjs、start-worker.sh | 独立 worker；不会因为打开 TUI 就自动跑后台开发 |
| 启动OpenCode.command | 可双击入口，打开包内 workspace 练习目录 |
| BUILD.json、SHA256SUMS | 构建身份与 26 个交付文件的校验记录 |

实际加载链：Mac 原生入口 → OPENCODE_CONFIG_DIR 指向包内 .opencode → 原固定内核公开插件加载器 → CodeAgentPlugin → bundledGlobalExtensions + SteeringPlugin。

**插件随整个包分发，没有编入原内核二进制。** 这符合当前 AGENTS.md 的“固定内核 + 外置插件/公开 bridge + 自定义 registry”机制。只复制某个 exe/内核文件不等于插件已经激活；本次实际运行证明 one_shot_issue/start/status/cancel 和 steering_status 均已注册，三个研发 skills 及命令也能加载。

构建基于 dev1024 的 `915d9f9a8` 加本次本地打包补丁，BUILD.json 标记 dirty=true；固定内核为 `517e6c9aa4c61dbc125e7654fc596f1d529f20d9`。最终内核文件 SHA256 为 `30e3f434f48678c49c6a47e6e51a7c099d096daef7897b35c5ebe93d677312af`。源码重建在临时 clone 完成。未推送本次补丁，未 npm publish、创建 Release 或发布安装器。

这是 arm64 便携运行 ZIP，**不是 Desktop .app/.dmg 安装器**；没有 Developer ID 发布签名和 Apple 公证。没有关闭系统安全机制。Intel 架构未在本次构建测试。

## 怎样测试，哪些是真实的

先构建 ZIP，再解压到一个新的中文/空格路径，从该目录执行包内 Mach-O。没有从 `agent-kernel/src/index.ts` 或源码 Bun dev 命令启动被测程序。

测试程序拥有独立 PTY，像终端一样回复颜色、设备能力与窗口查询，并通过普通 TUI 的键盘和粘贴输入原始任务、steer 消息和取消动作。被测程序使用普通 TUI 的内部 RPC 路径。会话只读观察来自原生 SQLite；工具执行、文件变化、原始 provider 请求、模型结果与插件 ledger 分别留证。

真实模型通道为本机已登录 **Codex CLI 0.164.0-alpha.11.1 的默认模型，low reasoning，经本地 Chat Completions 桥接**。17 次 CLI 调用均有成功退出和事件记录。没有用预先写好的模型答案替代它：模型根据收到的 OpenCode 对话与工具定义选工具，实际 bash 由解压包中的 OpenCode 执行；桥接本身禁止另行执行工具，并检查 CLI 事件。前几项为了稳定复现竞态，暂存了已经由真实模型产生的响应；另有一项不暂停响应、在真实 bash 正运行时输入指导。

CLI 公开事件没有给出确切 model ID，故不猜测具体型号，也不称为多模型对抗评审。记录到 input_tokens=345843、cached_input_tokens=12288、output_tokens=889、reasoning_output_tokens=84；这是 CLI 用量，不据此推算美元费用。OpenCode 的桥接 UI 费用不能当作实际免费凭据。

原始终端 ANSI 是测试终端的输出，不是用户 Terminal.app 的 GUI 截图。**未通过桌面工具观察 Finder 的真实鼠标双击或系统来源弹窗**；执行过的是包里同一个双击入口文件。此边界与真实进程/模型/工具执行分别报告。

## 真实行为结果

| 用例 | 真实调用 | 观察结果 |
| --- | --- | --- |
| 连续两次插话 | 5 | completed.txt=KEEP 保留；已生成的 old.txt 写入调用收到 STEERING_STALE_CONTEXT；只得到 final.txt=FINAL，old/intermediate 均不存在；原始三条用户消息未改写 |
| 插话后在 TUI 双 Esc 停止 | 1 | ledger=cancelled；没有执行旧/新写入，观察期间没有自动恢复 |
| 旧文本完成边界继续处理指导 | 4 | recovered.txt=RECOVERED，原指导只保存一次；本例走原生自然继续，见下文限定 |
| 真正 bash 执行中插话，无响应暂存 | 3 | STARTED 已落盘、DONE 尚未落盘时保存指导；原命令随后完成，下一步写 NEW，旧的后续文件没有创建 |
| 相同包关闭外置插件的对照 | 4 | 原生最终也采用新指导，但旧模型决定仍创建了 old.txt=OLD，然后才创建 final.txt=FINAL |

无插件对照使用同一 ZIP、同一原生入口和内核，通过公开 OPENCODE_PURE 开关关闭外置加载，没有改写内核。它证明原生已有 busy 输入及最终改向能力；**插件增加的实测价值是：在模型尚未读到新指导的旧工具调用经过检查点时阻止它执行。** 当前工具已经执行的副作用不在这个保证内。

完成边界例最初 harness 的 automaticRecovery 标签过宽。独立核对实际消息和 ledger 后，发现 recovery.attempts=[]，没有 synthetic 控制记录，故该例只能证明 automatic continuation，**不能证明插件的特殊恢复分支被触发**。原始记录保留，当前 verifier 已区分 automaticContinuation 和 pluginRecoveryObserved。它不是新的一条已证实恢复能力。

## 免费模型确实请求过

最终解压包直接请求了 `opencode/big-pickle`，禁用标题等辅助模型，使用匿名免费入口。约 4.6 秒得到真实的 **429 / FreeUsageLimitError**，随后停止重试。

OpenCode [官方 Zen 文档](https://dev.opencode.ai/docs/zen/)列有免费模型；免费列表不保证当前请求能取得额度。本次结果是“外部免费额度阻塞”，没有把它计作功能通过。后续真实行为测试使用上面的已登录 CLI 通道，**不冒充 Zen 直连验收**。也没有自动替用户充值或连接新付费账号。

## 启动与回归检查

- 同一包的原生入口与双击入口文件均打开了首页；Ctrl+P、连接菜单、缩放和退出有实际终端证据。
- 最终交付目录用正常用户配置直接执行原生 opencode，再次验证首页、Ctrl+P 和正常退出；该项没有发送模型请求。
- 在只有 `/usr/bin:/bin:/usr/sbin:/sbin` 的 PATH 下，最终交付目录仍能启动 TUI；没有从 PATH 使用外部 Node/Bun，启动器本身也不调用 Python。完整 worker/开发链仍需要 Node、Git、模型等环境。
- 原生 C 查询过滤有 32 组分块/逐字节合同检查；另有一条可重复执行的 Node 测试文件，覆盖同样的流式协议责任。
- 原生启动器针对忽略 SIGTERM 的停滞夹具约 27 秒退出，恢复终端并写诊断，不无限黑屏。
- 最终 npm test：84/84（已将新增 Mac launcher contract 接入默认命令）；其中流式查询过滤检查覆盖 32 个分块情形。typecheck、固定内核检查、git diff --check 通过。
- ZIP 不包含指向源码的符号链接；首次真实运行后，交付清单中的 26 个文件仍匹配校验。

修复了三个实际打包问题：旧入口不自动选包内插件；初始颜色查询回复能使 TUI 卡住；内核自动给配置补 `$schema` 会破坏首次运行前后的校验一致性。现在由原生入口设置公开配置、过滤首次查询，打包配置预先包含 schema。

## 优点与缺点

优点：外置边界保持完整；真实旧动作拦截具有可见价值；取消和消息证据可核对；当前正在执行的动作和已完成工作可保留，在下一检查点自然改向；Mac 包已有不依赖源码脚本的原生入口。

限制与缺点：

1. 没有 Codex 式 expected_turn_id 原子接收。保存、准备、provider 收到和语义采纳是不同事实，状态中的 unknown 仍要保留。
2. 不能撤回已经越过公开检查点的动作。batch 内部、StructuredOutput、MCP 等边界不能推导成全局即时停止保证；本次没有真实模型覆盖所有工具种类。
3. 插件 ledger 不是原生持久化 inbox；重启不会自动跑历史 pending。没有 DSH/新版 OpenCode 那样完整的队列编辑与生命周期控制面。
4. 额外携带外部调试端口的 TUI 启动曾稳定复现首帧超时，尚未修复该固定内核路径。普通 TUI 与单独的 server 模式通过，失败记录保留；未通过修改私有内核隐藏问题。
5. Zen 免费直连本次限流；真实通过的是 CLI 桥接通道。桥接额外引入进程开销，不能据此保证所有模型和原生 provider 流式行为一致。
6. 这不是签名公证的图形安装体验。Finder 实际点击/来源弹窗和 Intel Mac 仍未观察。
7. 本次包加载的是主 CodeAgentPlugin。之前 OneShot 生成的 summary:true 小样仍是独立成果，未合入该主入口，不能把两套 API 混为一谈。

## DSH、Codex、Pi、新版 OpenCode 与 OneShot

完整的身份、文件、行号、调用链、优缺点见 [源码对照报告](STEERING-SOURCE-COMPARISON-20261028.md)。本次确实读取了用户给出的四份本地源码，而非只引用文章或名称。

| 对象 | 主要区别 |
| --- | --- |
| 本插件 | 在旧公开 hook 上记录覆盖关系、阻止旧动作；低侵入，但无内核原子事务 |
| DSH | 驱动器拥有事件持久化的 next-step/next-turn inbox，领取与取消职责更完整 |
| Codex | 持有 active-turn 锁校验 expected turn 再接收输入；接收确认仍不等于模型已采纳 |
| Pi Base Agent | 轻量的 steering/follow-up 内存队列，边界清楚；所给版本在工具 batch 返回后再领取 |
| 新版 OpenCode | SQL inbox、每会话锁、明确 steer 优先级与压缩/移动生命周期，升级成本也更大 |

OneShot 已有真正的阶段状态机、并行评审、检查绑定、受信检查和人工交付边界，不只有提示词。旧 run `run-1e5b897b-36ce-47a6-a9da-ffec7d9fb465` 当前仍为 awaiting_acceptance，7 次阶段调用及 5 组检查成功可核对。

但“每轮都对比所有参考源码”不是当前 plan schema 的强制字段，reviewer ID 唯一也不等于不同模型。旧设计没有四库来源清单，不能声称每次都完整读过。此次已补齐源码审计；建议把用户指定的 sourceAudit 和模型多样性证据纳入后续设计/评估合同。

本次没有重跑最终包里的完整 OneShot 自动开发链，不能把 Steering 的 17 次模型调用说成该链再次端到端通过，也没有擅自把任何 run 标为人工 accepted。

## 自己打开和试用

1. 在 Finder 打开上述新交付目录，双击 `启动OpenCode.command`。请使用新目录，不要再打开旧 OpenCode-Mac-Test-915d9f9a8 的裸内核。
2. 也可直接运行原生入口：`"/Users/penghao/Documents/code/oneshot/OpenCode-Real-Package-20261028/codeagent-opencode-darwin-arm64/opencode" "/你的项目目录"`。无需 bash 包装或手动填写插件环境变量。
3. 需要可用模型。已测 Big Pickle 免费请求有限额错误，其他免费模型未逐一验证；本机 Codex CLI 已登录不代表 OpenCode 自动共享其登录。可以在 TUI 用 /connect、/models 选择已连接且可用的提供商；本次桥接只由测试程序启动，没有静默改写全局账号配置。
4. 先要求分步骤写文件、每步独立调用工具；运行中输入 `steer: 保留已完成工作，下一步改为写 result.txt，停止原后续步骤。`。观察文件、旧工具错误及后续行为。查询状态用 steering_status，不要把 saved/prepared 当作采纳证明。

## 原始证据与复现

主证据目录：`/Users/penghao/Documents/code/oneshot/one-show-code/opencode-1.0old-branch/.codeagent/package-real-steering-20261028/`。

- `final-audit.json`：独立复核实际文件、旧模型决定、工具错误、provider 上下文顺序、取消状态、原生继续路径、模型用量和交付校验。
- `final-tests/`：连续插话、取消、完成边界的真实请求/CLI 事件/消息/ledger/ANSI。
- `in-flight-tests/`：没有响应暂存的真实工具执行中插话。
- `baseline-tests/`：关闭插件的真实模型对照；old.txt 确实存在。
- `free-final-package/report.json`：最终包的免费 Zen 429 证据。
- `double-click-entry/`、`minimal-system-path/`、`watchdog/`：入口、独立性和超时恢复检查。
- `normal-user-delivery.json`：正常用户配置下的最终交付目录启动检查。
- `source-inventory.json`：四份参考源码和目标仓库的 commit/branch/remote/dirty。
- `build-final.log`、`archive-final.sha256`、`regression-final.log`、`typecheck.log`、`mac-launcher-contract.log`。

复现脚本是 `scripts/verify-packaged-steering.mjs`，必须显式传入真实解压目录，并提供已登录的 CODEX_BINARY 和测试所用 PYTHON_BINARY。默认运行四项行为与无插件对照，可用 --case=steering/cancel/completion/in-flight-tool/baseline 单独执行；测试会消耗真实模型用量。测试 Python/Node 属于观测端，最终 Mac TUI 启动不依赖它们。
