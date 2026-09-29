import { execFileSync } from "node:child_process"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const kernel = path.join(root, "agent-kernel")
const expected = "517e6c9aa4c61dbc125e7654fc596f1d529f20d9"
const marker = "// CodeAgentPlugin merge-generated; edit agent-kernel-extension/src instead.\n"

const actual = execFileSync("git", ["-C", kernel, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
if (actual !== expected) throw new Error(`Kernel drift: ${actual}; expected ${expected}`)

const source = path.join(root, "agent-kernel-extension", "src")
const target = path.join(kernel, "packages", "opencode", "src")

async function merge(directory) {
  for (const entry of await readdir(path.join(source, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await merge(relative)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue
    const dest = path.join(target, relative)
    const existing = await readFile(dest, "utf8").catch((error) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (existing !== undefined && !existing.startsWith(marker)) {
      throw new Error(`Refusing to overwrite native kernel file: ${relative}`)
    }
    await mkdir(path.dirname(dest), { recursive: true })
    await writeFile(dest, marker + (await readFile(path.join(source, relative), "utf8")))
    console.log(`merged ${relative}`)
  }
}

for (const directory of ["custom-hw", "codeagent"]) await merge(directory)
