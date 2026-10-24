// Feasibility probe only. This is not the distributable steering implementation.
import { tool, type Plugin } from '@opencode-ai/plugin'
import { appendFileSync } from 'node:fs'

export const ProbePlugin: Plugin = async ({ client }, options = {}) => {
  const snapshots = new Map<string, Set<string>>()
  const log = (event: object) => appendFileSync(String(options.log), JSON.stringify(event) + '\n')
  return {
    tool: {
      probe_step: tool({
        description: 'Record a test action without touching user files.',
        args: { action: tool.schema.string() },
        async execute(args, context) {
          log({ kind: 'execute', session: context.sessionID, action: args.action })
          return `executed ${args.action}`
        },
      }),
    },
    async 'experimental.chat.messages.transform'(_, output) {
      const session = output.messages[0]?.info.sessionID
      if (!session) return
      const users = output.messages.filter(m => m.info.role === 'user').map(m => m.info.id)
      snapshots.set(session, new Set(users))
      log({ kind: 'snapshot', session, users })
    },
    async 'tool.execute.before'(input) {
      if (input.tool !== 'probe_step' || !options.gate) return
      const response = await client.session.messages({ path: { id: input.sessionID } })
      if (response.error || !response.data) throw new Error('Probe unable to inspect messages')
      const pending = response.data.filter(m => m.info.role === 'user' && !snapshots.get(input.sessionID)?.has(m.info.id))
      if (!pending.length) return
      log({ kind: 'blocked', session: input.sessionID, call: input.callID, users: pending.map(m => m.info.id) })
      throw new Error('New user guidance arrived after the model context was captured. Read it before taking further actions.')
    },
  }
}
