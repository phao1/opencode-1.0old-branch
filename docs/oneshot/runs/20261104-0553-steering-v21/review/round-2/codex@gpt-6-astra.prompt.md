对抗性 review：主动找 bug、回归、遗漏和与 design 不符之处。
只读，不改任何文件，不运行会改变仓库的命令。
仓库：/Users/penghao/Documents/code/oneshot/one-show-code/opencode-1.0old-branch
设计：/Users/penghao/Documents/code/oneshot/one-show-code/opencode-1.0old-branch/docs/oneshot/runs/20261104-0553-steering-v21/DESIGN.md
原始需求：/Users/penghao/Documents/code/oneshot/one-show-code/opencode-1.0old-branch/docs/oneshot/runs/20261104-0553-steering-v21/REQUIREMENT.md
需求分析：/Users/penghao/Documents/code/oneshot/one-show-code/opencode-1.0old-branch/docs/oneshot/runs/20261104-0553-steering-v21/BRAINSTORM.md
上一轮 SUMMARY.md：/Users/penghao/Documents/code/oneshot/one-show-code/opencode-1.0old-branch/docs/oneshot/runs/20261104-0553-steering-v21/review/round-1/SUMMARY.md
初始化基准 commit：586505b2160b7428300ae5df4efb40d3e67dbce1
run：/Users/penghao/Documents/code/oneshot/one-show-code/opencode-1.0old-branch/docs/oneshot/runs/20261104-0553-steering-v21；轮次：2
阅读原始需求、需求分析、上一轮汇总（若存在）、AGENTS.md、设计与相关调用路径；对照需求判断设计及实现是否满足验收、是否遗漏或越界。
基准非 null 时必须评审 `git diff 586505b2160b7428300ae5df4efb40d3e67dbce1`（覆盖从初始化起已提交与未提交的累计改动），并用 `git status --short --untracked-files=all` 找出未跟踪新文件，逐个读取并纳入评审。
基准为 null 时不可执行 `git diff null`；检查可用的工作区文件并说明缺少 Git 基准的评审局限，不以当前 HEAD 代替初始化基准。
验证可触发条件，区分事实和推测。
每条发现严格输出：
- [P0|P1|P2] 标题 — 说明 (evidence: path:line)
用实际 P0/P1/P2 替换占位；给出影响、复现条件，避免只报风格问题。
最后单独一行：VERDICT: approve 或 VERDICT: request-changes
无发现时说明审查范围，仍给出 verdict。
