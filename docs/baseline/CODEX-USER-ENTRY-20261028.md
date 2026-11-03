# 使用已登录的 Codex CLI 模型

在 Mac 包中双击 **使用Codex模型启动.command**。原来的 **启动OpenCode.command** 保持原有模型配置。

新入口会为本次 OpenCode 会话启动仅监听本机的模型转接服务，将默认模型选成 **Codex CLI（已登录账号）**。模型回答来自已登录的 Codex CLI；对话管理、工具执行和 steering 检查仍由 OpenCode 及其插件负责。退出 TUI 后，本地服务和未完成的 CLI 请求会关闭。无需再在 OpenCode 里粘贴 API Key，不复制 Codex 登录文件，也不修改全局模型配置。

需要本机 Node.js 24+ 和已登录的 Codex CLI；本机已有的 Codex runtime Node 可被启动入口自动发现。Codex 桌面 App 自带 CLI 路径优先，也支持 CODEX_BINARY 指定路径或 PATH 中的 codex。使用 Codex 账号的正常用量，不属于免费的 Zen 通道。

默认在包内 workspace 练习目录打开。终端也可执行：

```bash
bash '/完整路径/使用Codex模型启动.command' '/你的项目目录'
```

当前入口使用 CLI 默认模型、low reasoning；需要特定型号时可以显式设置 CODEX_MODEL。这里没有自动枚举你账号的全部模型，不根据名称猜测可用权限。

这是一个文本/工具调用桥接：每次先得到完整模型结果，再交给 OpenCode 展示或执行，一次返回一个工具调用。暂不支持图片和所有原生 API 参数，不等价于 Codex 原生 app-server 的流式会话或 turn/steer。OpenCode 展示的费用不能当作实际账单。

桥接程序不持久保存原始请求或回答；每次请求的临时文件在结束时删除。codex-bridge/.runtime/last-run.json 仅记录请求次数、用量、退出等运行元数据；OpenCode 和 Codex 自身的正常日志机制仍各自存在。

组件测试使用明确标注的替代 backend，覆盖本机认证、请求格式、UTF-8、取消及超时清理，不作为真实模型证据。真实入口测试另在独立 PTY 中执行包内同一文件，检查 Codex 模型选择、实际回答和 OpenCode 工具结果；Finder 鼠标双击未自动观察。

CLI 结构化输出接口参考：[OpenAI 官方非交互模式文档](https://learn.chatgpt.com/docs/non-interactive-mode)。
