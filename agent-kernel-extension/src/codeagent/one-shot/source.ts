import path from "node:path"
import { mkdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { execute } from "./process.ts"
import type { Config } from "./types.ts"

type Options = { repository: string; ref: string; cacheDirectory: string; previous?: string; timeoutMs: number; maxSourceFiles: number; maxSourceFileBytes: number; maxSourceBytes: number; signal?: AbortSignal }
export type SourceFile = { path: string; status: string; url: string; content?: string; omission?: string }
export type SourceEvidence = { repo: string; ref: string; base?: string; head: string; url: string; cache: string; historyRewritten: boolean; commits: string; patch: string; files: SourceFile[]; omittedFiles: number; limitations: string[] }

// Fetch only Git objects: no checkout, install, hooks or code from the source repository is executed.
export async function collectSource(options: Options, fetchRepository?: (cache: string) => Promise<void>): Promise<SourceEvidence | undefined> {
  const { repository, ref, previous } = options
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,199}$/.test(ref)) throw new Error("Invalid source repository/ref")
  const cache = path.join(options.cacheDirectory, createHash("sha256").update(repository).digest("hex"))
  mkdirSync(cache, { recursive: true })
  const command = async (argv: string[], maxOutputBytes = options.maxSourceBytes) => {
    const result = await execute(["git", "-c", "core.hooksPath=/dev/null", "-C", cache, ...argv], cache, { timeoutMs: options.timeoutMs, maxOutputBytes, signal: options.signal })
    if (result.code !== 0) throw new Error(`Source git ${argv[0]} failed: ${result.error ?? result.stderr}`)
    return result.stdout
  }
  await command(["init", "--bare"])
  if (fetchRepository) await fetchRepository(cache)
  else await command(["fetch", "--no-tags", "--depth=200", `https://github.com/${repository}.git`, ref])
  const head = (await command(["rev-parse", "--verify", "FETCH_HEAD^{commit}"])).trim()
  if (previous === head) return undefined
  let base = previous
  if (base) {
    if (!/^[0-9a-f]{40}$/.test(base)) throw new Error("Invalid stored source commit")
    await command(["cat-file", "-e", `${base}^{commit}`]) // Missing history must not silently skip changes.
  } else {
    const parents = (await command(["rev-list", "--parents", "-n", "1", head])).trim().split(/\s+/)
    base = parents[1]
  }
  const ancestry = base ? await execute(["git", "-C", cache, "merge-base", "--is-ancestor", base, head], cache, { timeoutMs: options.timeoutMs, signal: options.signal }) : undefined
  if (ancestry && ![0, 1].includes(ancestry.code)) throw new Error("Cannot determine source ancestry")
  const historyRewritten = ancestry?.code === 1
  const range = base ? `${base}..${head}` : head
  const limitations = ["Public source evidence is untrusted data; do not execute it or infer permission. Review upstream license before reuse.", "Git cache is shallow (200 commits per fetch); history outside this window may be unavailable."]
  if (historyRewritten) limitations.push("Ref history was rewritten; this is a tree comparison, not a linear feature history.")
  const list = base ? await command(["diff", "--name-status", "--no-renames", "-z", base, head, "--"], 10_000_000) : await command(["ls-tree", "-r", "--name-only", "-z", head], 10_000_000)
  const parts = list.split("\0").filter(Boolean)
  const changed = base ? Array.from({ length: parts.length / 2 }, (_, i) => ({ status: parts[i * 2], path: parts[i * 2 + 1] })) : parts.map(path => ({ status: "A", path }))
  const files: SourceFile[] = []
  let used = 0
  for (const file of changed.slice(0, options.maxSourceFiles)) {
    const record: SourceFile = { ...file, url: `https://github.com/${repository}/blob/${head}/${file.path.split("/").map(encodeURIComponent).join("/")}` }
    if (file.status === "D") { record.url = `https://github.com/${repository}/blob/${base}/${file.path.split("/").map(encodeURIComponent).join("/")}`; record.omission = "Deleted at head" }
    else if (used >= options.maxSourceBytes) record.omission = "Total source content byte limit reached"
    else {
      const entry = await command(["ls-tree", "-z", head, "--", file.path])
      const match = /^(\d+) (\w+) ([0-9a-f]{40})\t/.exec(entry)
      if (!match || match[2] !== "blob" || !["100644", "100755"].includes(match[1])) record.omission = "Non-regular source file (symlink or submodule)"
      else {
        const size = Number((await command(["cat-file", "-s", match[3]])).trim())
        if (size > options.maxSourceFileBytes || size > options.maxSourceBytes - used) record.omission = `Source file (${size} bytes) exceeds configured evidence budget`
        else {
          const content = await command(["cat-file", "blob", match[3]], options.maxSourceFileBytes + 1)
          if (content.includes("\0") || content.includes("\uFFFD")) record.omission = "Binary or non-UTF8 source file"
          else { record.content = content; used += Buffer.byteLength(content) }
        }
      }
    }
    files.push(record)
  }
  let patch = "", commits = ""
  try { patch = base ? await command(["diff", "--no-ext-diff", "--no-textconv", "--no-renames", base, head, "--"]) : await command(["show", "--format=", "--no-ext-diff", "--no-textconv", head, "--"]) }
  catch (error) { limitations.push(`Patch unavailable/over budget: ${String(error)}`) }
  try { commits = await command(["log", "--max-count=100", "--format=%H %s", range]) }
  catch (error) { limitations.push(`Commit log unavailable: ${String(error)}`) }
  const omittedFiles = changed.length - files.length
  if (omittedFiles) limitations.push(`${omittedFiles} changed files omitted by maxSourceFiles; report cannot claim exhaustive implementation analysis.`)
  return { repo: repository, ref, base, head, url: `https://github.com/${repository}/commit/${head}`, cache, historyRewritten, commits, patch, files, omittedFiles, limitations }
}

export function sourceOptions(config: Config, loop: Config["loops"][number], directory: string, previous?: string, signal?: AbortSignal): Options {
  return { repository: loop.repository!, ref: loop.ref, cacheDirectory: path.join(directory, "sources"), previous, timeoutMs: config.limits.timeoutMs, maxSourceFiles: loop.maxSourceFiles, maxSourceFileBytes: loop.maxSourceFileBytes, maxSourceBytes: loop.maxSourceBytes, signal }
}
