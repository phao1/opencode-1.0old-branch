import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { startKernel, root, run } from './lib/kernel-lab.mjs'
import { callRealModel, sendModelResponse } from './lib/model-relay.mjs'

// The exact pinned Web app talks to an isolated real kernel and the installed
// tgz. The relay uses the signed-in CLI without copying provider credentials.
await mkdir(path.join(root, '.codeagent'), { recursive: true })
const directory = await mkdtemp(path.join(root, '.codeagent/steering-web-'))
const project = path.join(directory, 'project')
await mkdir(project)
await run('git', ['init', '-q', project])
await run('git', ['-C', project, '-c', 'user.name=Steering verification', '-c', 'user.email=steering@example.invalid', 'commit', '-qm', 'Initialize disposable verification project', '--allow-empty'])
const pkg = JSON.parse(await readFile(path.join(root, 'dist/steering-package-report.json'), 'utf8'))
const requests = []
let pause = false, pending, lab, web
const provider = http.createServer(async (req, res) => {
  if (req.url === '/control') {
    if (req.method === 'POST') { pause = true }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ pauseNext: pause, waiting: !!pending, requests: requests.length, directory }))
    return
  }
  if (req.url === '/release') {
    pause = false
    pending?.(); pending = undefined
    res.end('released')
    return
  }
  try {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw), number = requests.push(body)
    const decision = await callRealModel(body, path.join(directory, `model-${number}`))
    if (pause) {
      pause = false
      await new Promise(resolve => { pending = resolve })
    }
    if (!res.destroyed) sendModelResponse(res, decision, number)
  } catch (error) {
    await writeFile(path.join(directory, `error-${requests.length}.txt`), error.stack ?? String(error))
    if (!res.destroyed) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })) }
  }
})
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
const relay = `http://127.0.0.1:${provider.address().port}`
try {
  lab = await startKernel({ directory: project, config: {
    plugin: [[pkg.installedPluginPath, { stateDirectory: path.join(directory, 'state') }], [path.join(root, 'test/steering/fixtures/action-probe.ts'), { log: path.join(directory, 'actions.jsonl') }]],
    model: 'steering/verification', provider: { steering: { npm: '@ai-sdk/openai-compatible', name: 'Local verification relay', options: { apiKey: 'fixture', baseURL: relay + '/v1' }, models: { verification: { name: 'Codex verification relay', tool_call: true, limit: { context: 64000, output: 2000 } } } } },
    default_agent: 'verification', agent: { title: { disable: true }, summary: { disable: true }, verification: { mode: 'primary', permission: { '*': 'deny', probe_step: 'allow', steering_status: 'allow' } } },
    compaction: { auto: false },
  } })
  const tools = await lab.request('/experimental/tool/ids')
  if (!tools.includes('steering_status') || !tools.includes('probe_step')) throw new Error('Verification tools failed to load')
  await lab.request('/project/current')
  const port = process.env.STEERING_WEB_PORT ?? '4317'
  web = spawn(process.env.BUN_BINARY ?? 'bun', ['run', '--cwd', path.join(root, 'agent-kernel/packages/app'), 'dev', '--host', '127.0.0.1', '--port', port, '--strictPort'], {
    env: { ...process.env, VITE_OPENCODE_SERVER_HOST: '127.0.0.1', VITE_OPENCODE_SERVER_PORT: new URL(lab.url).port },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  web.stdout.on('data', data => { logs += data; process.stdout.write(data) })
  web.stderr.on('data', data => { logs += data; process.stderr.write(data) })
  const info = { pid: process.pid, url: `http://127.0.0.1:${port}`, server: lab.url, relay, project, directory, packageSHA256: pkg.sha256 }
  await writeFile(path.join(directory, 'lab.json'), JSON.stringify(info, null, 2))
  await writeFile(path.join(root, '.codeagent/steering-web-lab.json'), JSON.stringify(info, null, 2))
  console.log(JSON.stringify(info, null, 2))
  await new Promise((resolve, reject) => {
    process.once('SIGINT', resolve); process.once('SIGTERM', resolve)
    web.once('error', reject); web.once('exit', code => code === 0 ? resolve() : reject(new Error(`Web exited ${code}`)))
  })
  await writeFile(path.join(directory, 'web.log'), logs)
} finally {
  pending?.()
  web?.kill('SIGTERM')
  provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve))
  if (lab) await lab.stop()
  await writeFile(path.join(directory, 'requests.json'), JSON.stringify(requests, null, 2))
}
