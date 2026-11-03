// Real model evidence only. No scripted model decisions or fallback provider.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile, access, rename } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { createCodexCliBridge, invokeCodexCli } from './lib/codex-cli-bridge.mjs'
import { startKernel, until, entry, root } from '../external-plugins/steering/test/kernel.mjs'

const tui = process.argv.includes('--tui')
const natural = process.argv.includes('--natural')
if (natural && !tui) throw Error('--natural requires --tui')
const output = path.resolve((process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : undefined) ?? path.join(root, '.codeagent/steering-v2-demo'))
// Every rerun starts with new files, retaining complete previous evidence.
if (await access(output).then(() => true, () => false)) await rename(output, output + '.archive-' + Date.now() + '-' + randomUUID().slice(0,8))
await mkdir(output, { recursive: true })
const cases = []
for (const enabled of [false, true]) {
  const out = path.join(output, enabled ? 'enabled' : 'disabled')
  await mkdir(out, { recursive: true })
  // Keep disposable XDG caches/databases locally; export messages and logs below.
  await writeFile(path.join(out, '.gitignore'), 'kernel/\n')
  const requests = [], results = []
  const item = { enabled, source: 'real', tui, natural, timing: natural ? 'unheld-tool-running' : 'held-model-decision', passed: false, out }; cases.push(item)
  let kernel, bridge, release, held = false, socket, session
  const exists = name => access(path.join(out, name)).then(() => true, () => false)
  const capture = async name => {
    if (!socket) return
    const text = execFileSync('tmux', ['-L', socket, 'capture-pane', '-p', '-S', '-2000', '-t', 'demo'], { encoding: 'utf8' })
    await writeFile(path.join(out, name + '.txt'), text)
  }
  try {
    const tool = path.join(out, 'action.mjs')
    const zod = path.join(root, 'node_modules/zod/index.js')
    await writeFile(tool, `import {z} from ${JSON.stringify(zod)}; import {writeFile} from 'node:fs/promises'; import path from 'node:path'; import {setTimeout as delay} from 'node:timers/promises';
      export default async () => ({tool:{work_action:{description:'Write one task artifact. Use once for each requested step. ${natural ? 'Each action sleeps 8 seconds before writing.' : ''}',
      args:{name:z.enum(['checkpoint.md','obsolete.md','SUMMARY.md']),content:z.string()},
      async execute(args){if (${natural}) await delay(8000); await writeFile(path.join(${JSON.stringify(out)},args.name),args.content);return 'Wrote '+args.name}}}})`)
    bridge = await createCodexCliBridge({ codexBinary: process.env.CODEX_BINARY ?? 'codex', backend: async (body, options) => {
      const n = requests.length; requests.push(body)
      await writeFile(path.join(out, `request-${n}.json`), JSON.stringify(body, null, 2))
      const result = await invokeCodexCli(body, { ...options, timeoutMs: 120000, onEvidence: async evidence => {
        await writeFile(path.join(out, `codex-${n}.jsonl`), evidence.jsonl)
        await writeFile(path.join(out, `response-${n}.json`), JSON.stringify({ decision: evidence.decision, usage: evidence.usage }, null, 2))
      } })
      results.push(result)
      // Hold the model's own obsolete decision after it has chosen it, before
      // forwarding the unchanged decision to OpenCode's normal tool checkpoint.
      if (!natural && !held && await exists('checkpoint.md') && result.decision.kind === 'tool') {
        assert.equal(result.decision.tool_name, 'work_action')
        assert.equal(JSON.parse(result.decision.arguments).name, 'obsolete.md', 'Real model must choose the second original step')
        held = true
        await new Promise(resolve => { release = resolve })
      }
      return result
    } })
    kernel = await startKernel({ directory: out, out: path.join(out, 'kernel'), plugin: [tool, ...(enabled ? [entry] : [])],
      extra: { provider: { real: { npm: '@ai-sdk/openai-compatible', options: { apiKey: bridge.apiKey, baseURL: bridge.baseURL },
        models: { [bridge.modelID]: { name: 'Real Codex CLI', tool_call: true, limit: { context: 128000, output: 8000 } } } } },
        model: 'real/' + bridge.modelID, agent: { title: { disable: true }, summary: { disable: true }, build: { tools: { '*': false, work_action: true } } } } })
    session = await kernel.request('/session', { title: 'Real steering ' + enabled, permission: [{ permission: '*', pattern: '*', action: 'allow' }] })
    const route = '/session/' + session.id
    const task = (natural ? 'Each action must sleep 8 seconds before writing; work_action implements that delay. ' : '') + 'Use work_action to perform these separate steps in order, exactly one artifact per tool call: (1) write checkpoint.md with "completed first step"; (2) write obsolete.md with "original second step"; (3) write SUMMARY.md summarizing what you completed. Then give a brief final answer.'
    const guidance = 'Change direction now: keep checkpoint.md. Skip the pending obsolete.md action. Write SUMMARY.md explaining that obsolete.md was skipped because of this latest guidance, and retain the completed first step. Do not perform obsolete actions.'
    const sendKeys = text => execFileSync('tmux', ['-L', socket, 'send-keys', '-t', 'demo', '-l', text])
    if (tui) {
      socket = 'steering-v2-' + randomUUID().slice(0, 12)
      const binary = process.env.OPENCODE_BINARY ?? path.join(process.env.HOME, '.local/opencode-1.3.17/opencode')
      const launcher = path.join(out, 'launch.sh')
      const quote = s => "'" + s.replaceAll("'", "'\\''") + "'"
      await writeFile(launcher, '#!/bin/sh\n' + Object.entries(kernel.env).filter(([k]) => k.startsWith('XDG_') || k.startsWith('OPENCODE_')).map(([k, v]) => 'export ' + k + '=' + quote(v)).join('\n') + '\nexec ' + [binary, 'attach', kernel.url, '--dir', out, '--session', session.id].map(quote).join(' ') + '\n', { mode: 0o700 })
      execFileSync('tmux', ['-L', socket, 'new-session', '-d', '-s', 'demo', '-x', '140', '-y', '45', launcher])
      await until(() => execFileSync('tmux', ['-L', socket, 'capture-pane', '-p', '-t', 'demo'], { encoding: 'utf8' }).includes('Real Codex CLI'), 'TUI ready', 30000)
      sendKeys(task); execFileSync('tmux', ['-L', socket, 'send-keys', '-t', 'demo', 'Enter'])
    } else await kernel.request(route + '/prompt_async', { model: { providerID: 'real', modelID: bridge.modelID }, agent: 'build', parts: [{ type: 'text', text: task }] })
    if (natural) await until(async () => (await kernel.request(route + '/message')).some(m => m.parts.some(p => p.type === 'tool' && p.tool === 'work_action' && p.state.status === 'running' && p.state.input?.name === 'checkpoint.md')), 'first sleep 8 tool running', 180000)
    else await until(() => release, 'real model stale decision barrier', 180000)
    await capture('before-guidance')
    if (tui) { sendKeys(guidance); execFileSync('tmux', ['-L', socket, 'send-keys', '-t', 'demo', 'Enter']) }
    else await kernel.request(route + '/prompt_async', { model: { providerID: 'real', modelID: bridge.modelID }, agent: 'build', parts: [{ type: 'text', text: guidance }] })
    await until(async () => (await kernel.request(route + '/message')).some(m => m.parts.some(p => p.text === guidance)), 'native guidance saved', 30000)
    await capture('guidance-submitted'); release?.(); release = undefined
    await until(async () => await exists('SUMMARY.md') && !(await kernel.request('/session/status'))[session.id], 'real final summary and idle', 240000)
    await capture('completed')
    const messages = await kernel.request(route + '/message')
    await writeFile(path.join(out, 'messages.json'), JSON.stringify(messages, null, 2))
    if (!natural) assert.equal(await exists('obsolete.md'), !enabled)
    if (natural && enabled) assert.equal(await exists('obsolete.md'), false)
    item.obsoleteWritten = await exists('obsolete.md')
    assert.equal(await readFile(path.join(out, 'checkpoint.md'), 'utf8'), 'completed first step')
    const summary = await readFile(path.join(out, 'SUMMARY.md'), 'utf8')
    assert.ok(summary.length > 0)
    if (enabled) {
      assert.ok(/skip|跳过/i.test(summary), 'Real model must explain skipped action')
      if (!natural) assert.ok(messages.flatMap(m => m.parts).some(p => p.type === 'tool' && p.state.status === 'error' && p.state.error.includes('STEERING_STALE_CONTEXT')))
    }
    item.summary = summary; item.requests = requests.length; item.usage = bridge.stats.usage; item.passed = true
  } catch (e) { item.error = e.stack; await capture('failure').catch(() => {}) }
  finally {
    release?.()
    if (socket) { try { execFileSync('tmux', ['-L', socket, 'kill-server']) } catch {} }
    if (kernel) {
      if (!item.passed && session) await writeFile(path.join(out, 'messages.json'), JSON.stringify(await kernel.request('/session/' + session.id + '/message').catch(() => []), null, 2))
      await kernel.stop()
      await writeFile(path.join(out, 'kernel-log.txt'), await readFile(path.join(out, 'kernel/kernel.log'), 'utf8'))
    }
    if (bridge) await bridge.close()
    await writeFile(path.join(out, 'report.json'), JSON.stringify(item, null, 2))
  }
}
const report = { source: 'real', tui, natural, cases, passed: cases.every(c => c.passed) }
if (natural) report.observation = cases.every(c => c.passed && !c.obsoleteWritten) ? 'Both controls naturally adopted guidance; no differential steering claim.' : 'See per-case artifacts for observed natural timing.'
await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
if (!report.passed) process.exitCode = 1
