import { tool } from "@opencode-ai/plugin"
import type { GlobalExtension } from "../../custom-hw/extension/global-extension.ts"
import { loadConfig, openStore } from "./store.ts"
import { createIssue, enqueue, cancel } from "./runner.ts"

export const OneShotExtension: GlobalExtension = async () => ({ tool: {
  one_shot_issue: tool({
    description: "Create a deduplicated candidate issue with evidence. This does not authorize execution. Use the one-shot CLI todo command to select it.",
    args: { title: tool.schema.string(), body: tool.schema.string(), source: tool.schema.string().optional(), sourceId: tool.schema.string().optional(), triageId: tool.schema.string().optional(), criteria: tool.schema.array(tool.schema.object({ id: tool.schema.string(), description: tool.schema.string() })).optional(), evidence: tool.schema.array(tool.schema.string()).optional() },
    async execute(args, context) {
      const config = loadConfig(context.directory), store = openStore(context.directory, config)
      return JSON.stringify(await createIssue(store, args))
    },
  }),
  one_shot_start: tool({
    description: "Queue a candidate issue for unattended one-shot execution. Requires explicit user permission; a separately running worker executes it.",
    args: { issueId: tool.schema.string() },
    async execute({ issueId }, context) {
      await context.ask({ permission: "one_shot_start", patterns: [issueId], always: [], metadata: { issueId } })
      const config = loadConfig(context.directory), store = openStore(context.directory, config)
      const run = await enqueue(context.directory, store, config, issueId)
      return JSON.stringify({ runId: run.id, status: run.status, worker: "npm run one-shot -- worker" })
    },
  }),
  one_shot_status: tool({
    description: "Read one-shot issues, stages, errors, evidence paths and human acceptance status.",
    args: { runId: tool.schema.string().optional() },
    async execute({ runId }, context) {
      const config = loadConfig(context.directory), store = openStore(context.directory, config)
      if (runId) return JSON.stringify(store.run(runId))
      const db = store.read()
      return JSON.stringify({ issues: Object.values(db.issues), runs: Object.values(db.runs).map(r => ({ id: r.id, issueId: r.issueId, status: r.status, phase: r.phase, error: r.error, workspace: r.workspace, publication: r.publication })), loops: db.loops })
    },
  }),
  one_shot_cancel: tool({ description: "Request cancellation of a one-shot run; worker aborts its active invocation.", args: { runId: tool.schema.string() }, async execute({ runId }, context) {
    await context.ask({ permission: "one_shot_cancel", patterns: [runId], always: [], metadata: { runId } })
    return JSON.stringify(await cancel(openStore(context.directory, loadConfig(context.directory)), runId))
  } }),
} })
