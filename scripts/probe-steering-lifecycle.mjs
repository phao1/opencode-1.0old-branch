// Actual installed-package lifecycle probes; scheduling fixtures are not LLM evidence.
import http from 'node:http'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { startKernel, root } from './lib/kernel-lab.mjs'

export async function runLifecycleProbe({ installedPluginPath, evidenceDir } = {}) {
  assert.ok(installedPluginPath, 'An actual clean-installed plugin entry is required')
  const installedBundleSHA256 = createHash('sha256').update(await readFile(installedPluginPath)).digest('hex')
  const kernelRoot = path.resolve(process.env.KERNEL_ROOT ?? path.join(root, 'agent-kernel'))
  const kernelCommit = execFileSync('git', ['-C', kernelRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  assert.equal(kernelCommit, '517e6c9aa4c61dbc125e7654fc596f1d529f20d9', 'Only the pinned kernel may be used')
  await mkdir(root + '/.codeagent', { recursive: true })
  evidenceDir ??= await mkdtemp(root + '/.codeagent/steering-lifecycle-')
  await mkdir(evidenceDir, { recursive: true })
  const stateDirectory = path.join(evidenceDir, 'state')
  const cases = [], responses = [], requests = []
  let activeCase, lab, setupError
  const provider = http.createServer(async (req, res) => {
    let raw = ''
    for await (const part of req) raw += part
    requests.push({ caseID: activeCase, receivedAt: new Date().toISOString(), body: JSON.parse(raw) })
    responses.push(res)
  })
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
  const reportPath = path.join(evidenceDir, 'report.json')
  // The pinned public session PATCH accepts title/time, not permission. This
  // helper preserves historical metadata during an explicit same-ID noReply
  // policy update. It neither wakes the loop nor implements product recovery.
  const policyProbe = path.join(evidenceDir, 'policy-probe.mjs')
  const policyLog = path.join(evidenceDir, 'policy-events.jsonl')
  await writeFile(policyLog, '')
  await writeFile(policyProbe, `import { appendFile } from 'node:fs/promises'\nexport default async ({client,directory}) => ({ async 'chat.message'(input,output) { if(!input.messageID || output.parts.length) return; const prior=await client.session.message({path:{id:input.sessionID,messageID:input.messageID},query:{directory}}); if(prior.error || !prior.data || !prior.data.parts.some(p=>p.text?.startsWith('LIFECYCLE_GUIDANCE_permissions:'))) return; const received=structuredClone(output.message); for(const key of Object.keys(output.message)) delete output.message[key]; Object.assign(output.message,structuredClone(prior.data.info)); await appendFile(${JSON.stringify(policyLog)},JSON.stringify({sessionID:input.sessionID,messageID:input.messageID,before:prior.data.info,received,restored:output.message})+'\\n') } })\n`)
  const config = (autoResume = true, state = stateDirectory) => ({
    plugin: [policyProbe, [installedPluginPath, { stateDirectory: state, autoResume }]],
    provider: { lifecycle: { npm: '@ai-sdk/openai-compatible', name: 'Lifecycle deterministic wire fixture',
      options: { apiKey: 'fixture-not-a-credential', baseURL: `http://127.0.0.1:${provider.address().port}/v1` },
      models: { lifecycle: { name: 'lifecycle', tool_call: true, limit: { context: 32000, output: 1000 } } } } },
    agent: { title: { disable: true }, summary: { disable: true } },
  })
  try {
    lab = await startKernel({ config: config() })
    assert.ok((await lab.request('/experimental/tool/ids')).includes('steering_status'), 'Installed product must really load')
    for (const mode of ['structured', 'permissions', 'cancel', 'provider-error']) await lifecycle(mode)
    await restartCase()
    await lab.stop()
    lab = await startKernel({ config: config(false, path.join(evidenceDir, 'disabled-state')) })
    await lab.request('/experimental/tool/ids')
    await lifecycle('auto-resume-disabled', path.join(evidenceDir, 'disabled-state'))
  } catch (error) { setupError = error.stack }
  finally {
    for (const res of responses) res.destroy()
    provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve))
    if (lab) await lab.stop()
    const report = { kernel: kernelCommit, kernelRoot, installedPluginPath, installedBundleSHA256,
      provider: 'deterministic wire fixture', fixture: lab?.fixture, stateDirectory, cases, requests, setupError,
      passed: !setupError && cases.length === 6 && cases.every(c => c.passed),
      scope: 'Installed-package lifecycle and permission checks; this is not a whole-product or real-model evaluation.',
      limitations: ['No real-model quality claim.', 'Restart coverage is one cancelled session, not arbitrary crash recovery.', 'No atomic cancellation/admission transaction is proven; cancellation concurrent with a recovery dispatch remains a separate boundary.', 'The disabled option intentionally reproduces the saved-guidance completion gap.'] }
    await writeFile(reportPath, JSON.stringify(report, null, 2))
    await writeFile(path.join(evidenceDir, 'compact.json'), JSON.stringify({ ...report, requests: undefined, cases: cases.map(({ originalGuidance, messages, stateFiles, providerRequests, ...item }) => ({ ...item, providerRequestCount: providerRequests?.length })) }, null, 2))
  }
  return { cases, reportPath, setupError }

  async function lifecycle(mode, states = stateDirectory) {
    activeCase = `lifecycle-${mode}`
    const recovering = mode === 'structured' || mode === 'permissions'
    const structured = recovering || mode === 'auto-resume-disabled'
    const item = { id: activeCase, passed: false, claims: recovering ? ['ST-01', 'ST-02', 'ST-04', 'ST-05', ...(mode === 'permissions' ? ['ST-06'] : [])] : ['ST-04', 'ST-05'], assertions: {}, mode }
    cases.push(item)
    const start = requests.length
    try {
      const session = await lab.request('/session', { title: activeCase })
      item.sessionID = session.id
      item.fixture = lab.fixture
      const route = `/session/${session.id}`
      const prompt = text => ({ model: { providerID: 'lifecycle', modelID: 'lifecycle' }, parts: [{ type: 'text', text }] })
      const first = prompt(`LIFECYCLE_INITIAL_${mode}: complete the initial request.`)
      if (structured) first.format = { type: 'json_schema', schema: { type: 'object', properties: { done: { type: 'boolean' } }, required: ['done'], additionalProperties: false } }
      await lab.request(route + '/prompt_async', first)
      await until(() => requests.length === start + 1, 'initial provider request')
      const marker = `LIFECYCLE_GUIDANCE_${mode}: revise the result before finishing.`
      const guidanceInput = { ...prompt(marker), agent: 'build', system: `ORIGINAL_SYSTEM_${mode}`, variant: `original-variant-${mode}`, format: { type: 'text' },
        parts: [{ type: 'text', text: marker }, { type: 'text', text: `Keep second part ${mode} intact.` }], ...(mode === 'permissions' ? { tools: { bash: true } } : {}) }
      await lab.request(route + '/prompt_async', guidanceInput)
      let messages, guidance
      await until(async () => {
        messages = await lab.request(route + '/message')
        guidance = messages.find(m => m.parts.some(p => p.type === 'text' && p.text === marker))
        return messages.filter(m => m.info.role === 'user').length === 2 && guidance
      }, 'guidance persistence')
      item.guidanceMessageID = guidance.info.id
      item.originalGuidance = structuredClone(guidance)
      assert.ok(!JSON.stringify(requests[start].body.messages).includes(marker))
      if (mode === 'permissions') {
        const prior = await lab.request(route)
        assert.deepEqual(guidance.info.tools, { bash: true })
        assert.deepEqual(prior.permission, [{ permission: 'bash', action: 'allow', pattern: '*' }])
        await lab.request(route + '/message', { messageID: guidance.info.id, model: guidance.info.model, agent: guidance.info.agent, noReply: true, parts: [], tools: { bash: false } })
        const narrowed = await lab.request(route)
        assert.deepEqual(narrowed.permission, [{ permission: 'bash', action: 'deny', pattern: '*' }])
        const afterNarrowing = await lab.request(route + '/message')
        assert.equal(afterNarrowing.filter(m => m.info.role === 'user').length, 2, 'Policy change adds no user message')
        assert.deepEqual(afterNarrowing.find(m => m.info.id === guidance.info.id), guidance, 'Policy probe must preserve all original message metadata and parts')
        assert.equal(requests.length, start + 1, 'noReply policy update must not wake a provider')
        item.permissionEvidence = { originalTools: guidance.info.tools, priorPermission: prior.permission, narrowedPermission: narrowed.permission,
          policyUpdate: 'Public same-ID noReply with empty parts changes only current policy; test helper restores original info; this is not product recovery.' }
      }
      if (structured) { assert.ok(requests[start].body.tools.some(t => t.function.name === 'StructuredOutput')); finishStructured(responses[start]) }
      else if (mode === 'cancel') { await lab.request(route + '/abort', {}); responses[start].destroy() }
      else { responses[start].writeHead(400, { 'content-type': 'application/json' }); responses[start].end(JSON.stringify({ error: { message: 'Deliberate non-retryable provider failure', type: 'invalid_request_error' } })) }
      if (recovering) {
        await until(() => requests.length >= start + 2, 'product automatic continuation provider request')
        assert.equal(requests.length, start + 2)
        assert.ok(JSON.stringify(requests[start + 1].body.messages).includes(marker), 'Actual subsequent provider request receives original guidance')
        const during = await lab.request(route + '/message')
        const users = during.filter(m => m.info.role === 'user')
        const controls = users.filter(isControl)
        assert.equal(users.length, 3, 'Exactly two original users and one synthetic control message')
        assert.equal(controls.length, 1)
        assert.equal(users.filter(m => !isControl(m)).length, 2)
        const control = controls[0]
        assert.equal(control.parts.length, 1)
        assert.equal(control.parts[0].synthetic, true)
        assert.equal(control.parts[0].metadata.codeagentSteering.kind, 'continuation')
        assert.match(control.parts[0].metadata.codeagentSteering.recoveryKey, /^[a-f0-9]{64}$/)
        assert.ok(!control.parts[0].text.includes(marker), 'Control must not resubmit guidance content')
        assert.ok(control.parts[0].text.includes(guidance.info.id), 'Control identifies the saved guidance')
        assert.equal(control.info.tools, undefined, 'Recovery must not replay historical tool permission metadata')
        assertOriginalGuidance(during.find(m => m.info.id === guidance.info.id), guidance)
        item.control = { messageID: control.info.id, part: control.parts[0], info: control.info }
        if (mode === 'permissions') {
          item.permissionEvidence.afterRecoveryPermission = (await lab.request(route)).permission
          assert.deepEqual(item.permissionEvidence.afterRecoveryPermission, item.permissionEvidence.narrowedPermission)
          assert.ok(!requests[start + 1].body.tools.some(t => t.function.name === 'bash'), 'Recovered provider must not expose denied bash')
          item.permissionEvidence.deniedToolAbsentFromProvider = true
        }
        finishText(responses[start + 1], `REVISED_${mode}: the saved guidance was received.`)
      }
      await waitIdle(lab, session.id)
      await delay(700)
      item.messages = await lab.request(route + '/message')
      item.providerRequests = requests.slice(start)
      assert.equal(item.providerRequests.length, recovering ? 2 : 1, 'Recovery is bounded; terminal/opt-out cases do not wake')
      assert.equal(item.messages.filter(m => m.info.role === 'user').length, recovering ? 3 : 2)
      assert.equal(item.messages.filter(isControl).length, recovering ? 1 : 0)
      assertOriginalGuidance(item.messages.find(m => m.info.id === guidance.info.id), guidance)
      if (structured) assert.ok(item.messages.some(m => m.info.structured?.done === true))
      if (mode === 'cancel') assert.ok(item.messages.some(m => m.info.error?.name === 'MessageAbortedError'))
      if (mode === 'provider-error') assert.ok(item.messages.some(m => m.info.role === 'assistant' && m.info.error))
      const expectedLifecycle = mode === 'cancel' ? 'cancelled' : mode === 'provider-error' ? 'failed' : 'idle'
      let state
      await until(async () => {
        item.stateFiles = await readStateFiles(states)
        state = item.stateFiles.find(f => f.value.sessionID === session.id)?.value
        return state?.lifecycle === expectedLifecycle && Boolean(state.messages.find(m => m.messageID === guidance.info.id)?.prepared.length) === recovering
      }, 'product final lifecycle and guidance evidence')
      assert.equal(state.evidence, 'available')
      assert.equal(state.messages.length, 2, 'Synthetic controls and empty policy updates must not become new guidance records')
      for (const entry of state.messages) { assert.equal(entry.provider.status, 'unknown'); assert.equal(entry.adopted.status, 'unknown') }
      assert.ok(state.messages.find(m => m.messageID !== guidance.info.id)?.prepared.length, 'Original request has actual prepared evidence')
      const record = state.messages.find(m => m.messageID === guidance.info.id)
      assert.equal(record.saved, 'confirmed')
      assert.equal(record.pendingReason, recovering ? null : mode === 'cancel' ? 'pending-cancelled' : mode === 'provider-error' ? 'pending-failed' : 'pending-ended')
      item.guidanceEvidence = record
      item.recoveryEvidence = state.recovery
      if (recovering) {
        assert.equal(state.recovery.enabled, true)
        assert.equal(state.recovery.attempts.length, 1, 'One bounded product recovery attempt')
        assert.equal(state.recovery.attempts[0].controlMessageID, item.control.messageID)
        assert.equal(state.recovery.attempts[0].status, 'dispatched')
        assert.equal(state.recovery.attempts[0].key, item.control.part.metadata.codeagentSteering.recoveryKey)
      } else {
        assert.deepEqual(record.prepared, [])
        if (mode === 'auto-resume-disabled') assert.equal(state.recovery.enabled, false)
        assert.equal(state.recovery?.attempts.filter(attempt => ['attempted', 'dispatched', 'dispatch-unknown'].includes(attempt.status)).length ?? 0, 0)
      }
      if (mode === 'permissions') {
        item.permissionEvidence.finalPermission = (await lab.request(route)).permission
        assert.deepEqual(item.permissionEvidence.finalPermission, item.permissionEvidence.narrowedPermission)
      }
      item.assertions = { actualInstalledPlugin: true, originalUsers: 2, syntheticControls: recovering ? 1 : 0,
        originalGuidanceMetadataAndPartsPreserved: true, observationAfterIdleMs: 700,
        noExtraLoop: true, providerAndAdoptionRemainUnknown: true,
        ...(recovering ? { automaticContinuation: true, secondProviderRequestContainsGuidance: true, realPreparationEvidence: true } : { noAutomaticWake: true, honestPendingEvidence: true }) }
      if (mode === 'auto-resume-disabled') { item.comparison = true; item.automaticDeliveryExpected = false; item.reason = 'Explicit autoResume:false intentionally preserves the completion gap; this control does not describe the default behavior.' }
      item.passed = true
    } catch (error) {
      item.error = error.stack
      item.providerRequests = requests.slice(start)
      item.stateFiles = await readStateFiles(states)
      if (item.sessionID) { item.messages = await lab.request(`/session/${item.sessionID}/message`).catch(() => []); await lab.request(`/session/${item.sessionID}/abort`, {}).catch(() => {}) }
      for (const res of responses.slice(start)) res.destroy()
    }
  }

  async function restartCase() {
    const item = { id: 'lifecycle-restart', mode: 'after-cancel', passed: false, claims: ['ST-04', 'ST-05'], assertions: {} }
    cases.push(item); activeCase = item.id
    try {
      const cancelled = cases.find(c => c.id === 'lifecycle-cancel')
      const other = cases.find(c => c.id === 'lifecycle-structured')
      assert.ok(cancelled?.passed && other?.passed, 'Restart prerequisites must pass')
      const beforeFiles = await readStateFiles(stateDirectory)
      const priorState = beforeFiles.find(f => f.value.sessionID === cancelled.sessionID).value
      const otherState = beforeFiles.find(f => f.value.sessionID === other.sessionID).value
      const route = `/session/${cancelled.sessionID}`
      const beforeMessages = await lab.request(route + '/message')
      const beforeCount = requests.length
      item.beforeProcess = { pid: lab.pid, fixture: lab.fixture, logFile: lab.logFile }
      await lab.stop()
      lab = await startKernel({ reuseFixture: item.beforeProcess.fixture })
      item.afterProcess = { pid: lab.pid, fixture: lab.fixture, logFile: lab.logFile }
      assert.notEqual(lab.pid, item.beforeProcess.pid)
      assert.equal(lab.fixture, item.beforeProcess.fixture)
      await lab.request('/experimental/tool/ids')
      await delay(700)
      assert.equal(requests.length, beforeCount, 'Restart must not automatically wake old pending guidance')
      assert.deepEqual(await lab.request(route + '/message'), beforeMessages)
      const restartedFiles = await readStateFiles(stateDirectory)
      assert.deepEqual(restartedFiles.find(f => f.value.sessionID === cancelled.sessionID).value, priorState)
      const marker = 'RESTART_EXPLICIT_INPUT: continue now using the saved correction.'
      await lab.request(route + '/prompt_async', { model: { providerID: 'lifecycle', modelID: 'lifecycle' }, parts: [{ type: 'text', text: marker }] })
      await until(() => requests.length === beforeCount + 1, 'explicit request after restart')
      const body = requests[beforeCount].body
      assert.ok(JSON.stringify(body.messages).includes(marker))
      assert.ok(JSON.stringify(body.messages).includes('LIFECYCLE_GUIDANCE_cancel'))
      assert.ok(!JSON.stringify(body.messages).includes('LIFECYCLE_GUIDANCE_structured'))
      finishText(responses[beforeCount], 'Explicit request after restart completed.')
      let finalState
      await until(async () => {
        const files = await readStateFiles(stateDirectory)
        finalState = files.find(f => f.value.sessionID === cancelled.sessionID)?.value
        return finalState?.lifecycle === 'idle' && finalState.messages.length === 3 && finalState.messages.every(m => m.saved === 'confirmed' && m.prepared.length)
      }, 'restored state and new preparation')
      await delay(700)
      assert.equal(requests.length, beforeCount + 1, 'Explicit continuation after restart must not start another recovery loop')
      item.messages = await lab.request(route + '/message')
      item.stateFiles = await readStateFiles(stateDirectory)
      assert.equal(item.messages.filter(m => m.info.role === 'user').length, 3)
      assert.equal(item.messages.filter(isControl).length, 0)
      for (const entry of priorState.messages) {
        const restored = finalState.messages.find(m => m.messageID === entry.messageID)
        assert.equal(restored.fingerprint, entry.fingerprint)
        assert.equal(restored.provider.status, 'unknown'); assert.equal(restored.adopted.status, 'unknown')
      }
      assert.deepEqual(item.stateFiles.find(f => f.value.sessionID === other.sessionID).value, otherState)
      item.assertions = { realProcessRestart: true, sameDatabaseAndLedger: true, noAutomaticWake: true, observationAfterRestartMs: 700,
        explicitInputPrepared: true, priorGuidanceIncluded: true, otherSessionUnchanged: true }
      item.passed = true
    } catch (error) { item.error = error.stack; item.stateFiles = await readStateFiles(stateDirectory) }
  }
}

