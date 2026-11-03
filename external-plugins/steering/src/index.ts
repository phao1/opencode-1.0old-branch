import type { Plugin } from "@opencode-ai/plugin"
import { z } from "zod"
import { SteeringState } from "./state.ts"

// The legacy loader calls every function export. Keep exactly one.
export const SteeringPlugin: Plugin = async (input, options = {}) => {
  const state = new SteeringState(input, options)
  return {
    tool: { steering_status: {
      description: "Read process-local request and pending guidance observations. Provider receipt and adoption remain unknown.",
      args: { messageID: z.string().optional() },
      async execute(_, context) { return JSON.stringify(state.status(context.sessionID), null, 2) },
    } },
    "chat.message": (input, output) => state.observe(input.sessionID, output),
    "experimental.chat.messages.transform": (_, output) => state.prepare(output),
    "experimental.session.compacting": async input => state.compact(input.sessionID),
    "tool.execute.before": input => state.gate(input),
    event: ({ event }) => state.event(event),
  }
}
