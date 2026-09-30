import path from "node:path"
import { readFileSync } from "node:fs"
import { setTimeout as delay } from "node:timers/promises"
import { loadConfig, openStore, lock } from "../agent-kernel-extension/src/codeagent/one-shot/store.ts"
import { createIssue, enqueue, runQueue, resume, cancel, accept, reject } from "../agent-kernel-extension/src/codeagent/one-shot/runner.ts"
import { executeAgent } from "../agent-kernel-extension/src/codeagent/one-shot/agents.ts"
import { tick } from "../agent-kernel-extension/src/codeagent/one-shot/loops.ts"

const [command, ...args] = process.argv.slice(2)
const help = `one-shot commands:
  issue <signal.json>            create a candidate (sourceId/triageId enable handoffs)
  todo <issue-id|--from-triage ID> authorize and queue one development run
  status [run-id]                inspect state and evidence
  run                           execute pending jobs, then exit
  tick                          execute due monitor/input loops, then exit
  worker                        continuously run loops and development jobs
  resume <run-id>                retry a blocked/cancelled phase (no budget reset)
  cancel <run-id>                abort active invocation
  accept <run-id> <note>         record final human acceptance
  reject <run-id> <feedback>     request repair and re-evaluation
Config: one-shot.config.json. Override ONE_SHOT_ROOT or ONE_SHOT_CONFIG.
`
if (!command || command === "help" || command === "--help") { console.log(help); process.exit(0) }
const root = path.resolve(process.env.ONE_SHOT_ROOT ?? process.cwd())
try {
  const config = loadConfig(root, process.env.ONE_SHOT_CONFIG), store = openStore(root, config)
  let result: unknown
  switch (command) {
    case "issue": result = await createIssue(store, JSON.parse(readFileSync(path.resolve(args[0]), "utf8"))); break
    case "todo": {
      let issueId = args[0]
      if (issueId === "--from-triage") {
        const matches = Object.values(store.read().issues).filter(i => i.triageId === args[1])
        if (matches.length !== 1) throw new Error(`Expected one issue for triage ${args[1]}, found ${matches.length}`)
        issueId = matches[0].id
      }
      result = await enqueue(root, store, config, issueId); break
    }
    case "status": result = args[0] ? store.run(args[0]) : store.read(); break
    case "resume": result = await resume(store, args[0]); break
    case "cancel": result = await cancel(store, args[0]); break
    case "accept": result = await accept(store, args[0], args.slice(1).join(" ")); break
    case "reject": result = await reject(store, args[0], args.slice(1).join(" ")); break
    case "tick": result = await tick(root, store, config); break
    case "run": result = await runQueue(root, store, config); break
    case "worker": {
      const release = await lock(path.join(store.directory, "daemon.lock"), 0)
      const controller = new AbortController()
      const stop = () => controller.abort()
      process.on("SIGINT", stop); process.on("SIGTERM", stop)
      try {
        // Monitoring remains scheduled while development jobs take minutes/hours.
        await Promise.all([
          (async () => { while (!controller.signal.aborted) {
            console.log(JSON.stringify({ loops: await tick(root, store, config, { signal: controller.signal }) }))
            await delay(1000, undefined, { signal: controller.signal }).catch(() => {})
          } })(),
          (async () => { while (!controller.signal.aborted) {
            console.log(JSON.stringify({ runs: (await runQueue(root, store, config, executeAgent, controller.signal)).map(r => ({ id: r.id, status: r.status, error: r.error })) }))
            await delay(1000, undefined, { signal: controller.signal }).catch(() => {})
          } })(),
        ])
      } finally { controller.abort(); process.off("SIGINT", stop); process.off("SIGTERM", stop); release() }
      result = { stopped: true }; break
    }
    default: throw new Error(help)
  }
  console.log(JSON.stringify(result, null, 2))
  if (Array.isArray(result) && result.some(r => r.status === "blocked" || r.ok === false)) process.exitCode = 1
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
