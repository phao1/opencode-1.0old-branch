import type { Plugin } from "@opencode-ai/plugin"
import { z } from "zod"
import { SteeringLedger } from "./steering/ledger.ts"

// The legacy loader calls every exported function. Keep only the plugin here.
export const SteeringPlugin: Plugin = async (input, options = {}) => {
  const ledger = new SteeringLedger(input, options)
  return {
    tool: {
      steering_status: {
        description: "Read message-level steering evidence for this session. Saved and prepared do not prove provider receipt or semantic adoption.",
        args: { messageID: z.string().optional() },
        async execute(args, context) {
          return JSON.stringify(await ledger.status(context.sessionID, typeof args.messageID === "string" ? args.messageID : undefined), null, 2)
        },
      },
    },
    "chat.message": (input, output) => ledger.observe(input.sessionID, output),
    "experimental.chat.messages.transform": (_, output) => ledger.prepare(output),
    "experimental.session.compacting": input => ledger.compacting(input.sessionID),
    "tool.execute.before": input => ledger.gate(input),
    // Event hooks are not awaited by the kernel; the ledger catches rejections.
    event: ({ event }) => ledger.event(event),
  }
}
