# macOS CLI 测试包

测试包含 macOS 原生 `opencode`、已打包的 CodeAgent 外置插件、命令/skill、独立 one-shot worker、配置示例、Bash 启动脚本及 BUILD.json/SHA256SUMS。提供 Apple Silicon arm64 和 Intel x64 两种包。不是 Desktop .app/.dmg 安装器；Web UI 未嵌入，支持 CLI/TUI/server。

## 下载并解压

dev push、针对 dev 的 PR 或手动触发 Actions → macOS test package 都会构建。在对应架构的检查、构建和实际二进制插件注册冒烟检查通过后，下载 `codeagent-opencode-darwin-<arch>-<commit>` artifact。需要登录 GitHub，当前保留 30 天。

先在 Mac 终端执行 `uname -m`：`arm64` 下载 arm64 包（M 系列），`x86_64` 下载 x64 包（Intel）。如果终端运行在 Rosetta 下，请以“关于本机”显示的芯片为准，Apple M 系列优先使用原生 arm64 包。

Actions 下载的是外层 ZIP；解压 ZIP 后得到 tar.gz，再解压以保留隐藏插件配置和执行权限：

```bash
mkdir -p "$HOME/tools"
tar -xzf "$HOME/Downloads/codeagent-opencode-darwin-arm64.tar.gz" -C "$HOME/tools"
```

Intel 用户把下文的 `darwin-arm64` 改为 `darwin-x64`。保留整个包，不能只复制 opencode 或混用不同提交的插件。验证包内文件：

```bash
cd "$HOME/tools/codeagent-opencode-darwin-arm64"
shasum -a 256 -c SHA256SUMS
cat BUILD.json
```

该测试包没有 Developer ID 签名/公证步骤。若 macOS 阻止运行，先核对下载来源与 BUILD.json、校验文件，再按系统隐私与安全性提示允许；不要关闭全局 Gatekeeper。也可直接从 dev 源码在自己 Mac 构建。

自动化只有 contents:read 权限，不会创建 GitHub Release。长期归档时，人验收后可把同一个 tar.gz 手工上传到 Release，标注框架和固定内核 commit。只输出本地 PR 包、未推送时不会触发远端构建；如果推送凭据不能触发工作流，需手动运行 workflow_dispatch。

## 开发环境

完整开发链路需要 Git、Bun 1.4.2+（1.x）、Node >=24、可用模型/凭据；自动 PR 还需 gh。opencode 自带 Bun 运行时，但 worker 和任务构建/测试需要这些开发工具。

```bash
git clone --branch dev --recurse-submodules https://github.com/phao1/opencode-1.0old-branch.git "$HOME/work/CodeAgentPlugin"
cd "$HOME/work/CodeAgentPlugin"
bun install --frozen-lockfile
cp one-shot.config.example.json one-shot.config.json
```

编辑 one-shot.config.json，填好 OpenCode model、serverUrl 和真实检查命令。默认读取 server 模型配置；建议 Planner/Reviewer/Builder/Evaluator 使用不同模型。先关闭不需要的 loops，确认模型连接和预算后再开启；源码扫描只建候选，不直接开始开发。

启动脚本设置包内 OPENCODE_CONFIG_DIR，并通过原生 OPENCODE_DISABLE_PROJECT_CONFIG 跳过项目配置，避免同时加载源码版插件。用户全局模型/账号配置仍可使用；项目专属 provider 配置需要复制到包内 .opencode/opencode.json 或用户全局配置。one-shot.config.json、AGENTS.md 仍从项目读取。

二进制 --version 保留 1.3.17，使原生插件依赖解析使用真实已发布版本；测试构建的框架版本查看 BUILD.json 的 wrapperCommit。

## 三个终端窗口

窗口 1 启动测试版 server：

```bash
bash "$HOME/tools/codeagent-opencode-darwin-arm64/start-opencode.sh" \
  "$HOME/work/CodeAgentPlugin" serve --port 4096 --hostname 127.0.0.1
```

窗口 2 启动 worker，负责扫描和执行已入队任务：

```bash
bash "$HOME/tools/codeagent-opencode-darwin-arm64/start-worker.sh" \
  "$HOME/work/CodeAgentPlugin"
```

窗口 3 打开测试版 TUI，配置模型账号后输入 /create-issue 或 /one-shot：

```bash
bash "$HOME/tools/codeagent-opencode-darwin-arm64/start-opencode.sh" \
  "$HOME/work/CodeAgentPlugin"
```

TUI 和 worker 不共享聊天会话；worker 调用配置的 server 创建独立会话，二者共享项目的 one-shot 状态。也可直接操作打包 worker：

```bash
cd "$HOME/work/CodeAgentPlugin"
node "$HOME/tools/codeagent-opencode-darwin-arm64/one-shot.mjs" status
node "$HOME/tools/codeagent-opencode-darwin-arm64/one-shot.mjs" todo --from-triage 0021
node "$HOME/tools/codeagent-opencode-darwin-arm64/one-shot.mjs" accept RUN_ID "人工用例已确认"
```

worker 运行时不要再启动第二个 worker/tick。Ctrl+C 退出各窗口即停止本次测试；没有系统安装步骤，也不覆盖正式版 opencode。

## 自己构建

在原生架构的 Mac 终端、项目根目录执行：

```bash
npm run typecheck
npm test
npm run package:test
node scripts/smoke-test-package.mjs "dist/codeagent-opencode-darwin-$(node -p process.arch)"
```

本机生成 dist/codeagent-opencode-darwin-arm64/ 或 dist/codeagent-opencode-darwin-x64/。脚本按当前 Node/Bun 主机架构构建；Linux 构建不能代替 Mac 验证。

原生构建在临时 clone 执行，固定内核不被生成文件覆盖。需要网络下载模型列表与依赖。macOS 使用 frozen 原生 lock，跳过无关 Electron/node-gyp 生命周期脚本，并验证预发布 Bash/PowerShell WASM 已存在。KERNEL-BUILD.bun.lock、BUILD.json 记录构建依赖与版本，二进制不承诺逐字节重现。

冒烟检查验证真实二进制启动与 one-shot 工具注册；真实模型的端到端开发质量仍需配置模型后另外验收。
