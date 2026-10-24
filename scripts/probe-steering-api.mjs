import http from 'node:http'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { startKernel, root } from './lib/kernel-lab.mjs'

// A deterministic wire-level provider exposes exact race boundaries. This tests
// the REAL kernel and hooks, but is explicitly NOT real-model quality evidence.
await mkdir(path.join(root, '.codeagent'), { recursive: true })
const evidence = await mkdtemp(path.join(root, '.codeagent/steering-api-'))
const reports = []
for (const gate of [false, true]) {
  const requests = []
  let held
  const provider = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    requests.push(body)
    if (requests.length === 1) { held = res; return }
    if (requests.length === 2) respond(res, { tool: 'probe_step', action: 'revised' })
    else respond(res, { text: 'Finished the revised action.' })
  })
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
  const log = path.join(evidence, `${gate ? 'gate' : 'baseline'}.jsonl`)
  await writeFile(log, '')
  let lab
  try {
    lab = await startKernel({ config: {
      plugin: [[path.join(root, 'test/steering/fixtures/public-api-probe.ts'), { log, gate }]],
      provider: { probe: { npm: '@ai-sdk/openai-compatible', name: 'Deterministic protocol probe',
        options: { apiKey: 'not-a-secret', baseURL: `http://127.0.0.1:${provider.address().port}/v1` },
        models: { probe: { name: 'probe', tool_call: true, limit: { context: 32000, output: 1000 } } },
      } },
      agent: { title: { disable: true }, summary: { disable: true } },
    } })
    const ids = await lab.request('/experimental/tool/ids')
    assert.ok(ids.includes('probe_step'), 'Probe plugin must really be loaded')
    const session = await lab.request('/session', { title: 'Steering API probe', permission: [{ permission: '*', pattern: '*', action: 'allow' }] })
    const prompt = text => ({ model: { providerID: 'probe', modelID: 'probe' }, parts: [{ type: 'text', text }] })
    await lab.request(`/session/${session.id}/prompt_async`, prompt('Perform the old action using probe_step.'))
    await until(() => held, 'first actual provider request')
    await lab.request(`/session/${session.id}/prompt_async`, prompt('STEERING_PROBE: change the action to revised; keep this task.'))
    await until(async () => (await lab.request(`/session/${session.id}/message`)).some(m => m.info.role === 'user' && m.parts.some(p => p.text?.includes('STEERING_PROBE'))), 'persisted guidance')
    respond(held, { tool: 'probe_step', action: 'old' })
    await until(async () => {
      const statuses = await lab.request('/session/status')
      return requests.length >= 3 && (!statuses[session.id] || statuses[session.id].type === 'idle')
    }, 'completed model/tool loop')
    const events = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse)
    const actions = events.filter(e => e.kind === 'execute').map(e => e.action)
    assert.deepEqual(actions, gate ? ['revised'] : ['old', 'revised'])
    assert.equal(events.filter(e => e.kind === 'blocked').length, gate ? 1 : 0)
    assert.ok(JSON.stringify(requests[1].messages).includes('STEERING_PROBE'), 'Second model request must receive guidance')
    const messages = await lab.request(`/session/${session.id}/message`)
    assert.equal(messages.filter(m => m.info.role === 'user').length, 2, 'No duplicate user submissions')
    await writeFile(path.join(evidence, `${gate ? 'gate' : 'baseline'}-requests.json`), JSON.stringify(requests, null, 2))
    await writeFile(path.join(evidence, `${gate ? 'gate' : 'baseline'}-messages.json`), JSON.stringify(messages, null, 2))
    reports.push({ gate, session: session.id, fixture: lab.fixture, providerRequests: requests.length, actions, passed: true })
  } finally {
    held?.destroy()
    provider.closeAllConnections()
    await new Promise(resolve => provider.close(resolve))
    if (lab) await lab.stop()
  }
}
const report = { kernel: '517e6c9aa4c61dbc125e7654fc596f1d529f20d9', provider: 'deterministic protocol fixture, not a real LLM', reports, evidence }
await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))

async function until(check, name) {
  const end = Date.now() + 30_000
  while (Date.now() < end) { if (await check()) return; await delay(50) }
  throw new Error(`Timed out waiting for ${name}`)
}
function respond(res, { tool, action, text }) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const chunk = delta => ({ id: 'probe-completion', object: 'chat.completion.chunk', created: 1, model: 'probe', choices: [{ index: 0, delta, finish_reason: null }] })
  const delta = tool ? { role: 'assistant', tool_calls: [{ index: 0, id: `call_${action}`, type: 'function', function: { name: tool, arguments: JSON.stringify({ action }) } }] } : { role: 'assistant', content: text }
  res.write(`data: ${JSON.stringify(chunk(delta))}\n\n`)
  const final = chunk({}); final.choices[0].finish_reason = tool ? 'tool_calls' : 'stop'
  res.end(`data: ${JSON.stringify(final)}\n\ndata: [DONE]\n\n`)
}
