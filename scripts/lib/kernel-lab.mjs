import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// Real pinned kernel, public HTTP API, isolated config/database/cache. Fixtures
// remain under .codeagent so failures can be inspected without host settings.
export async function startKernel({ plugin, config = {}, directory = root, reuseFixture } = {}) {
  await mkdir(path.join(root, '.codeagent'), { recursive: true })
  const fixture = reuseFixture ? path.resolve(reuseFixture) : await mkdtemp(path.join(root, '.codeagent/kernel-lab-'))
  const configDir = path.join(fixture, 'config/opencode')
  if (reuseFixture) {
    // Restart means reuse the exact installed config, database and state.
    // Reject a missing fixture rather than silently create a fresh instance.
    await readFile(path.join(configDir, 'opencode.json'), 'utf8')
  } else {
  await mkdir(configDir, { recursive: true })
  await writeFile(path.join(configDir, 'package.json'), JSON.stringify({ private: true, dependencies: { '@opencode-ai/plugin': '1.3.17' } }))
  // An actual installation produces the lockfile; no fabricated dependency
  // metadata or patches to Config.waitForDependencies are used.
  await run('npm', ['install', '--prefix', configDir, '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', '--fetch-timeout=15000', '--fetch-retries=0', '--registry=https://registry.npmjs.org'], { timeout: 60_000 })
  await writeFile(path.join(configDir, 'opencode.json'), JSON.stringify({
    plugin: [plugin ?? path.join(root, 'external-plugins/src/index.ts')], ...config,
  }))
  }
  const logFile = path.join(fixture, `kernel-${randomUUID()}.log`)
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith('OPENCODE_')) delete env[key]
  Object.assign(env, {
    XDG_CONFIG_HOME: path.join(fixture, 'config'), XDG_DATA_HOME: path.join(fixture, 'data'),
    XDG_CACHE_HOME: path.join(fixture, 'cache'), XDG_STATE_HOME: path.join(fixture, 'state'),
    OPENCODE_TEST_HOME: path.join(fixture, 'home'), OPENCODE_CONFIG_DIR: configDir,
    OPENCODE_DISABLE_PROJECT_CONFIG: 'true', OPENCODE_DISABLE_MODELS_FETCH: 'true',
  })
  const server = spawn(process.env.BUN_BINARY ?? 'bun', ['src/index.ts', 'serve', '--port', '0', '--hostname', '127.0.0.1', '--print-logs'], {
    cwd: path.join(process.env.KERNEL_ROOT ?? path.join(root, 'agent-kernel'), 'packages/opencode'),
    env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  const exited = new Promise(resolve => server.once('exit', resolve))
  const stop = async () => {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill('SIGTERM')
      const timer = setTimeout(() => server.kill('SIGKILL'), 1500)
      await exited
      clearTimeout(timer)
    }
    await writeFile(path.join(fixture, 'kernel.log'), logs)
    await writeFile(logFile, logs)
  }
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Kernel startup timeout')), 60_000)
      const output = data => {
        logs += data.toString()
        const match = logs.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/)
        if (match) { clearTimeout(timer); resolve(match[1]) }
      }
      server.stdout.on('data', output); server.stderr.on('data', output)
      server.once('error', err => { clearTimeout(timer); reject(err) })
      server.once('exit', code => { clearTimeout(timer); reject(new Error(`Kernel exited ${code}`)) })
    })
    return {
      url, fixture, stop, logFile, pid: server.pid,
      async request(route, body, method = body === undefined ? 'GET' : 'POST') {
        const response = await fetch(`${url}${route}${route.includes('?') ? '&' : '?'}directory=${encodeURIComponent(directory)}`, {
          method, headers: { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45_000),
        })
        const text = await response.text()
        if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${text.slice(0, 2000)}`)
        return text ? JSON.parse(text) : undefined
      },
    }
  } catch (error) {
    await stop()
    throw new Error(`${error.message}\n${logs.slice(-5000)}\nFixture: ${fixture}`, { cause: error })
  }
}

export async function run(command, args, { timeout = 60_000, cwd = root, input } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeout)
    proc.stdout.on('data', data => { stdout += data })
    proc.stderr.on('data', data => { stderr += data })
    proc.once('error', error => { clearTimeout(timer); reject(error) })
    proc.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(`${command} exited ${code ?? signal}: ${stderr.slice(-3000)}`))
    })
    proc.stdin.end(input)
  })
}
