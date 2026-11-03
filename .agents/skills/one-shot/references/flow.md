# 节点输入、输出与完成条件

在目标仓库根执行 CLI；每次显式 `--run <id>`。状态变更受 .lock（pid）保护；只读 status/next 可随时执行。
状态写临时文件后 rename，死亡 pid 的陈旧锁自动回收。不要手工并发改 state.json。

fanout/impl/verify 可能运行 10–60 分钟，宿主的 shell 工具执行超时需足够长（例如 ≥3600000 ms）。
工具提前返回会话/进程仍在运行时，持续等待直到命令退出后再继续；提前返回间隔不是执行超时。
CLI 收到 SIGINT/SIGTERM 时会向所有活动子进程组发送 SIGKILL，分别以 130/143 退出；
这会丢掉进行中的 agent，属预期清理行为，不会让它们在后台继续运行。
中断后重跑同一命令：fanout 复用成功结果、重跑未完成 agent；impl 复用成功报告、未完成尝试另开轮次；
verify 重新顺序执行全部检查。状态和已完成证据保留，陈旧锁按死亡 pid 回收。

## brainstorm
输入 REQUIREMENT.md、AGENTS.md、相关源码；start brainstorm。
按模板写 BRAINSTORM.md，包含默认假设、边界和尺寸理由。
未显式指定尺寸时，start brainstorm --size S|M|L 保存判定；done brainstorm 检查非空产物。

## design
M/L：start design，按模板写 DESIGN.md（版本号、六个必备章节、A1 等验收 ID）。
版本号 `v\d+(\.\d+)*` 出现在前 10 行即可；章节去掉开头数字加 `.`/`、` 及空白后，以必备章节名开头即可。
为验证命令逐条 checks add，done design 校验章节。允许时 docs-only commit，message 引用 Design 路径。
Generator 只拿设计和仓库，因此关键输入不能留在聊天里。

## improve
fanout improve --round 1 并发 Evaluator；每个超时独立。
输入 REQUIREMENT.md、BRAINSTORM.md、DESIGN.md，以及上一轮 SUMMARY.md（若存在）；对照需求检查满足程度与范围边界。
输出 improve/round-N/<agent>.prompt.md、<agent>.md、<agent>.log 和 SUMMARY.md 骨架。
宿主读所有结果，填取舍表、更新设计版本与变更记录，移除 HOST_TODO 后 done improve。
0 成功时 DEGRADED.md + SUMMARY.md 自评；至少一成功即可继续。
采纳 P0 可再一轮，默认最多 2 轮。恢复相同轮次时跳过成功且非空的结果。

## impl
M/L：impl 新建 Codex Generator，会记录 JSONL 与 thread/session id。
prompt 告知 init 时的 state.baseCommit，累计改动以此为基准。
输出 impl/round-N/prompt.md、report.md、events.jsonl、generator.log；每次新轮次保留历史。
impl --fix findings.md 优先 exec resume <thread>，在仓库 cwd 执行，不向 resume 传 -C。
无 thread 则新会话；state.impl.attempts 保留 fix 文件、resumedFrom、参数与结果。
成功执行仍需宿主核对 diff/report 后 done impl。无 --fix/--round 时复用上一次非空成功报告；显式新轮次才重跑。
S：impl --inline，宿主实施，自己写 impl/round-1/report.md 后 done impl。

## verify
输入 state.checks（checks add "命令" --name 名称 登记，checks list 查看）。
verify 顺序执行所有检查，输出 verify/<n>-<name>.log 和 RESULT.md。
全部成功自动 done；失败保留 failed，修复后复验最多 3 次。没有检查命令拒绝通过。
修复引入新的行为时回写设计；不可将假 agent 测试冒充产品 smoke。