function isControl(message) {
  return message.info?.role === 'user' && message.parts.some(part => part.type === 'text' && part.synthetic === true && part.metadata?.codeagentSteering?.plugin === '@oneshot/opencode-steering' && part.metadata.codeagentSteering.kind === 'continuation')
}
function assertOriginalGuidance(actual, original) {
  assert.ok(actual, 'Original guidance must remain saved')
  assert.deepEqual(actual.parts, original.parts)
  for (const [key, value] of Object.entries(original.info)) assert.deepEqual(actual.info[key], value, `Original metadata field ${key} changed`)
  assert.ok(Object.keys(actual.info).filter(key => !(key in original.info)).every(key => key === 'summary'), 'Only native summary metadata may be added')
}
async function readStateFiles(directory) {
  const files = []
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(p)
      else if (entry.name.endsWith('.json')) { try { files.push({ path: p, value: JSON.parse(await readFile(p, 'utf8')) }) } catch {} }
    }
  }
  await walk(directory); return files
}
async function until(check, label) {
  const end = Date.now() + 20000
  while (Date.now() < end) { if (await check()) return; await delay(40) }
  throw Error(`Lifecycle timeout: ${label}`)
}
async function waitIdle(lab, sessionID) {
  await until(async () => { const statuses = await lab.request('/session/status'); return !statuses[sessionID] || statuses[sessionID].type === 'idle' }, 'session idle')
}
function finishStructured(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const frame = (delta, finish_reason) => ({ id: 'lifecycle-structured', object: 'chat.completion.chunk', created: 1, model: 'lifecycle', choices: [{ index: 0, delta, finish_reason }] })
  res.write('data: ' + JSON.stringify(frame({ role: 'assistant', tool_calls: [{ index: 0, id: 'structured', type: 'function', function: { name: 'StructuredOutput', arguments: '{"done":true}' } }] }, null)) + '\n\n')
  res.end('data: ' + JSON.stringify(frame({}, 'tool_calls')) + '\n\ndata: [DONE]\n\n')
}
function finishText(res, text) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  res.end('data: ' + JSON.stringify({ id: 'lifecycle-text', object: 'chat.completion.chunk', created: 1, model: 'lifecycle', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n')
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runLifecycleProbe({ installedPluginPath: process.env.STEERING_INSTALLED_PLUGIN, evidenceDir: process.env.STEERING_LIFECYCLE_EVIDENCE })
  console.log(JSON.stringify({ reportPath: result.reportPath, cases: result.cases.map(c => ({ id: c.id, passed: c.passed, error: c.error })), setupError: result.setupError }))
  if (result.setupError || result.cases.some(c => !c.passed)) process.exitCode = 1
}
