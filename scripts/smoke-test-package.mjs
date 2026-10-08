import { spawn } from 'node:child_process'
import path from 'node:path'
import { existsSync, mkdtempSync, rmSync, cpSync, realpathSync } from 'node:fs'
import os from 'node:os'
import assert from 'node:assert/strict'
const bundle = path.resolve(process.argv[2])
const binary = path.join(bundle, process.platform === 'win32' ? 'opencode.exe' : 'opencode')
assert.ok(existsSync(binary), 'Missing compiled binary')
const isolated = realpathSync.native(mkdtempSync(path.join(realpathSync.native(process.env.RUNNER_TEMP ?? os.tmpdir()), 'codeagent-exe-smoke-')))
cpSync(path.join(bundle, '.opencode'), path.join(isolated, '.opencode'), { recursive: true })
const server = spawn(binary, ['serve', '--port', '4893', '--hostname', '127.0.0.1'], { cwd: isolated, env: { ...process.env, OPENCODE_CONFIG_DIR: path.join(isolated, '.opencode'), OPENCODE_DISABLE_PROJECT_CONFIG: 'true', OPENCODE_TEST_HOME: isolated, XDG_CONFIG_HOME: path.join(isolated, 'config'), XDG_DATA_HOME: path.join(isolated, 'data'), XDG_CACHE_HOME: path.join(isolated, 'cache'), XDG_STATE_HOME: path.join(isolated, 'state') }, stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Compiled package startup timeout: ' + logs.slice(-4000))), 60000)
    const output = chunk => { logs += chunk; if (logs.includes('listening on')) { clearTimeout(timer); resolve() } }
    server.stdout.on('data', output); server.stderr.on('data', output)
    server.on('error', error => { clearTimeout(timer); reject(error) })
    server.on('exit', code => { clearTimeout(timer); reject(new Error(`Compiled binary exited ${code}: ${logs.slice(-4000)}`)) })
  })
  const headers = process.env.OPENCODE_SERVER_PASSWORD ? { Authorization: `Basic ${Buffer.from(`${process.env.OPENCODE_SERVER_USERNAME ?? 'opencode'}:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}` } : {}
  const response = await fetch('http://127.0.0.1:4893/experimental/tool/ids?directory=' + encodeURIComponent(isolated), { headers, signal: AbortSignal.timeout(60000) })
  assert.equal(response.status, 200)
  const tools = await response.json()
  for (const tool of ['one_shot_issue', 'one_shot_start', 'one_shot_status', 'one_shot_cancel']) assert.ok(tools.includes(tool), `Missing ${tool} from compiled package`)
  console.log('Compiled binary + portable plugin tool registration passed; model invocation not attempted.')
} finally { server.kill(); await new Promise(resolve => { if (!server.pid || server.exitCode !== null || server.signalCode !== null) resolve(); else server.once('exit', resolve) }); rmSync(isolated, { recursive: true, force: true }) }
