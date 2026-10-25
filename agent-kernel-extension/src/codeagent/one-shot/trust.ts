import path from "node:path"
import { lstatSync, readFileSync, realpathSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { checked } from "./process.ts"
import type { Config, Run, TrustSnapshot, TrustedFile } from "./types.ts"

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")
export const matchesPath = (file: string, pattern: string) => { const base = pattern.replace(/\/+$/, ""); return file === base || file.startsWith(`${base}/`) }
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
  const commands = [...config.checks.map(c => ({ ...c, label: `check:${c.id}` })), ...config.setup.map(c => ({ ...c, label: `setup:${c.id}` })), ...Object.entries(config.agents).filter(([,a]) => a.kind === "command").map(([id,a]) => ({ ...a, label: `agent:${id}` }))]
  for (const command of commands) for (const raw of command.argv ?? []) {
    const arg = raw.startsWith("--") && raw.includes("=") ? raw.slice(raw.indexOf("=") + 1) : raw
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
  const coverage = commands.map(command => {
    const argv = command.argv ?? [], executable = path.basename(argv[0] ?? "").toLowerCase().replace(/\.exe$/, "")
    const inlineFlags = /^(node|bun)$/.test(executable) ? ["-e", "--eval", "-p", "--print"] : /^python[0-9.]*$/.test(executable) ? ["-c"] : /^(bash|sh|zsh|pwsh|powershell)$/.test(executable) ? ["-c", "-Command"] : []
    const inline = argv.findIndex((a, i) => i > 0 && inlineFlags.includes(a))
    const candidates = argv.slice(0, inline < 0 ? undefined : inline).map(a => a.startsWith("--") && a.includes("=") ? a.slice(a.indexOf("=") + 1) : a).filter((a, i) => i === 0 || (!a.startsWith("-") && !a.includes("\n") && (/[/\\]/.test(a) || /\.(?:jsonc?|ya?ml|toml)$/i.test(a))))
    const unpinned = [...new Set(candidates.filter(arg => !files.some(file => path.isAbsolute(arg) ? file.kind === "external" && file.path === path.resolve(arg) : file.kind === "repository" && file.path === arg.replace(/^\.\//, ""))))]
    if (unpinned.some(arg => !command.allowUnpinned.includes(arg))) throw new Error(`${command.label} has unpinned toolchain/path arguments: ${unpinned.join(", ")}; explicitly list each exact path in allowUnpinned or pin its file`)
    return { command: command.label, unpinned, allowUnpinned: command.allowUnpinned }
  })
  return { version: 2, files, coverage }
}
export function verifyTrust(cwd: string, run: Run) {
  if (run.trust?.version !== 2 || !run.trust.coverage?.every(c => Array.isArray(c.allowUnpinned))) throw new Error("Run lacks trusted file snapshot/coverage; legacy run requires explicit migration, not resume/accept")
  for (const file of run.trust.files) {
    const target = file.kind === "external" ? file.path : path.join(cwd, file.path)
    try {
      const actual = inspect(target, file.kind, file.kind === "repository" ? cwd : undefined)
      if (actual.sha256 !== file.sha256 || actual.mode !== file.mode || actual.realPath !== file.realPath) throw new Error("content, mode or target mismatch")
    } catch (e) { throw new Error(`Trusted file changed: ${file.path}: ${e instanceof Error ? e.message : String(e)}`) }
  }
}
