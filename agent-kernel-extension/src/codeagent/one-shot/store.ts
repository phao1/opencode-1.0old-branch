import { mkdirSync, readFileSync, writeFileSync, renameSync, statSync, rmSync, openSync, closeSync, fsyncSync } from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { configSchema, type Config, type Database, type Run } from "./types.ts"

export function alive(pid: number) {
  try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code !== "ESRCH" }
}
export async function lock(dir: string, waitMs = 10_000): Promise<() => void> {
  mkdirSync(path.dirname(dir), { recursive: true, mode: 0o700 })
  const started = Date.now(), token = randomUUID()
  while (true) {
    try {
      mkdirSync(dir, { mode: 0o700 })
      writeFileSync(path.join(dir, "owner.json"), JSON.stringify({ pid: process.pid, token }), { mode: 0o600 })
      return () => {
        const owner = JSON.parse(readFileSync(path.join(dir, "owner.json"), "utf8"))
        if (owner.token !== token) throw new Error("Lock ownership lost")
        rmSync(dir, { recursive: true })
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e
      // Serialize stale-lock removal. Re-read ownership under this guard so
      // a second reaper cannot delete a newly acquired live lock.
      let reaping = false
      try {
        mkdirSync(`${dir}.reap`, { mode: 0o700 }); reaping = true
        let stale = false
        try {
          const owner = JSON.parse(readFileSync(path.join(dir, "owner.json"), "utf8"))
          stale = Number.isInteger(owner.pid) && owner.pid > 0 && !alive(owner.pid)
        } catch {
          try { stale = Date.now() - statSync(dir).mtimeMs > 30_000 } catch {}
        }
        if (stale) { rmSync(dir, { recursive: true, force: true }); continue }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e
      } finally { if (reaping) rmSync(`${dir}.reap`, { recursive: true, force: true }) }
      if (Date.now() - started >= waitMs) throw new Error(`Busy lock: ${dir}`)
      await delay(30)
    }
  }
}
export function atomicJSON(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
  const fd = openSync(temp, "wx", 0o600)
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(temp, file)
}
export class Store {
  readonly directory: string
  constructor(directory: string) { this.directory = path.resolve(directory) }
  read(): Database {
    try {
      const data = JSON.parse(readFileSync(path.join(this.directory, "state.json"), "utf8"))
      if (data.version !== 1) throw new Error("Unsupported one-shot database version")
      return data
    } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, issues: {}, runs: {}, loops: {}, reports: [] }; throw e }
  }
  async transact<T>(fn: (db: Database) => T): Promise<T> {
    const release = await lock(path.join(this.directory, "state.lock"))
    try { const db = this.read(); const result = fn(db); atomicJSON(path.join(this.directory, "state.json"), db); return result } finally { release() }
  }
  async update(id: string, fn: (run: Run, db: Database) => void) {
    return this.transact(db => { const run = db.runs[id]; if (!run) throw new Error(`Unknown run ${id}`); fn(run, db); run.updatedAt = new Date().toISOString(); return run })
  }
  run(id: string) { const run = this.read().runs[id]; if (!run) throw new Error(`Unknown run ${id}`); return run }
  artifact(id: string, name: string, content: string) {
    if (!/^[\w.-]+$/.test(id) || !/^[\w.-]+$/.test(name)) throw new Error("Invalid artifact name")
    const dir = path.join(this.directory, "artifacts", id); mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(path.join(dir, name), content, { mode: 0o600 })
    return path.join(dir, name)
  }
}
export function loadConfig(root: string, file = "one-shot.config.json"): Config {
  return configSchema.parse(JSON.parse(readFileSync(path.resolve(root, file), "utf8")))
}
export function openStore(root: string, config: Config) { return new Store(path.resolve(root, config.stateDir)) }
export function event(run: Run, name: string, detail?: string) { run.history.push({ at: new Date().toISOString(), event: name, detail }) }
