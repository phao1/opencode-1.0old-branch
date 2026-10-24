import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { startKernel, root } from './lib/kernel-lab.mjs'
import { sendModelResponse } from './lib/model-relay.mjs'

// Exercise the host's real Undo cleanup and public message deletion paths.
// Deterministic responses isolate history lifecycle from model quality.
export async function runHistoryProbe({ installedPluginPath, evidenceDir }) {
  const cases = []
  for (const mode of ['undo', 'delete']) {
    const directory = path.resolve(evidenceDir, mode)
    await mkdir(directory, { recursive: true })
    const log = path.join(directory, 'actions.jsonl')
    const stateDirectory = path.join(directory, 'state')
    const requests = []
    const provider = http.createServer(async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk
      requests.push(JSON.parse(raw))
      const number = requests.length
      const action = number === 1 ? 'before-undo' : 'after-undo'
      sendModelResponse(res, number === 1 || number === 3
        ? { kind: 'tool', tool_name: 'probe_step', arguments: JSON.stringify({ action }), text: null }
        : { kind: 'text', text: 'History probe completed.', tool_name: null, arguments: null }, number)
    })
    await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
    const item = { id: `history-${mode}`, claims: ['ST-03', 'ST-04', 'ST-05', 'ST-07'], passed: false }
    cases.push(item)
    let lab, id
    try {
      lab = await startKernel({ directory, config: {
        plugin: [[installedPluginPath, { stateDirectory }], [path.join(root, 'test/steering/fixtures/action-probe.ts'), { log }]],
        provider: { history: { npm: '@ai-sdk/openai-compatible', options: { apiKey: 'fixture', baseURL: `http://127.0.0.1:${provider.address().port}/v1` }, models: { probe: { name: 'history-fixture', tool_call: true, limit: { context: 32000, output: 1000 } } } } },
        default_agent: 'verification', agent: { title: { disable: true }, summary: { disable: true }, verification: { mode: 'primary', permission: { '*': 'deny', probe_step: 'allow', steering_status: 'allow' } } },
        compaction: { auto: false },
      } })
      const tools = await lab.request('/experimental/tool/ids')
      assert.ok(tools.includes('probe_step') && tools.includes('steering_status'))
      id = (await lab.request('/session', { title: item.id })).id
      const route = `/session/${id}`
      const submit = text => lab.request(route + '/prompt_async', { model: { providerID: 'history', modelID: 'probe' }, agent: 'verification', parts: [{ type: 'text', text }] })
      const messages = () => lab.request(route + '/message')
      const settled = async count => {
        const end = Date.now() + 30000
        while (Date.now() < end) {
          if (requests.length >= count && !(await lab.request('/session/status'))[id]) return
          await delay(30)
        }
        throw new Error('History probe did not settle')
      }
      await submit('Record before-undo using probe_step, then finish.')
      await settled(2)
      const before = await messages()
      const original = before.find(message => message.info.role === 'user')
      if (mode === 'undo') await lab.request(route + '/revert', { messageID: original.info.id })
      else await lab.request(route + '/message/' + original.info.id, undefined, 'DELETE')
      await submit('Record after-undo using probe_step, then finish.')
      await settled(4)
      const after = await messages()
      const actions = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      item.messages = after
      item.actions = actions
      item.sessionID = id
      // Public deletion can leave an empty metadata row after a late summary
      // update; the original effective input must still be absent.
      assert.ok(!after.some(message => message.info.id === original.info.id && message.parts.some(part => part.type === 'text' || part.type === 'file')), 'Host really removed the original user input')
      assert.deepEqual(actions.filter(event => event.kind === 'completed').map(event => event.action), ['before-undo', 'after-undo'])
      assert.ok(after.flatMap(message => message.parts).some(part => part.type === 'tool' && part.tool === 'probe_step' && part.state.status === 'completed' && part.state.input.action === 'after-undo'))
      item.passed = true
    } catch (error) { item.error = error.stack }
    finally {
      if (lab && id) await lab.request(`/session/${id}/abort`, {}).catch(() => {})
      provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve))
      if (lab) { item.fixture = lab.fixture; await lab.stop() }
      await writeFile(path.join(directory, 'report.json'), JSON.stringify({ ...item, requests }, null, 2))
    }
  }
  return { cases }
}
