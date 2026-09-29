import { tool } from "@opencode-ai/plugin"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import type { GlobalExtension } from "../../custom-hw/extension/global-extension"
import { scanReleases, type State } from "./release-monitor"

export const CapabilityWatchExtension: GlobalExtension = async () => ({
  tool: {
    capability_watch: tool({
      description: "Check new stable Claude Code and Codex releases since the previous successful scan, with source links.",
      args: {},
      async execute(_args, context) {
        const directory = path.join(context.directory, ".codeagent")
        const file = path.join(directory, "capability-watch.json")
        const state: State = await readFile(file, "utf8").then(JSON.parse).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return {}
          throw error
        })
        const result = await scanReleases(state, fetch, process.env.GITHUB_TOKEN)
        if (result.results.some((item) => "error" in item)) {
          return JSON.stringify({ ...result, warning: "At least one source failed; no cursor was advanced." })
        }
        await mkdir(directory, { recursive: true })
        const temporary = `${file}.${process.pid}.tmp`
        await writeFile(temporary, JSON.stringify(result.state, null, 2) + "\n", { mode: 0o600 })
        await rename(temporary, file)
        return JSON.stringify(result)
      },
    }),
  },
})
