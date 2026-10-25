import path from "node:path"
import { lstatSync, readFileSync, realpathSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { checked } from "./process.ts"
import type { Config, Run, TrustSnapshot, TrustedFile } from "./types.ts"

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")
export const matchesPath = (file: string, pattern: string) => pattern.endsWith("/") ? file.startsWith(pattern) : file === pattern
const script = (arg: string) => !arg.startsWith("-") && !arg.includes("\n") && /\.(?:[cm]?[jt]s|tsx|jsx|py|sh|ps1|cmd|bat)$/i.test(arg)
function relativeFile(file: string) {
  if (path.isAbsolute(file) || file.includes("\\") || file.split("/").includes("..")) throw new Error(`Invalid repository trusted path: ${file}`)
  return file.replace(/^\.\//, "")
}
function inspect(file: string, kind: TrustedFile["kind"], relativeRoot?: string) {
  if (relativeRoot) {
    const parts = path.relative(relativeRoot, file).split(path.sep)
    for (let i = 1; i <= parts.length; i++) if (lstatSync(path.join(relativeRoot, ...parts.slice(0, i))).isSymbolicLink()) throw new Error(`Trusted symlink forbidden: ${file}`)
  }
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Trusted file must be a regular file: ${file}`)
  return { sha256: digest(readFileSync(file)), mode: stat.mode & 0o111, ...(kind === "external" ? { realPath: realpathSync(file) } : {}) }
}

// Capture repository bytes from baseCommit, never from the Builder checkout.
// Absolute operator-supplied files require an explicit content pin.
export async function captureTrust(root: string, base: string, config: Config): Promise<TrustSnapshot> {
  const tree = await checked(["git", "ls-tree", "-r", "-z", base], root)
  const entries = new Map(tree.split("\0").filter(Boolean).map(row => {
    const tab = row.indexOf("\t"), [mode, type, oid] = row.slice(0, tab).split(" ")
    return [row.slice(tab + 1), { mode, type, oid }] as const
  }))
  const selected = new Set([...entries.keys()].filter(file => config.protectedPaths.some(p => matchesPath(file, p))))
  const pins = new Map<string, string>()
  for (const pin of config.trustedFiles) {
    const file = path.isAbsolute(pin.path) ? path.resolve(pin.path) : relativeFile(pin.path)
    if (pins.has(file) && pins.get(file) !== pin.sha256) throw new Error(`Conflicting trusted file pins: ${file}`)
    pins.set(file, pin.sha256)
    if (!path.isAbsolute(file)) selected.add(file)
  }
  const commands = [...config.checks, ...config.setup, ...Object.values(config.agents).filter(a => a.kind === "command")]
  for (const command of commands) for (const arg of command.argv ?? []) {
    if (!script(arg)) continue
    if (path.isAbsolute(arg)) {
      if (!pins.has(path.resolve(arg))) throw new Error(`Pin external script with trustedFiles sha256 before enqueue: ${arg}`)
    } else selected.add(relativeFile(arg))
  }
  const files: TrustedFile[] = []
  for (const file of [...selected].sort()) {
    const entry = entries.get(file)
    if (!entry || entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) throw new Error(`Trusted file must exist as a regular file in baseCommit: ${file}`)
    const bytes = execFileSync("git", ["cat-file", "blob", entry.oid], { cwd: root, maxBuffer: 32_000_000 })
    const sha256 = digest(bytes)
    if (pins.has(file) && pins.get(file) !== sha256) throw new Error(`Trusted file pin differs from baseCommit: ${file}`)
    files.push({ path: file, sha256, mode: entry.mode === "100755" ? 0o111 : 0, kind: "repository" })
  }
  for (const [file, sha256] of pins) if (path.isAbsolute(file)) {
    const actual = inspect(file, "external")
    if (actual.sha256 !== sha256) throw new Error(`Trusted external file changed: ${file}`)
    files.push({ path: file, sha256, mode: actual.mode, realPath: actual.realPath, kind: "external" })
  }
  return { version: 1, files }
}
export function verifyTrust(cwd: string, run: Run) {
  if (run.trust?.version !== 1) throw new Error("Run lacks trusted file snapshot; legacy run requires explicit migration, not resume/accept")
  for (const file of run.trust.files) {
    const target = file.kind === "external" ? file.path : path.join(cwd, file.path)
    try {
      const actual = inspect(target, file.kind, file.kind === "repository" ? cwd : undefined)
      if (actual.sha256 !== file.sha256 || actual.mode !== file.mode || actual.realPath !== file.realPath) throw new Error("content, mode or target mismatch")
    } catch (e) { throw new Error(`Trusted file changed: ${file.path}: ${e instanceof Error ? e.message : String(e)}`) }
  }
}
