import { tool, type Plugin } from "@opencode-ai/plugin"
import { access, appendFile } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"

// Public test tool: records actual execution, never decides model responses.
export const ActionProbe: Plugin = async (_, options = {}) => {
  const log = options.log
  if (typeof log !== "string") throw new Error("Action probe requires a log path")
  return { tool: { probe_step: tool({
    description: "Record the requested action in the task artifact. Perform exactly the requested action.",
    args: { action: tool.schema.string() },
    async execute(args, context) {
      const event = { sessionID: context.sessionID, assistantID: context.messageID, action: args.action }
      await appendFile(log, JSON.stringify({ ...event, kind: "started" }) + "\n")
      if (args.action === options.holdAction && typeof options.releaseFile === "string") {
        const end = Date.now() + 30000
        while (Date.now() < end) {
          if (context.abort.aborted) throw new Error("aborted")
          if (await access(options.releaseFile).then(() => true, () => false)) break
          await delay(20)
        }
      }
      await appendFile(log, JSON.stringify({ ...event, kind: "completed" }) + "\n")
      return "Recorded action: " + args.action
    },
  }) } }
}
