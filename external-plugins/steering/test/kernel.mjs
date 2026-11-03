import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
export const entry = process.env.STEERING_INSTALLED_PLUGIN ?? path.join(root, 'external-plugins/steering/src/index.ts')
export async function until(fn, label = 'condition', ms = 20000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (await fn()) return; await delay(20) }
  throw Error('Timed out: ' + label)
}
export async function startKernel({ plugin = [], provider, directory, extra = {}, out } = {}) {
  const binary = process.env.OPENCODE_BINARY ?? path.join(process.env.HOME, '.local/opencode-1.3.17/opencode')
  const version = execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim()
  if (version !== '1.3.17') throw Error(`Expected official 1.3.17; got ${version}`)
  await mkdir(path.join(root, '.codeagent'), { recursive: true })
  const fixture = out ?? await mkdtemp(path.join(root, '.codeagent/steering-v2-kernel-'))
  const configDir = path.join(fixture, 'config/opencode')
  await mkdir(configDir, { recursive: true })
  await writeFile(path.join(configDir, 'package.json'), JSON.stringify({ private: true, dependencies: { '@opencode-ai/plugin': '1.3.17' } }))
  execFileSync('npm', ['install', '--prefix', configDir, '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', '--fetch-retries=0'], { timeout: 60000, stdio: 'pipe' })
  await writeFile(path.join(configDir, 'opencode.json'), JSON.stringify({ plugin,
    provider: provider ? { fixture: { npm: '@ai-sdk/openai-compatible', options: { apiKey: 'fixture', baseURL: provider + '/v1' },
      models: { fixture: { name: 'fixture', tool_call: true, limit: { context: 64000, output: 4000 } } } } } : {},
    model: 'fixture/fixture', agent: { title: { disable: true }, summary: { disable: true } }, compaction: { auto: false }, ...extra }))
  const env = { ...process.env }
  for (const k of Object.keys(env)) if (k.startsWith('OPENCODE_')) delete env[k]
  Object.assign(env, { XDG_CONFIG_HOME: path.join(fixture, 'config'), XDG_DATA_HOME: path.join(fixture, 'data'),
    XDG_CACHE_HOME: path.join(fixture, 'cache'), XDG_STATE_HOME: path.join(fixture, 'state'), OPENCODE_TEST_HOME: path.join(fixture, 'home'),
    OPENCODE_CONFIG_DIR: configDir, OPENCODE_DISABLE_PROJECT_CONFIG: 'true', OPENCODE_DISABLE_MODELS_FETCH: 'true' })
  const proc = spawn(binary, ['serve', '--port', '0', '--hostname', '127.0.0.1', '--print-logs'], { cwd: directory ?? root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = '', url
  proc.stdout.on('data', c => { logs += c; url ??= logs.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1] })
  proc.stderr.on('data', c => { logs += c })
  const stop = async () => {
    if (proc.exitCode === null && proc.signalCode === null) {
      const done = new Promise(resolve => proc.once('exit', resolve)); proc.kill('SIGTERM')
      const timer = setTimeout(() => proc.kill('SIGKILL'), 1500); await done; clearTimeout(timer)
    }
    await writeFile(path.join(fixture, 'kernel.log'), logs)
  }
  try { await until(() => { if (proc.exitCode !== null) throw Error(logs); return url }, 'kernel listening', 30000) }
  catch (e) { await stop(); throw e }
  return { fixture, url, env, stop,
    async request(route, body, method = body === undefined ? 'GET' : 'POST') {
      const response = await fetch(url + route + (route.includes('?') ? '&' : '?') + 'directory=' + encodeURIComponent(directory ?? root), {
        method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) })
      const raw = await response.text()
      if (!response.ok) throw Error(`${route} ${response.status}: ${raw}`)
      return raw ? JSON.parse(raw) : undefined
    } }
}
export function finish(res, text = 'Completed.', tools) {
  if (res.destroyed || res.writableEnded) return
  const frame = (delta, finish_reason) => ({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const delta = tools ? { role: 'assistant', tool_calls: tools.map((tool, index) => ({ index, id: 'call_' + index, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } })) } : { role: 'assistant', content: text }
  res.write('data: ' + JSON.stringify(frame(delta, null)) + '\n\n')
  res.end('data: ' + JSON.stringify(frame({}, tools ? 'tool_calls' : 'stop')) + '\n\ndata: [DONE]\n\n')
}
export const model = { providerID: 'fixture', modelID: 'fixture' }
