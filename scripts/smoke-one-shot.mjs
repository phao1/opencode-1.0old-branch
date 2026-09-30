import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const server = spawn(process.env.BUN_BINARY ?? 'bun', ['src/index.ts', 'serve', '--port', '4892', '--hostname', '127.0.0.1'], {
  cwd: path.join(root, 'agent-kernel/packages/opencode'),
  env: { ...process.env, OPENCODE_CONFIG_DIR: path.join(root, '.opencode') }, stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = ''
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Kernel startup timeout: ' + logs.slice(-3000))), 60000)
    const output = chunk => { logs += chunk; if (logs.includes('listening on')) { clearTimeout(timer); resolve() } }
    server.stdout.on('data', output); server.stderr.on('data', output)
    server.on('error', error => { clearTimeout(timer); reject(error) })
    server.on('exit', code => { clearTimeout(timer); reject(new Error(`Kernel exited ${code}: ${logs.slice(-3000)}`)) })
  })
  const headers = process.env.OPENCODE_SERVER_PASSWORD ? { Authorization: `Basic ${Buffer.from(`${process.env.OPENCODE_SERVER_USERNAME ?? 'opencode'}:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}` } : {}
  const query = '?directory=' + encodeURIComponent(root)
  const response = await fetch('http://127.0.0.1:4892/experimental/tool/ids' + query, { headers })
  assert.equal(response.status, 200)
  const tools = await response.json()
  for (const name of ['one_shot_issue','one_shot_start','one_shot_status','one_shot_cancel']) assert.ok(tools.includes(name), `Missing ${name}`)
  const session = await fetch('http://127.0.0.1:4892/session' + query, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'one-shot integration smoke', permission: [{ permission: '*', pattern: '*', action: 'deny' }] }) })
  assert.equal(session.status, 200)
  const data = await session.json(); assert.ok(data.id)
  const removed = await fetch('http://127.0.0.1:4892/session/' + data.id + query, { method: 'DELETE', headers }); assert.equal(removed.status, 200)
  console.log(JSON.stringify({ kernel: '1.3.17', oneShotTools: tools.filter(x => x.startsWith('one_shot_')), sessionAPI: 'create/delete passed', modelInvocation: 'not attempted' }, null, 2))
} finally { server.kill('SIGTERM') }
