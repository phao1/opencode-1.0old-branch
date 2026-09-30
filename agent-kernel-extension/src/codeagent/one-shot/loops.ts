import path from "node:path"
import { readFileSync, statSync } from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"
import { Store, lock } from "./store.ts"
import { execute } from "./process.ts"
import { executeAgent, type AgentExecutor } from "./agents.ts"
import { analysisSchema, issueInputSchema, type Config, type LoopState } from "./types.ts"
import { createIssue, enqueue } from "./runner.ts"

const sourceRepos = { claudeCode: "anthropics/claude-code", codex: "openai/codex" }
const signalsSchema = z.object({ signals: z.array(issueInputSchema).max(100) })
const digest = (s: string) => createHash("sha256").update(s).digest("hex")
export function scheduleSlot(loop: Config["loops"][number], state: LoopState, now = Date.now()) {
  if (state.error && now < (state.nextAt ?? 0)) return undefined
  if (!loop.daily) return now >= (state.nextAt ?? 0) ? String(Math.floor(now / (loop.intervalSeconds * 1000))) : undefined
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: loop.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map(p => [p.type, p.value]))
  const day = `${parts.year}-${parts.month}-${parts.day}`
  return `${parts.hour}:${parts.minute}` >= loop.daily && state.lastSlot !== day ? day : undefined
}
async function github(route: string, fetcher: typeof fetch, signal?: AbortSignal) {
  const response = await fetcher(`https://api.github.com${route}`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "codeagent-one-shot", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`GitHub ${route}: HTTP ${response.status}`)
  const raw = await response.text()
  if (Buffer.byteLength(raw) > 10_000_000) throw new Error("Source response exceeds 10MB")
  return JSON.parse(raw)
}
async function report(store: Store, source: string, value: unknown) {
  const id = `report-${randomUUID()}`
  store.artifact(id, "REPORT.json", JSON.stringify(value, null, 2))
  await store.transact(db => { db.reports.push({ id, source, at: new Date().toISOString(), report: { artifact: path.join(store.directory, "artifacts", id, "REPORT.json") } }) })
}
export async function tick(root: string, store: Store, config: Config, options: { now?: number; fetcher?: typeof fetch; executor?: AgentExecutor; force?: boolean; signal?: AbortSignal } = {}) {
  const release = await lock(path.join(store.directory, "loops.lock"), 0)
  const now = options.now ?? Date.now(), fetcher = options.fetcher ?? fetch, executor = options.executor ?? executeAgent
  const results: Array<{ id: string; ok: boolean; error?: string }> = []
  try {
    for (const loop of config.loops.filter(x => x.enabled)) {
      if (options.signal?.aborted) break
      const state = store.read().loops[loop.id] ?? {}
      const slot = scheduleSlot(loop, state, now)
      if (!slot && !options.force) continue
      const next: LoopState = structuredClone(state)
      try {
        if (loop.kind === "file" || loop.kind === "command") {
          let raw: string
          if (loop.kind === "file") {
            const file = path.resolve(root, loop.file!)
            if (statSync(file).size > config.limits.maxOutputBytes) throw new Error("Signal input too large")
            raw = readFileSync(file, "utf8")
          }
          else {
            const result = await execute(loop.argv!, root, { timeoutMs: config.limits.timeoutMs, maxOutputBytes: config.limits.maxOutputBytes, signal: options.signal })
            await report(store, loop.id, { command: loop.argv, ...result })
            if (result.code !== 0) throw new Error(result.error ?? `Source command failed: ${result.stderr}`)
            raw = result.stdout
          }
          if (Buffer.byteLength(raw) > config.limits.maxOutputBytes) throw new Error("Signal input too large")
          for (const item of signalsSchema.parse(JSON.parse(raw)).signals) await createIssue(store, { ...item, source: `loop:${loop.id}:${item.source}` })
        } else if (loop.kind === "github") {
          if (!loop.repository || !loop.trustedActors.length) throw new Error("GitHub loop requires repository and trustedActors")
          let complete = false
          for (let page = 1; page <= loop.maxPages; page++) {
            const issues = await github(`/repos/${loop.repository}/issues?state=open&labels=${encodeURIComponent(loop.label)}&per_page=100&page=${page}`, fetcher, options.signal)
            if (!Array.isArray(issues)) throw new Error("Invalid GitHub issues response")
            for (const item of issues.filter((x: any) => !x.pull_request)) {
              const events: any[] = []; let eventComplete = false
              for (let ep = 1; ep <= loop.maxPages; ep++) {
                const batch = await github(`/repos/${loop.repository}/issues/${item.number}/events?per_page=100&page=${ep}`, fetcher, options.signal)
                if (!Array.isArray(batch)) throw new Error("Invalid issue event response")
                events.push(...batch)
                if (batch.length < 100) { eventComplete = true; break }
              }
              if (!eventComplete) throw new Error(`Issue ${item.number}: label provenance pagination gap`)
              const event = events.filter(e => ["labeled", "unlabeled"].includes(e.event) && e.label?.name === loop.label).at(-1)
              if (event?.event !== "labeled" || !loop.trustedActors.includes(event.actor?.login)) continue
              const issue = await createIssue(store, { title: item.title, body: item.body || item.title, source: item.html_url, sourceId: `${loop.repository}#${item.number}`, evidence: [item.html_url, `todo-label-event:${event.id}; actor:${event.actor.login}`] })
              await enqueue(root, store, config, issue.id)
            }
            if (issues.length < 100) { complete = true; break }
          }
          if (!complete) throw new Error("GitHub issue pagination bound reached; increase maxPages")
        } else {
          next.cursor ??= {}
          for (const [name, repo] of Object.entries(sourceRepos)) {
            const previous = state.cursor?.[name]
            const releases: any[] = []; let found = false
            for (let page = 1; page <= loop.maxPages; page++) {
              const batch = await github(`/repos/${repo}/releases?per_page=100&page=${page}`, fetcher, options.signal)
              if (!Array.isArray(batch)) throw new Error("Invalid releases response")
              releases.push(...batch.filter((r: any) => !r.draft && !r.prerelease && typeof r.tag_name === "string"))
              if (!previous || releases.some(r => r.tag_name === previous)) { found = true; break }
              if (batch.length < 100) break
            }
            if (previous && !found) throw new Error(`${name}: cursor gap at ${previous}; cursor preserved`)
            if (!releases.length) continue
            const end = previous ? releases.findIndex(r => r.tag_name === previous) : 1
            let processed = previous
            for (let index = end - 1; index >= Math.max(0, end - loop.maxAnalyses); index--) {
              const release = releases[index], prior = releases[index + 1]?.tag_name
              let comparison: unknown = { unavailable: "No previous version found" }
              if (prior) {
                try { comparison = await github(`/repos/${repo}/compare/${encodeURIComponent(prior)}...${encodeURIComponent(release.tag_name)}`, fetcher, options.signal) }
                catch (e) { comparison = { unavailable: String(e) } }
              }
              const source = { repo, version: release.tag_name, prior, url: release.html_url, changelog: release.body ?? "", retrievedAt: new Date(now).toISOString(), comparison, limitation: "GitHub compare may omit/truncate files or patches; a public repository may not contain a product's distributed implementation. No performance measurement is implied." }
              const controller = new AbortController()
              const timer = setTimeout(() => controller.abort(), config.limits.timeoutMs)
              try {
                const value = await executor({ config, agentId: config.roles.analyst ?? config.roles.planner, role: "analyze", cwd: root, payload: { source, contentHash: digest(JSON.stringify(source)), project: "Develop external plugins for the pinned OpenCode baseline. Produce candidates only when relevant." }, signal: options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal, onIdentity: async () => {} })
                const analysis = analysisSchema.parse(value.result)
                await report(store, `${repo}@${release.tag_name}`, { source, analysis })
                for (const candidate of analysis.candidates) await createIssue(store, { ...candidate, source: release.html_url, sourceId: candidate.sourceId ?? digest(candidate.title), evidence: [...candidate.evidence, release.html_url] })
                processed = release.tag_name
              } finally { clearTimeout(timer) }
            }
            next.cursor[name] = processed ?? releases[0].tag_name
          }
        }
        next.lastSlot = slot ?? String(now); next.nextAt = now + loop.intervalSeconds * 1000; next.lastRunAt = new Date(now).toISOString(); delete next.error
        await store.transact(db => { db.loops[loop.id] = next })
        results.push({ id: loop.id, ok: true })
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        // Preserve source cursor; bounded retry backoff avoids an outage hot loop.
        await store.transact(db => { db.loops[loop.id] = { ...state, error, nextAt: now + Math.min(loop.intervalSeconds, 60) * 1000 } })
        results.push({ id: loop.id, ok: false, error })
      }
    }
    return results
  } finally { release() }
}
