import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import "./merge-agent-kernel.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const command = process.platform === "win32" ? "bun.cmd" : "bun"
const mode = process.argv[2]
if (mode !== "serve" && mode !== "build") throw new Error("Expected serve or build")
const result = spawnSync(command, mode === "serve" ? ["src/index.ts", "serve"] : ["run", "build"], {
  cwd: path.join(root, "agent-kernel", "packages", "opencode"),
  env: { ...process.env, OPENCODE_CONFIG_DIR: path.join(root, ".opencode") },
  stdio: "inherit",
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