## review
L：fanout review --round N，并行只读对抗评审。
输入需求、Brainstorm、设计与上一轮 review SUMMARY.md（若存在），对照需求检查设计及实现是否满足、是否越界。
必须评审 git diff <baseCommit>，覆盖初始化以来已提交与未提交改动；用 git status --short --untracked-files=all
找出未跟踪新文件并逐个读取。baseCommit 为 null 时检查工作区并记录缺少 Git 基准的局限，不用当前 HEAD 替代。
宿主核实证据、填 SUMMARY.md、把采纳项写 findings.md → impl --fix → done impl → verify。
无被采纳 P0/P1 即停止，否则下一轮，默认最多 2 轮。达到上限仍有未解决 P0/P1 则保留阻塞。
各轮汇总都完成后 done review；脚本不自动解释 findings 或 verdict。

## deliver
输入已完成/有理由 skip 的上游节点、设计与验证证据。
start deliver → report → 允许时 commit → done deliver --note "说明" → report。
README.md 链接需求、设计、每轮汇总、实现日志与验证结果，并列时间线及 agent 降级。
Evaluator 逐个展示身份、模型与 durationMs；缺失模型或耗时显示 `-`。
commit message 包含 Design: <path>，不要求 Co-Authored-By。用户禁止提交则留待用户审查。
不自动 push、merge、发布。阻塞时 report 生成现状，不假标 deliver 完成。

## CLI 与配置细节

- 所有命令支持 --json、--run id、--config file。最近一次未完成 run 是默认值；无则报错。
- init --title t [--size S|M|L] [--req file|-] [--slug s]。同一分钟同 slug 冲突时拒绝覆盖，用新 slug。
  run id 的 YYYYMMDD-HHMM 使用本地时间，state 的 ISO 时间保持 UTC。
  初始化记录 git rev-parse HEAD 为 baseCommit；非 Git 仓库或无可用 HEAD 时为 null。
- status 返回完整状态；next 返回首个未完成节点与本文件对应段落。
- start/done node [--note text]；skip node --reason text。skip 是宿主的显式裁剪决定，必须记录理由。
- fanout improve|review [--round N] [--agents a,b] [--timeout 秒]。
- run "需求" [--bg] 启动新宿主；resume [--bg] 在宿主 PID 不存活时重新启动。
  前台等待宿主，后台 detached 且重定向日志。宿主运行时不持有 CLI 锁，允许其执行节点命令。
- report 可随时刷新索引，阻塞时也可调用。
- agents [--refresh]：并行 PONG 探测，默认 90s/agent；缓存 ~/.cache/oneshot/agents.json，TTL 6h。
  ONESHOT_CACHE_DIR 可隔离缓存。认证错误优先于退出码/PONG；不同 agent 配置不共享探测结果。
- 默认池在 config.json；仓库 oneshot.config.json 或 --config file 浅覆盖设置，agents 数组整体替换。
  generator/host 各自合并 bin、model 配置。未知/重复 agent id、未声明 readonly 的配置拒绝执行。
- agent 字段：id、bin（字符串或候选数组）、model、args（argv 数组）、stdin（布尔）、
  readonly:true、output（file 或 stdout）。模板变量 {cwd}、{prompt_file}、{out_file}、{model}、{instruction}。
  完整 prompt 总在文件中；stdin=true 时只传「读取并执行该文件」短指令；否则 args 使用 {instruction}。
  output=file 使用 agent 自己写的 out_file（Codex -o）；stdout/stderr 同时写日志。
- Codex 只读模式由 -s read-only 强制；其他 CLI 依赖其版本的 readonly 参数与 prompt，默认参数需按本机版本核对。
  探测失败即不可用，不为绕过认证或参数错误切换到可写模式。
- 全部失败也正常返回并在 state.rounds[kind][round].degraded 留痕；宿主承担自评责任。
  节点未关闭前不要把 fanout 的成功执行误解为设计已完成。
- config 中还可设 agentTimeoutSeconds、generatorTimeoutSeconds、checkTimeoutSeconds、
  maxImproveRounds、maxReviewRounds、probeTimeoutSeconds、cacheTTLHours。
  agentTimeoutSeconds 默认 1500 秒，generatorTimeoutSeconds 默认 3600 秒。
- install.sh 默认只链接 ~/.agents/skills/one-shot；ONESHOT_INSTALL_DIR 可改安装根目录，已有非同源路径拒绝覆盖。
