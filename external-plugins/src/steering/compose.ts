import type { Hooks } from "@opencode-ai/plugin"

export function composeSteeringHooks(...hooks: Hooks[]): Hooks {
  const merged: Record<string, unknown> = {}
  const tools: NonNullable<Hooks["tool"]> = {}
  for (const hook of hooks) {
    for (const [name, definition] of Object.entries(hook.tool ?? {})) {
      if (name in tools) throw new Error(`Duplicate plugin tool: ${name}`)
      tools[name] = definition
    }
    for (const [key, value] of Object.entries(hook)) {
      if (key === "tool" || value === undefined) continue
      const previous = merged[key]
      if (previous === undefined) merged[key] = value
      else if (typeof previous === "function" && typeof value === "function") {
        merged[key] = async (...args: unknown[]) => {
          if (key === "event") {
            const results = await Promise.allSettled([previous(...args), value(...args)])
            const failed = results.find(result => result.status === "rejected")
            if (failed?.status === "rejected") throw failed.reason
          } else {
            await previous(...args)
            await value(...args)
          }
        }
      } else throw new Error(`Duplicate non-composable plugin hook: ${key}`)
    }
  }
  return { ...merged, tool: tools } as Hooks
}
