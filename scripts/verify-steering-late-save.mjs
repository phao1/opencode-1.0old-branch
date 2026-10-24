// Installed-product recovery for a native message ID allocated before the
// assistant, but persisted after that assistant's request snapshot.
import http from 'node:http'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { startKernel, root } from './lib/kernel-lab.mjs'

export async function runLateSaveProbe({ installedPluginPath, evidenceDir } = {}) {
  assert.ok(installedPluginPath, 'A clean-installed product entry is required')
  const installedBundleSHA256 = createHash('sha256').update(await readFile(installedPluginPath)).digest('hex')
  const kernelRoot = path.resolve(process.env.KERNEL_ROOT ?? path.join(root, 'agent-kernel'))
  const kernel = execFileSync('git', ['-C', kernelRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  assert.equal(kernel, '517e6c9aa4c61dbc125e7654fc596f1d529f20d9')
  await mkdir(path.join(root, '.codeagent'), { recursive: true })
  evidenceDir ??= await mkdtemp(path.join(root, '.codeagent/steering-installed-late-save-'))
  await mkdir(evidenceDir, { recursive: true })
  const stateDirectory = path.join(evidenceDir, 'state'), reportPath = path.join(evidenceDir, 'report.json')
  const requests = [], responses = [], events = [], barriers = new Map()
  const item = { id: 'completion-late-save', passed: false, claims: ['ST-01', 'ST-02', 'ST-04', 'ST-05', 'ST-06'], assertions: {} }
  const cases = [item]
  let lab, setupError
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part
    if (req.url.startsWith('/barrier/')) { barriers.set(req.url.split('/').at(-1), res); return }
    if (req.url === '/event') { events.push(JSON.parse(raw)); res.end('{}'); return }
    requests.push(JSON.parse(raw)); responses.push(res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  const fixturePlugin = path.join(evidenceDir, 'public-barriers.mjs')
  // This plugin is BEFORE production. It only delays public hooks and logs;
  // it never rewrites messages, prepares context, or dispatches a wake.
  await writeFile(fixturePlugin, `export default async () => {
    const log = value => fetch(${JSON.stringify(url + '/event')}, {method:'POST',body:JSON.stringify(value)})
    return {
      async 'chat.message'(_, output) {
        const text = output.parts.find(p => p.type==='text' && !p.synthetic)?.text || ''
        const which = text.startsWith('LATE_TASK:') ? 'task' : text.startsWith('LATE_GUIDANCE:') ? 'guide' : undefined
        await log({kind:'chat.message',which,id:output.message.id,synthetic:output.parts.some(p=>p.synthetic)})
        if (which) await fetch(${JSON.stringify(url + '/barrier/')} + which)
        await log({kind:'barrier-released',which,id:output.message.id})
      },
      async 'tool.execute.before'(input) { await log({kind:'tool-execute-before',...input}) }
    }
  }`)
  try {
    lab = await startKernel({ config: {
      plugin: [fixturePlugin, [installedPluginPath, { stateDirectory }]],
      provider: { late: { npm: '@ai-sdk/openai-compatible', options: { apiKey: 'fixture', baseURL: url + '/v1' },
        models: { late: { name: 'late', tool_call: true, limit: { context: 32000, output: 1000 } } } } },
      agent: { title: { disable: true }, summary: { disable: true } },
    } })
    assert.ok((await lab.request('/experimental/tool/ids')).includes('steering_status'))
    const session = await lab.request('/session', { title: 'Installed late-save recovery', permission: [{ permission: '*', pattern: '*', action: 'deny' }] })
    item.sessionID = session.id; item.fixture = lab.fixture
    const route = '/session/' + session.id, model = { providerID: 'late', modelID: 'late' }
    await lab.request(route + '/prompt_async', { model, parts: [{ type: 'text', text: 'LATE_TASK: finish with a short plain-text response.' }] })
    await until(() => barriers.has('task'), 'task hook barrier')
    await lab.request(route + '/prompt_async', { model, agent: 'build', system: 'original-guidance-system', variant: 'original-guidance-variant', format: { type: 'text' },
      parts: [{ type: 'text', text: 'LATE_GUIDANCE: replace the initial result with corrected-value.' },
        { type: 'file', mime: 'text/plain', filename: 'original.txt', url: 'data:text/plain;base64,cHJlc2VydmVkIGF0dGFjaG1lbnQ=' }] })
    await until(() => barriers.has('guide'), 'guidance hook barrier')
    barriers.get('task').end('{}')
    await until(() => requests.length === 1, 'first actual provider request')
    assert.ok(!JSON.stringify(requests[0].messages).includes('LATE_GUIDANCE:'))
    // Only now can guidance reach the product observe hook: active assistant
    // exists, while its ID was allocated after the still-unsaved guide ID.
    barriers.get('guide').end('{}')
    let originals
    await until(async () => {
      originals = await lab.request(route + '/message')
      const savedGuide = originals.find(m => m.parts.some(p => p.text?.startsWith('LATE_GUIDANCE:')))
      return originals.filter(m => m.info.role === 'user').length === 2
        && savedGuide?.parts.some(p => p.type === 'file' && p.filename === 'original.txt')
        && savedGuide.parts.some(p => p.type === 'text' && p.text === 'preserved attachment')
    }, 'original guidance persisted')
    const guide = originals.find(m => m.parts.some(p => p.text?.startsWith('LATE_GUIDANCE:')))
    const initialAssistant = originals.find(m => m.info.role === 'assistant')
    assert.ok(guide.info.id < initialAssistant.info.id, 'Native guide ID must predate assistant ID')
    item.originalMessages = structuredClone(originals)
    item.guideID = guide.info.id; item.initialAssistantID = initialAssistant.info.id
    const permissions = (await lab.request(route)).permission
    finish(responses[0], 'Initial completion without the correction.')
    await until(() => requests.length >= 2, 'product automatic continuation')
    assert.equal(requests.length, 2)
    const nextContext = JSON.stringify(requests[1].messages)
    assert.ok(nextContext.includes('LATE_GUIDANCE:'))
    assert.ok(nextContext.includes('preserved attachment'), 'Original text attachment must reach next actual request')
    assert.ok(nextContext.includes('[Steering continuation]'))
    finish(responses[1], 'Corrected-value after automatic recovery.')
    await until(async () => { const states = await lab.request('/session/status'); return !states[session.id] || states[session.id].type === 'idle' }, 'final idle')
    let state
    await until(async () => {
      item.stateFiles = await readStateFiles(stateDirectory)
      state = item.stateFiles.find(f => f.value.sessionID === session.id)?.value
      return state?.messages.find(m => m.messageID === guide.info.id)?.prepared.length > 0
    }, 'product ledger preparation')
    await delay(700)
    assert.equal(requests.length, 2, 'Recovery must remain bounded after completion')
    item.messages = await lab.request(route + '/message')
    const users = item.messages.filter(m => m.info.role === 'user')
    assert.equal(users.length, 3)
    const added = users.filter(m => !originals.some(old => old.info.id === m.info.id))
    assert.equal(added.length, 1)
    assert.ok(added[0].parts.some(p => p.type === 'text' && p.synthetic === true && p.metadata?.codeagentSteering?.kind === 'continuation'))
    assert.ok(!JSON.stringify(added[0].parts).includes('LATE_GUIDANCE:'), 'Control must not copy original user instruction')
    const nativeMetadataAdditions = []
    for (const original of originals.filter(m => m.info.role === 'user')) {
      const actual = users.find(m => m.info.id === original.info.id)
      assert.deepEqual(actual.parts, original.parts)
      for (const [key, value] of Object.entries(original.info)) assert.deepEqual(actual.info[key], value, 'Original metadata changed: ' + key)
      const extras = Object.keys(actual.info).filter(key => !(key in original.info))
      assert.ok(extras.every(key => key === 'summary'), 'Only native summary metadata may be added')
      nativeMetadataAdditions.push({ messageID: original.info.id, fields: extras })
    }
    assert.deepEqual((await lab.request(route)).permission, permissions)
    assert.equal(events.filter(e => e.kind === 'tool-execute-before').length, 0)
    const entry = state.messages.find(m => m.messageID === guide.info.id)
    assert.equal(entry.saved, 'confirmed')
    assert.equal(entry.provider.status, 'unknown'); assert.equal(entry.adopted.status, 'unknown')
    assert.equal(state.recovery.attempts.length, 1)
    assert.equal(state.recovery.attempts[0].controlMessageID, added[0].info.id)
    item.control = added[0]; item.permissions = permissions; item.nativeMetadataAdditions = nativeMetadataAdditions
    item.assertions = { installedProductLoaded: true, nativeGuideIDPredatesAssistant: true, guideSavedAfterInitialRequest: true,
      automaticProductRecovery: true, providerRequests: 2, originalUserRows: 2, syntheticControlRows: 1,
      originalPartsAndExistingMetadataUnchanged: true, originalAttachmentInNextRequest: true, permissionsUnchanged: true,
      toolExecutions: 0, guidancePrepared: true, providerAndAdoptionRemainUnknown: true, boundedObservationMs: 700 }
    item.passed = true
  } catch (error) {
    item.error = error.stack
    if (!lab) setupError = error.stack
    item.stateFiles = await readStateFiles(stateDirectory)
    if (lab && item.sessionID) item.messages = await lab.request('/session/' + item.sessionID + '/message').catch(() => [])
  } finally {
    for (const res of responses) res.destroy()
    for (const res of barriers.values()) res.destroy()
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    if (lab) await lab.stop()
    await writeFile(reportPath, JSON.stringify({ passed: item.passed, kernel, kernelRoot, installedPluginPath, installedBundleSHA256,
      fixture: lab?.fixture, stateDirectory, cases, requests, events, setupError,
      limitations: ['Deterministic transport evidence, not real-model semantic quality.', 'The fixture delays public chat.message hooks only; no transform repair or manual wake.', 'Native summary fields may be added by the kernel; existing metadata and every original part are checked unchanged.', 'No cancellation race or concurrent-new-input race is covered by this case.'] }, null, 2))
  }
  return { cases, reportPath, setupError }
}

async function readStateFiles(directory) {
  const files = []
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const filename = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(filename)
      else if (entry.name.endsWith('.json')) { try { files.push({ path: filename, value: JSON.parse(await readFile(filename, 'utf8')) }) } catch {} }
    }
  }
  await walk(directory); return files
}
async function until(check, label) {
  const end = Date.now() + 25000
  while (Date.now() < end) { if (await check()) return; await delay(30) }
  throw Error('Late-save timeout: ' + label)
}
function finish(res, text) {
  const frame = (delta, finish_reason) => ({ id: 'late-save', object: 'chat.completion.chunk', created: 1, model: 'late', choices: [{ index: 0, delta, finish_reason }] })
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  res.write('data: ' + JSON.stringify(frame({ role: 'assistant', content: text }, null)) + '\n\n')
  res.end('data: ' + JSON.stringify(frame({}, 'stop')) + '\n\ndata: [DONE]\n\n')
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runLateSaveProbe({ installedPluginPath: process.env.STEERING_INSTALLED_PLUGIN, evidenceDir: process.env.STEERING_LATE_SAVE_EVIDENCE })
  console.log(JSON.stringify({ reportPath: result.reportPath, cases: result.cases.map(c => ({ id: c.id, passed: c.passed, error: c.error })), setupError: result.setupError }))
  if (result.setupError || result.cases.some(c => !c.passed)) process.exitCode = 1
}
