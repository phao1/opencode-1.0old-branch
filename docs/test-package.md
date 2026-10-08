# Windows CLI 测试包

测试包针对 Windows x64，含 CLI opencode.exe、已打包的 CodeAgent 外置插件、命令/skill、独立 one-shot worker、配置示例、启动脚本及 BUILD.json/SHA256SUMS。不是 Desktop 安装器。Web UI 未嵌入；CLI/TUI/server 可测试。外置能力由启动脚本指定 OPENCODE_CONFIG_DIR 后加载，直接裸跑 exe 不保证加载该包。

## 从 GitHub 下载

dev push、针对 dev 的 PR 或手动触发 Actions → Windows test package 都会构建。等待全部检查、构建和“编译 exe + 插件注册”冒烟检查成功，再下载对应 run 的 `codeagent-opencode-windows-x64-<commit>` artifact。需要登录 GitHub，当前保留 30 天。下载 ZIP 完整解压，保留 .opencode 目录。SHA256SUMS 可验证内部文件；BUILD.json 记录内核与框架 commit。不能把一个 run 的 exe 和另一个 run 的插件混用。

自动化只有 contents:read 权限；不会创建 GitHub Release。长期归档时，人验收后可把同一个 ZIP 手工上传到 Release，标注框架 commit 和固定内核 commit。框架输出本地 PR 包但未推送时，不会触发远端构建。若 one-shot 用 git/gh 推送而 token 不能触发工作流，需手动 workflow_dispatch 或使用允许触发 Actions 的凭据。

## 本地准备

完整开发链路需要 Git、Bun 1.4.2+（1.x）、Node >=24、可用模型/凭据；自动 PR 还需 gh。CLI exe 自带 Bun 运行时，但独立 worker 和任务构建/测试仍需要这些开发工具。

```powershell
git clone --branch dev --recurse-submodules https://github.com/phao1/opencode-1.0old-branch.git C:\work\CodeAgentPlugin
cd C:\work\CodeAgentPlugin
bun install --frozen-lockfile
Copy-Item one-shot.config.example.json one-shot.config.json
```

编辑 one-shot.config.json，填好 OpenCode model、serverUrl 与真实检查命令。默认读取 server 的模型配置；建议为 Planner/Reviewer/Builder/Evaluator 配不同模型。先关闭不需要的 loops，确认连接和预算后再开启。源码扫描只建候选，不直接开始开发。

启动脚本使用包内插件/命令配置，并通过原生 OPENCODE_DISABLE_PROJECT_CONFIG 跳过项目配置，避免同时加载源码版插件。用户全局模型/账号配置仍可使用；项目专属 provider 配置需要复制到包内 opencode.json 或用户全局配置。one-shot.config.json 和项目 AGENTS.md 仍在项目中读取。二进制 --version 保留 1.3.17，使原生插件依赖解析使用真实已发布版本；区分测试构建请查看 BUILD.json 的 wrapperCommit。

## 三个 PowerShell 窗口

假设包解压到 C:\tools\codeagent，项目在 C:\work\CodeAgentPlugin。

窗口 1 启动测试版 server（模型账号可在窗口 3 的 TUI 中配置）：

```powershell
& C:\tools\codeagent\start-opencode.ps1 -Project C:\work\CodeAgentPlugin serve --port 4096 --hostname 127.0.0.1
```

窗口 2 启动 worker，负责扫描和执行已入队任务：

```powershell
& C:\tools\codeagent\start-worker.ps1 -Project C:\work\CodeAgentPlugin
```

窗口 3 打开测试版 TUI，输入 /create-issue 或 /one-shot：

```powershell
& C:\tools\codeagent\start-opencode.ps1 -Project C:\work\CodeAgentPlugin
```

TUI 与 worker 不共享正在聊天的会话：worker 调用配置的 server 创建独立会话。它们共享项目内 one-shot 状态。也可直接操作打包 worker：

```powershell
cd C:\work\CodeAgentPlugin
node C:\tools\codeagent\one-shot.mjs tick
node C:\tools\codeagent\one-shot.mjs status
node C:\tools\codeagent\one-shot.mjs todo --from-triage 0021
node C:\tools\codeagent\one-shot.mjs accept RUN_ID "人工用例已确认"
```

worker 运行时不用再启动第二个 worker/tick；扫描有锁。不要另开源码版 server 占用同一端口。退出 server/TUI 和 worker 即停止本次测试，测试包无系统安装步骤。脚本权限受限时，按你所在环境的 PowerShell 策略运行，勿覆盖正式版 opencode.exe。

## 自己构建

在 Windows x64 项目根目录执行：

```powershell
npm run typecheck
npm test
npm run package:test
node scripts/smoke-test-package.mjs dist/codeagent-opencode-windows-x64
```

本机生成 dist/codeagent-opencode-windows-x64/。脚本按当前主机平台构建；Linux/macOS 构建会产生对应平台二进制，不会声称 Windows exe 已验证。原生构建在临时 clone 执行，固定内核文件不会被构建生成物覆盖。下载模型列表、Bun 原生依赖等需要网络；失败必须解决后再重试。

仓库 lockfile 格式 v2，需要 Bun 1.4.2+ 读取；旧 Bun 1.3.11 会报 Unknown lockfile version。构建使用 frozen 安装。CLI-only 安装跳过生命周期脚本，验证预发布 Bash/PowerShell WASM 已存在，再使用原生 --single --skip-install 构建当前平台，避免无关 Electron/node-gyp 构建。产物保留 KERNEL-BUILD.bun.lock，BUILD.json 记录其 SHA256 与 Bun 版本；二进制并不承诺逐字节重现。
