import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { startKernel } from './lib/kernel-lab.mjs'

// The fixed kernel has a distinct public hook identity for native SubtaskPart.
// This verifies the installed product, never patches the kernel or task tool.
export async function runNativeTaskProbe({ installedPluginPath, evidenceDir }) {
  evidenceDir = path.resolve(evidenceDir)
  await mkdir(evidenceDir, { recursive: true })
  const cases = []
  for (const mode of ['review-command', 'after-history', 'pending-input', 'model-stale']) {
    const id = `native-task-${mode}`, directory = path.join(evidenceDir, mode)
    await mkdir(directory, { recursive: true })
    const stateDirectory = path.join(directory, 'state')
    const requests = [], held = []
    const provider = http.createServer(async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk
      requests.push(JSON.parse(raw)); held.push(res)
      if (mode === 'model-stale' && requests.length === 1) return
      finish(res, 'Native task protocol fixture completed.')
    })
    await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
    const item = { id, passed: false, claims: ['ST-03', 'ST-05', 'ST-06', 'ST-07'], mode }
    cases.push(item)
    let lab, sessionID
    try {
      lab = await startKernel({ directory, config: {
        plugin: [[installedPluginPath, { stateDirectory }]],
        provider: { native: { npm: '@ai-sdk/openai-compatible', options: { apiKey: 'fixture', baseURL: `http://127.0.0.1:${provider.address().port}/v1` }, models: { probe: { name: 'native-task-fixture', tool_call: true, limit: { context: 32000, output: 1000 } } } } },
        default_agent: 'verification', agent: { title: { disable: true }, summary: { disable: true }, verification: { mode: 'primary', permission: { '*': 'deny', task: 'allow' } }, general: { mode: 'subagent', model: 'native/probe', permission: { '*': 'deny' } } },
        compaction: { auto: false },
      } })
      await lab.request('/experimental/tool/ids')
      const session = await lab.request('/session', { title: id, permission: [{ permission: '*', pattern: '*', action: 'deny' }, { permission: 'task', pattern: '*', action: 'allow' }] })
      sessionID = session.id
      const route = `/session/${sessionID}`, model = { providerID: 'native', modelID: 'probe' }
      const submit = parts => lab.request(route + '/prompt_async', { model, agent: 'verification', parts })
      const messages = () => lab.request(route + '/message')
      const children = () => lab.request(route + '/children')
      const idle = async () => !(await lab.request('/session/status'))[sessionID]
      if (mode === 'after-history') {
        await submit([{ type: 'text', text: 'HISTORY: complete this read-only initial turn.' }])
        await until(async () => requests.length === 1 && await idle())
      }
      const subtask = { type: 'subtask', agent: 'general', description: 'Read-only native task probe', prompt: 'Reply that the native task probe is complete. Do not call tools.' }
      if (mode === 'review-command') {
        await lab.request(route + '/command', { command: 'review', arguments: '', agent: 'general', model: 'native/probe' })
      } else if (mode === 'model-stale') {
        await submit([{ type: 'text', text: 'Start a task using the task tool.' }])
        await until(() => requests.length === 1)
        await submit([{ type: 'text', text: 'steer: CORRECTED_NATIVE_TASK: do not start a subagent; respond briefly instead.' }])
        await until(async () => (await messages()).filter(m => m.info.role === 'user').length === 2)
        finish(held[0], null, { name: 'task', arguments: { subagent_type: 'general', description: 'Old model task', prompt: 'This obsolete model task must never start.' } })
      } else {
        const parts = mode === 'pending-input' ? [subtask, { type: 'text', text: 'PENDING_NATIVE_GUIDANCE: inspect this input before any action.' }, { type: 'file', mime: 'text/plain', filename: 'pending.txt', url: 'data:text/plain;base64,cGVuZGluZw==' }] : [subtask]
        await submit(parts)
      }
      await until(async () => (await messages()).some(m => m.info.role === 'assistant') && await idle())
      await delay(350)
      const saved = await messages(), descendants = await children()
      const toolParts = saved.flatMap(m => m.parts.filter(p => p.type === 'tool'))
      const blocked = ['pending-input', 'model-stale'].includes(mode)
      assert.equal(descendants.length, blocked ? 0 : 1, 'Only eligible native tasks may create a child')
      assert.equal(requests.length, mode === 'after-history' ? 3 : mode === 'pending-input' ? 0 : 2)
      assert.ok(toolParts.some(p => p.tool === 'task'))
      if (mode === 'model-stale') {
        assert.ok(toolParts.some(p => p.state.status === 'error' && String(p.state.error).includes('STEERING_STALE_CONTEXT')), 'Model task keeps the ordinary per-assistant gate')
        assert.ok(JSON.stringify(requests[1].messages).includes('CORRECTED_NATIVE_TASK'))
      } else if (!blocked) assert.ok(toolParts.some(p => p.state.status === 'completed'), 'Native task really completes')
      if (mode === 'pending-input') {
        const source = saved.find(m => m.info.role === 'user')
        assert.ok(source.parts.some(p => p.type === 'file' && p.filename === 'pending.txt'))
        assert.ok(source.parts.some(p => p.text === 'PENDING_NATIVE_GUIDANCE: inspect this input before any action.'))
        const states = await Promise.all((await readdir(stateDirectory, { recursive: true })).filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(path.join(stateDirectory, name), 'utf8'))))
        const state = states.find(state => state.sessionID === sessionID)
        const evidence = state?.messages.find(message => message.messageID === source.info.id)
        assert.equal(evidence?.saved, 'confirmed')
        assert.deepEqual(evidence.prepared, [], 'Rejecting a native task must not fabricate normal preparation')
        assert.equal(evidence.provider.status, 'unknown')
        assert.equal(evidence.adopted.status, 'unknown')
        assert.ok(!state.diagnostics.some(d => d.code === 'native-subtask-checkpoint-passed'))
        item.guidanceEvidence = evidence
      }
      item.sessionID = sessionID; item.requests = requests; item.messages = saved; item.children = descendants
      item.fixture = lab.fixture
      item.assertions = { expectedProviderRequests: requests.length, childSessions: descendants.length, taskStatus: toolParts.map(p => p.state.status), ordinaryModelTaskStillGated: mode === 'model-stale', mixedUnpreparedInputBlocked: mode === 'pending-input' }
      if (mode === 'pending-input') item.limitations = ['Native task hook rejection can leave a running ToolPart. Guidance is retained and not marked normal-prepared; this path does not automatically recover the native task.']
      item.passed = true
    } catch (error) { item.error = error.stack }
    finally {
      if (lab && sessionID) await lab.request(`/session/${sessionID}/abort`, {}).catch(() => {})
      for (const response of held) response.destroy()
      provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve))
      if (lab) await lab.stop()
      await writeFile(path.join(directory, 'report.json'), JSON.stringify(item, null, 2))
    }
  }
  const reportPath = path.join(evidenceDir, 'report.json')
  await writeFile(reportPath, JSON.stringify({ installedPluginPath, provider: 'deterministic protocol fixture, not real-model quality evidence', cases }, null, 2))
  return { cases, reportPath }
}
function finish(res, text, tool) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const delta = tool ? { role: 'assistant', tool_calls: [{ index: 0, id: 'native_old_model_call', type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.arguments) } }] } : { role: 'assistant', content: text }
  const chunk = (delta, finish_reason) => ({ id: 'native-fixture', object: 'chat.completion.chunk', created: 1, model: 'probe', choices: [{ index: 0, delta, finish_reason }] })
  res.write('data: ' + JSON.stringify(chunk(delta, null)) + '\n\n')
  res.end('data: ' + JSON.stringify(chunk({}, tool ? 'tool_calls' : 'stop')) + '\n\ndata: [DONE]\n\n')
}
async function until(fn) { const end = Date.now() + 30000; while (Date.now() < end) { if (await fn()) return; await delay(30) } throw new Error('Native-task protocol timeout') }
