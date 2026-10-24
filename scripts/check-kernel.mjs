import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"

const expected = "517e6c9aa4c61dbc125e7654fc596f1d529f20d9"
if (!existsSync("agent-kernel/.git")) {
  console.error("Initialize the kernel with: git submodule update --init")
  process.exit(1)
}
const actual = execFileSync("git", ["-C", "agent-kernel", "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
if (actual !== expected) {
  console.error(`Wrong kernel commit: ${actual}; expected ${expected}`)
  process.exit(1)
}
try {
  execFileSync("git", ["-C", "agent-kernel", "diff", "--quiet", "HEAD", "--"], { stdio: "pipe" })
} catch {
  console.error("Tracked kernel files differ from the pinned commit")
  process.exit(1)
}
console.log(`OpenCode kernel pinned and tracked files clean: ${actual}`)
