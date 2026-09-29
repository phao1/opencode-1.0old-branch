import type { Hooks, PluginInput } from "@opencode-ai/plugin"

export type GlobalExtensionInput = PluginInput

export type GlobalExtension = (input: GlobalExtensionInput) => Promise<Pick<Hooks, "event" | "tool">>

export async function composeGlobalExtensions(extensions: GlobalExtension[], input: GlobalExtensionInput) {
  const hooks: Awaited<ReturnType<GlobalExtension>>[] = []
  for (const extension of extensions) hooks.push(await extension(input))
  const tools: NonNullable<Hooks["tool"]> = {}

  for (const hook of hooks) {
    for (const [name, definition] of Object.entries(hook.tool ?? {})) {
      if (name in tools) throw new Error(`Duplicate global extension tool: ${name}`)
      tools[name] = definition
    }
  }

  return {
    tool: tools,
    event: async (event: Parameters<NonNullable<Hooks["event"]>>[0]) => {
      for (const hook of hooks) await hook.event?.(event)
    },
  } satisfies Pick<Hooks, "event" | "tool">
}
