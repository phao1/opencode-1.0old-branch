import { spawn } from "node:child_process"

export type ProcessResult = { code: number; stdout: string; stderr: string; durationMs: number; error?: string }
export async function execute(argv: string[], cwd: string, options: { input?: string; timeoutMs?: number; maxOutputBytes?: number; signal?: AbortSignal; onStart?: (pid: number) => Promise<void> } = {}): Promise<ProcessResult> {
  options.signal?.throwIfAborted()
  if (!argv.length) throw new Error("Empty command")
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, shell: false, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] })
    let stdout = "", stderr = "", size = 0, error: string | undefined, settled = false
    const kill = (reason: string) => {
      error ??= reason
      if (!child.pid) return
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }).unref()
      else { try { process.kill(-child.pid, "SIGKILL") } catch {} }
    }
    const abort = () => kill("Cancelled")
    const timer = setTimeout(() => kill("Command timed out"), options.timeoutMs ?? 300_000)
    const clean = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort) }
    options.signal?.addEventListener("abort", abort, { once: true })
    const output = (data: Buffer, stream: "stdout" | "stderr") => {
      size += data.length
      if (size > (options.maxOutputBytes ?? 2_000_000)) { kill("Output limit exceeded"); return }
      if (stream === "stdout") stdout += data.toString(); else stderr += data.toString()
    }
    child.stdout.on("data", data => output(data, "stdout")); child.stderr.on("data", data => output(data, "stderr"))
    child.stdin.on("error", () => {})
    child.on("error", e => { if (!settled) { settled = true; clean(); reject(e) } })
    child.on("close", code => {
      if (settled) return; settled = true; clean()
      resolve({ code: error ? -1 : (code ?? -1), stdout, stderr, durationMs: Date.now() - started, ...(error ? { error } : {}) })
    })
    child.on("spawn", async () => {
      try { await options.onStart?.(child.pid!); child.stdin.end(options.input ?? "") } catch (e) { kill(String(e)) }
      if (options.signal?.aborted) abort()
    })
  })
}
export async function checked(argv: string[], cwd: string, options: Parameters<typeof execute>[2] = {}) {
  const result = await execute(argv, cwd, options)
  if (result.code !== 0) throw new Error(`${argv[0]} failed (${result.code}): ${result.error ?? result.stderr.slice(-3000)}`)
  return result.stdout.trim()
}
