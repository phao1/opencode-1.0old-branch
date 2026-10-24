import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import http from 'node:http'
import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { startKernel, root, run } from './lib/kernel-lab.mjs'
import { callRealModel, sendModelResponse } from './lib/model-relay.mjs'
import { runLifecycleProbe } from './probe-steering-lifecycle.mjs'
import { runLateSaveProbe } from './verify-steering-late-save.mjs'
import { runNativeTaskProbe } from './verify-steering-native-task.mjs'

const expectedKernel = '517e6c9aa4c61dbc125e7654fc596f1d529f20d9'
const mode = process.argv.includes('--core-only') ? 'core' : 'full'
const realModel = !process.argv.includes('--deterministic-only')
await mkdir(path.join(root, '.codeagent'), { recursive: true })
const evidence = await mkdtemp(path.join(root, '.codeagent/steering-verification-'))
const reports = [], independentChecks = []
let packageReport, setupError
try {
  const kernelPath = process.env.KERNEL_ROOT ?? path.join(root, 'agent-kernel')
  assert.equal(execFileSync('git', ['-C', kernelPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), expectedKernel)
  if (!process.argv.includes('--use-package-report')) {
    const output = await run(process.execPath, ['scripts/package-steering.mjs'], { timeout: 90000 })
    await writeFile(path.join(evidence, 'package-command.log'), output)
  }
  packageReport = JSON.parse(await readFile(path.join(root, 'dist/steering-package-report.json'), 'utf8'))
  assert.equal(createHash('sha256').update(await readFile(packageReport.artifact)).digest('hex'), packageReport.sha256)
  await access(packageReport.installedPluginPath)
  await writeFile(path.join(evidence, 'package.json'), JSON.stringify(packageReport, null, 2))
  await runCase('baseline-stale-actions', () => raceCase({ gate: false, real: false, completed: true }))
  await runCase('installed-package-gate', () => raceCase({ gate: true, real: false, completed: true }))
  await runCase('checkpoint-already-passed', checkpointCase)
  await runCase('session-isolation', isolationCase)
  if (realModel) {
    await runCase('real-model-gate', () => raceCase({ gate: true, real: true, completed: false }))
    await runCase('real-model-completion-recovery', completionRecoveryCase)
  }
  const lifecycle = await runLifecycleProbe({ installedPluginPath: packageReport.installedPluginPath, evidenceDir: path.join(evidence, 'lifecycle') })
  reports.push(...lifecycle.cases)
  if (lifecycle.setupError) reports.push({ id: 'lifecycle-setup', passed: false, error: lifecycle.setupError })
  const lateSave = await runLateSaveProbe({ installedPluginPath: packageReport.installedPluginPath, evidenceDir: path.join(evidence, 'late-save') })
  reports.push(...lateSave.cases)
  if (lateSave.setupError) reports.push({ id: 'late-save-setup', passed: false, error: lateSave.setupError })
  const native = await runNativeTaskProbe({ installedPluginPath: packageReport.installedPluginPath, evidenceDir: path.join(evidence, 'native-task') })
  reports.push(...native.cases)
  // Execute the independent evidence formerly left as unresolved placeholders.
  for (const [id, args] of [['kernel-boundary', ['scripts/check-kernel.mjs']], ['component-behavior', ['--test', 'test/steering/plugin.test.mjs']]]) {
    try {
      const stdout = await run(process.execPath, args, { timeout: 90000 })
      const log = path.join(evidence, `${id}.log`)
      await writeFile(log, stdout)
      independentChecks.push({ id, passed: true, argv: [process.execPath, ...args], log })
    } catch (error) { independentChecks.push({ id, passed: false, error: error.stack }) }
  }
} catch (error) { setupError = error.stack ?? String(error) }
const coreCases = reports.filter(item => ['baseline-stale-actions', 'installed-package-gate', 'checkpoint-already-passed', 'session-isolation', 'real-model-gate', 'real-model-completion-recovery'].includes(item.id))
const corePassed = !setupError && coreCases.length === (realModel ? 6 : 4) && coreCases.every(item => item.passed)
const unsupported = reports.filter(item => item.unsupported || item.unmet?.length)
const criteriaDefinitions = [
  { id: 'ST-01', evidence: ['installed-package-gate', 'real-model-gate', 'real-model-completion-recovery'], scope: 'Same session and original user inputs; recovery adds one separately identified synthetic control record without rewriting guidance or attachments.' },
  { id: 'ST-02', evidence: ['installed-package-gate', 'real-model-gate', 'real-model-completion-recovery', 'lifecycle-structured', 'completion-late-save'], scope: 'Actual subsequent provider context and model action, including the completion boundary.' },
  { id: 'ST-03', evidence: ['installed-package-gate', 'checkpoint-already-passed', 'native-task-review-command', 'native-task-after-history', 'native-task-pending-input', 'native-task-model-stale'], scope: 'Per-assistant stale calls are blocked; already-started tools are allowed to finish.' },
  { id: 'ST-04', evidence: ['installed-package-gate', 'session-isolation', 'lifecycle-cancel', 'lifecycle-provider-error', 'lifecycle-restart'], externalEvidenceRequired: ['component-behavior'], scope: 'Multiple guidance messages, isolation, cancellation, failure and restart.' },
  { id: 'ST-05', evidence: ['installed-package-gate', 'lifecycle-structured', 'lifecycle-provider-error'], externalEvidenceRequired: ['component-behavior'], scope: 'Persisted saved/prepared facts remain distinct from external provider and adoption observations.' },
  { id: 'ST-06', evidence: ['installed-package-gate', 'lifecycle-permissions'], externalEvidenceRequired: ['kernel-boundary', 'component-behavior'], scope: 'Literal text and retained attachments; separate checks audit permissions and the kernel boundary.' },
  { id: 'ST-07', evidence: ['installed-package-gate'], scope: 'The exact SHA256 artifact is installed offline in an empty directory and its installed entry is loaded by the actual pinned kernel.' },
]
const criteria = criteriaDefinitions.map(criterion => {
  const missingOrFailed = criterion.evidence.filter(id => !reports.some(item => item.id === id && item.passed))
  const unmetCases = reports.filter(item => item.unmet?.includes(criterion.id)).map(item => item.id)
  const externalEvidenceRequired = criterion.externalEvidenceRequired ?? []
  const missingIndependentChecks = externalEvidenceRequired.filter(id => !independentChecks.some(check => check.id === id && check.passed))
  const status = setupError || missingOrFailed.length || unmetCases.length || missingIndependentChecks.length ? 'unmet' : 'passed'
  return { ...criterion, status, missingOrFailed, unmetCases, missingIndependentChecks }
})
const fullAcceptancePassed = !setupError && realModel && reports.every(item => item.passed) && unsupported.length === 0 && criteria.every(criterion => criterion.status === 'passed')
const report = {
  kernel: expectedKernel, package: packageReport, evidence, mode,
  provider: realModel ? 'Real Codex CLI relay plus separately labelled deterministic protocol cases' : 'Deterministic protocol fixtures only; no real-model acceptance',
  corePassed, fullAcceptancePassed, criteria, independentChecks,
  cases: reports, unsupported, ...(setupError ? { setupError } : {}),
  limitations: ['Deterministic fixtures prove scheduling, not model quality.', 'Real model receives only the actual provider messages and tools; no expected decisions or assertions are in its prompt.', 'Bounded synthetic continuation is not atomic expected-turn admission or exactly-once delivery; cancellation and dispatch cannot be made atomic by this plugin.', 'Default full mode exits nonzero while criteria or separately executed component/kernel evidence are unmet. --core-only reports only its explicitly scoped core checks.'],
}
await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
await writeFile(path.join(root, 'dist/steering-verification-report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ evidence, corePassed, fullAcceptancePassed, cases: reports.map(({ id, passed, unsupported, unmet, error }) => ({ id, passed, unsupported, unmet, error })), setupError }, null, 2))
if ((mode === 'full' && !fullAcceptancePassed) || !corePassed || reports.some(item => !item.passed)) process.exitCode = 1

async function runCase(id, test) {
  try { const result = await test(); reports.push({ id, passed: true, ...result }); console.log(`${id}: passed`) }
  catch (error) { reports.push({ id, passed: false, error: error.stack ?? String(error) }); console.log(`${id}: FAILED ${error.message}`) }
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
async function until(check, name, { timeout = 30000, failures } = {}) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (failures?.length) throw failures[0]
    if (await check()) return
    await delay(40)
  }
  throw new Error(`Timed out waiting for ${name}`)
}
async function logEvents(file) {
  const text = await readFile(file, 'utf8').catch(() => '')
  return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}
async function stateFor(directory, sessionID) {
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) { const state = await stateFor(filename, sessionID); if (state) return state }
    else if (entry.name.endsWith('.json')) {
      try { const state = JSON.parse(await readFile(filename, 'utf8')); if (state.sessionID === sessionID) return state } catch {}
    }
  }
}
async function createLab(name, { gate = true, handler, holdAction, structured = false } = {}) {
  const directory = path.join(evidence, name)
  await mkdir(directory, { recursive: true })
  const project = path.join(directory, 'project')
  await mkdir(project)
  const log = path.join(directory, 'tool-events.jsonl')
  const stateDirectory = path.join(directory, 'state')
  const releaseFile = path.join(directory, 'release-tool')
  await writeFile(log, '')
  // A public plugin fixture records real tool execution. It has no steering gate.
  const fixturePlugin = path.join(directory, 'probe.mjs')
  const publicTool = path.join(root, 'node_modules/@opencode-ai/plugin/src/tool.ts')
  await writeFile(fixturePlugin, `import { tool } from ${JSON.stringify(publicTool)}\nimport { appendFile, access } from 'node:fs/promises'\nimport { setTimeout as delay } from 'node:timers/promises'\nexport const ProbePlugin = async () => ({ tool: { probe_step: tool({ description: 'Record the requested action in the task artifact. Perform exactly the requested action.', args: { action: tool.schema.string() }, async execute(args, context) { const event={sessionID:context.sessionID,assistantID:context.messageID,action:args.action}; await appendFile(${JSON.stringify(log)},JSON.stringify({...event,kind:'started'})+'\\n'); if(args.action===${JSON.stringify(holdAction ?? null)}) { const end=Date.now()+30000; while(Date.now()<end) { if(context.abort.aborted) throw new Error('aborted'); if(await access(${JSON.stringify(releaseFile)}).then(()=>true,()=>false)) break; await delay(20); } } await appendFile(${JSON.stringify(log)},JSON.stringify({...event,kind:'completed'})+'\\n'); return 'Recorded action: '+args.action } }) } })\n`)
  const requests = [], failures = []
  const server = http.createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw)
      const number = requests.push(body)
      await writeFile(path.join(directory, `request-${number}.json`), JSON.stringify(body, null, 2))
      await handler({ body, number, res, directory, requests })
    } catch (error) { failures.push(error); if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: error.message })) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let lab
  try {
    lab = await startKernel({ directory: project, config: {
      plugin: [...(gate ? [[packageReport.installedPluginPath, { stateDirectory }]] : []), fixturePlugin],
      provider: { steering: { npm: '@ai-sdk/openai-compatible', name: 'Steering verification provider', options: { apiKey: 'test-placeholder', baseURL: `http://127.0.0.1:${server.address().port}/v1` }, models: { verification: { name: 'verification', tool_call: true, limit: { context: 64000, output: 2000 } } } } },
      default_agent: 'verification', agent: { title: { disable: true }, summary: { disable: true }, verification: { mode: 'primary', permission: { '*': 'deny', probe_step: 'allow', ...(structured ? { StructuredOutput: 'allow' } : {}) } } },
      compaction: { auto: false },
    } })
    const ids = await lab.request('/experimental/tool/ids')
    assert.ok(ids.includes('probe_step'))
    assert.equal(ids.includes('steering_status'), gate, 'Actual installed plugin registration')
    return { lab, directory, project, log, stateDirectory, releaseFile, requests, failures,
      async stop() {
        server.closeAllConnections()
        await new Promise(resolve => server.close(resolve))
        await lab.stop()
        await writeFile(path.join(directory, 'requests.json'), JSON.stringify(requests, null, 2))
        await writeFile(path.join(directory, 'errors.json'), JSON.stringify(failures.map(error => error.stack ?? String(error)), null, 2))
        await writeFile(path.join(directory, 'kernel.json'), JSON.stringify({ fixture: lab.fixture, kernel: expectedKernel, installedPluginPath: gate ? packageReport.installedPluginPath : null, pluginSHA256: packageReport.sha256, url: lab.url }, null, 2))
      },
    }
  } catch (error) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); if (lab) await lab.stop(); throw error }
}
function prompt(text, extras = {}) { return { model: { providerID: 'steering', modelID: 'verification' }, agent: 'verification', parts: [{ type: 'text', text }], ...extras } }
async function session(lab, title, { structured = false } = {}) { return lab.request('/session', { title, permission: [{ permission: '*', pattern: '*', action: 'deny' }, { permission: 'probe_step', pattern: '*', action: 'allow' }, ...(structured ? [{ permission: 'StructuredOutput', pattern: '*', action: 'allow' }] : [])] }) }
async function submit(lab, id, body) { await lab.request(`/session/${id}/prompt_async`, body) }
async function messages(lab, id) { return lab.request(`/session/${id}/message`) }
async function idle(lab, id) { const status = await lab.request('/session/status'); return !status[id] || status[id].type === 'idle' }
function wire(res, { calls, text }, number) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const chunk = delta => ({ id: `fixture-${number}`, object: 'chat.completion.chunk', created: 1, model: 'deterministic-fixture', choices: [{ index: 0, delta, finish_reason: null }] })
  const delta = calls ? { role: 'assistant', tool_calls: calls.map((call, index) => ({ index, id: `fixture_${number}_${index}`, type: 'function', function: { name: 'probe_step', arguments: JSON.stringify({ action: call }) } })) } : { role: 'assistant', content: text }
  res.write(`data: ${JSON.stringify(chunk(delta))}\n\n`)
  const last = chunk({}); last.choices[0].finish_reason = calls ? 'tool_calls' : 'stop'
  res.end(`data: ${JSON.stringify(last)}\n\ndata: [DONE]\n\n`)
}
async function raceCase({ gate, real, completed }) {
  if (real && process.env.STEERING_PROVIDER_COMMAND) throw new Error('Custom provider commands have unverified model provenance and cannot count as real-model acceptance; use CODEX_BINARY for the audited Codex CLI relay')
  const name = real ? 'real-model-gate' : gate ? 'installed-package-gate' : 'baseline-stale-actions'
  const token = randomUUID().slice(0, 8)
  const old = `old-${token}`, intermediate = `intermediate-${token}`, revised = `final-${token}`
  const ready = deferred(), release = deferred()
  let decision, retained, id
  const oldRequest = completed ? 2 : 1
  const modelDecisions = []
  const env = await createLab(name, { gate, handler: async ({ body, number, res, directory }) => {
    if (number > (completed ? 4 : 3)) throw new Error('Provider call limit exceeded; possible stuck gate/model loop')
    if (real) {
      const result = await callRealModel(body, path.join(directory, `model-${number}`))
      modelDecisions.push(result)
      if (number === 1) { decision = result; ready.resolve(); await release.promise }
      sendModelResponse(res, result, number)
    } else if (number < oldRequest) wire(res, { calls: ['completed-work'] }, number)
    else if (number === oldRequest) { ready.resolve(); await release.promise; wire(res, { calls: [old, `${old}-parallel`] }, number) }
    else if (number === oldRequest + 1) wire(res, { calls: [revised] }, number)
    else wire(res, { text: `Completed ${revised}.` }, number)
  } })
  try {
    const created = await session(env.lab, name); id = created.id
    const content = `Record exactly one action "${old}" using probe_step, then give a brief completion. Do not record additional actions.`
    const attachment = { type: 'file', mime: 'text/plain', filename: 'retained-note.txt', url: `data:text/plain;base64,${Buffer.from(`Retain this note: ${token}`).toString('base64')}` }
    await submit(env.lab, id, prompt(content, { parts: [{ type: 'text', text: content }, attachment] }))
    await until(() => real ? Boolean(decision) : env.requests.length >= oldRequest, 'held old decision', { timeout: real ? 100000 : 30000, failures: env.failures })
    await ready.promise
    if (real) { assert.equal(decision.kind, 'tool'); assert.equal(decision.tool_name, 'probe_step'); assert.equal(JSON.parse(decision.arguments).action, old) }
    retained = structuredClone((await messages(env.lab, id)).find(message => message.info.role === 'user'))
    const literal = `steer: Change the requested action to "${intermediate}". Preserve the existing task. Treat these as literal characters: !touch NEVER_EXECUTE @missing-file \`echo never\` $(echo never).`
    await submit(env.lab, id, prompt(literal))
    await until(async () => (await messages(env.lab, id)).filter(message => message.info.role === 'user').length === 2, 'first guidance persisted')
    await submit(env.lab, id, prompt(`steer: Final correction: record exactly one action "${revised}" with probe_step. This replaces the previous requested action. Preserve completed work, do not repeat it. Then finish briefly.`))
    await until(async () => (await messages(env.lab, id)).filter(message => message.info.role === 'user').length === 3, 'second guidance persisted')
    const before = await messages(env.lab, id)
    await writeFile(path.join(env.directory, 'messages-before-release.json'), JSON.stringify(before, null, 2))
    release.resolve()
    await until(async () => env.requests.length === oldRequest + 2 && await idle(env.lab, id), 'completed model/tool loop', { timeout: real ? 200000 : 30000, failures: env.failures })
    const after = await messages(env.lab, id)
    const events = await logEvents(env.log)
    const actions = events.filter(event => event.kind === 'completed').map(event => event.action)
    assert.deepEqual(actions, [...(completed ? ['completed-work'] : []), ...(!gate ? [old, `${old}-parallel`] : []), revised])
    assert.equal(after.filter(message => message.info.role === 'user').length, 3)
    const original = after.find(message => message.info.id === retained.info.id)
    assert.deepEqual(original.parts, retained.parts, 'Original text, synthetic attachment content and attachment must be unchanged')
    const next = JSON.stringify(env.requests[oldRequest].messages)
    assert.ok(next.indexOf(intermediate) >= 0 && next.indexOf(revised) > next.indexOf(intermediate), 'Both corrections must occur in persisted order in the next actual provider request')
    const blocked = after.flatMap(message => message.parts.filter(part => part.type === 'tool' && part.state?.status === 'error' && part.state?.error?.includes('STEERING_STALE_CONTEXT')).map(part => ({ assistantID: message.info.id, callID: part.callID, error: part.state.error })))
    assert.equal(blocked.length, gate ? real ? 1 : 2 : 0)
    let status
    if (gate) {
      await until(async () => { status = await stateFor(env.stateDirectory, id); return status?.messages?.filter(message => message.saved === 'confirmed').length === 3 }, 'saved message evidence')
      for (const message of status.messages) { assert.equal(message.provider.status, 'unknown'); assert.equal(message.adopted.status, 'unknown') }
      for (const item of blocked) assert.ok(status.snapshots.some(snapshot => snapshot.assistantID === item.assistantID), 'Each blocked tool must retain its own assistant snapshot')
      await writeFile(path.join(env.directory, 'status.json'), JSON.stringify(status, null, 2))
    }
    await writeFile(path.join(env.directory, 'messages.json'), JSON.stringify(after, null, 2))
    await writeFile(path.join(env.directory, 'model-decisions.json'), JSON.stringify(modelDecisions, null, 2))
    return { evidence: env.directory, provider: real ? 'real Codex CLI relay' : 'deterministic protocol fixture, not a real LLM', sessionID: id, actions, blocked, providerRequests: env.requests.length, modelDecisions, assertions: { actualInstalledPackage: gate, sameSession: true, exactUserCount: 3, originalAttachmentPreserved: true, completedWorkPreserved: completed ? true : 'covered by deterministic installed-package case', bothGuidanceMessagesInNextProviderRequest: true, actualRevisedAction: true, statusDoesNotInventTransportOrAdoption: gate }, adoptionEvidence: { source: 'verifier observed actual provider/model decision and tool execution', messageIDs: before.filter(message => message.info.role === 'user').slice(1).map(message => message.info.id), target: revised } }
  } finally { release.resolve(); if (id) await writeFile(path.join(env.directory, 'messages-final.json'), JSON.stringify(await messages(env.lab, id).catch(() => []), null, 2)); await env.stop() }
}
async function checkpointCase() {
  const action = 'already-running', revised = 'after-guidance'
  const env = await createLab('checkpoint-already-passed', { holdAction: action, handler: async ({ number, res }) => {
    if (number > 3) throw new Error('Unexpected extra request')
    wire(res, number === 1 ? { calls: [action] } : number === 2 ? { calls: [revised] } : { text: 'Finished.' }, number)
  } })
  let id
  try {
    id = (await session(env.lab, 'checkpoint')).id
    await submit(env.lab, id, prompt(`Record ${action}.`))
    await until(async () => (await logEvents(env.log)).some(event => event.kind === 'started' && event.action === action), 'tool already past gate', { failures: env.failures })
    await submit(env.lab, id, prompt(`steer: Next record ${revised}.`))
    await until(async () => (await messages(env.lab, id)).filter(message => message.info.role === 'user').length === 2, 'guidance saved')
    await writeFile(env.releaseFile, 'release')
    await until(async () => env.requests.length === 3 && await idle(env.lab, id), 'in-flight tool finishes and next request completes', { failures: env.failures })
    const events = await logEvents(env.log)
    assert.deepEqual(events.filter(event => event.kind === 'completed').map(event => event.action), [action, revised])
    assert.ok(JSON.stringify(env.requests[1].messages).includes(`steer: Next record ${revised}`))
    await writeFile(path.join(env.directory, 'messages.json'), JSON.stringify(await messages(env.lab, id), null, 2))
    return { evidence: env.directory, sessionID: id, actions: [action, revised], assertions: { toolAlreadyPastGateMayFinish: true, followingRequestContainsGuidance: true } }
  } finally { await writeFile(env.releaseFile, 'release'); await env.stop() }
}
async function isolationCase() {
  const release = deferred(), counts = { A: 0, B: 0 }
  const env = await createLab('session-isolation', { handler: async ({ body, number, res }) => {
    const which = JSON.stringify(body.messages).includes('ISOLATION_SESSION_B') ? 'B' : 'A'
    const count = ++counts[which]
    if (count > 3) throw new Error('Unexpected extra session request')
    if (which === 'A' && count === 1) { await release.promise; wire(res, { calls: ['A-old'] }, number) }
    else if (which === 'A' && count === 2) wire(res, { calls: ['A-final'] }, number)
    else if (which === 'B' && count === 1) wire(res, { calls: ['B-independent'] }, number)
    else wire(res, { text: `Finished ${which}.` }, number)
  } })
  try {
    const a = await session(env.lab, 'isolation A'), b = await session(env.lab, 'isolation B')
    await submit(env.lab, a.id, prompt('ISOLATION_SESSION_A record A-old.'))
    await until(() => counts.A === 1, 'session A provider paused')
    await submit(env.lab, a.id, prompt('steer: Record A-final instead.'))
    await until(async () => (await messages(env.lab, a.id)).filter(message => message.info.role === 'user').length === 2, 'A guidance saved')
    await submit(env.lab, b.id, prompt('ISOLATION_SESSION_B record B-independent.'))
    await until(async () => counts.B === 2 && await idle(env.lab, b.id), 'independent session completes while A pending', { failures: env.failures })
    assert.deepEqual((await logEvents(env.log)).filter(event => event.kind === 'completed').map(event => event.action), ['B-independent'])
    release.resolve()
    await until(async () => counts.A === 3 && await idle(env.lab, a.id), 'A revised completion', { failures: env.failures })
    const actions = (await logEvents(env.log)).filter(event => event.kind === 'completed').map(event => ({ sessionID: event.sessionID, action: event.action }))
    assert.deepEqual(actions, [{ sessionID: b.id, action: 'B-independent' }, { sessionID: a.id, action: 'A-final' }])
    await writeFile(path.join(env.directory, 'messages.json'), JSON.stringify({ A: await messages(env.lab, a.id), B: await messages(env.lab, b.id) }, null, 2))
    return { evidence: env.directory, sessions: [a.id, b.id], actions, assertions: { otherSessionUnaffected: true, staleActionBlockedOnlyInItsSession: true } }
  } finally { release.resolve(); await env.stop() }
}

async function completionRecoveryCase() {
  if (process.env.STEERING_PROVIDER_COMMAND) throw new Error('Use the audited Codex CLI relay for real-model acceptance')
  const token = randomUUID().slice(0, 8), old = `INITIAL_${token}`, revised = `REVISED_${token}`
  const ready = deferred(), release = deferred(), decisions = []
  const env = await createLab('real-model-completion-recovery', { structured: true, handler: async ({ body, number, res, directory }) => {
    if (number > 2) throw new Error('Unexpected extra request during completion recovery')
    if (number === 1) {
      assert.ok(body.tools.some(tool => tool.function.name === 'StructuredOutput'), 'The requested structured tool must actually be available')
      assert.equal(body.tool_choice, 'required')
    }
    const result = await callRealModel(body, path.join(directory, `model-${number}`))
    decisions.push(result)
    if (number === 1) { ready.resolve(); await release.promise }
    sendModelResponse(res, result, number)
  } })
  let id
  try {
    id = (await session(env.lab, 'Real model at StructuredOutput completion', { structured: true })).id
    const attachment = { type: 'file', mime: 'text/plain', filename: 'recovery-note.txt', url: `data:text/plain;base64,${Buffer.from(`Preserve original note ${token}`).toString('base64')}` }
    const initial = `Return the JSON object {"value":"${old}"} using StructuredOutput. Do not use other tools.`
    await submit(env.lab, id, prompt(initial, {
      format: { type: 'json_schema', schema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } },
      parts: [{ type: 'text', text: initial }, attachment],
    }))
    await until(() => decisions.length === 1, 'real structured decision', { timeout: 100000, failures: env.failures })
    await ready.promise
    assert.equal(decisions[0].kind, 'tool')
    assert.equal(decisions[0].tool_name, 'StructuredOutput')
    assert.equal(JSON.parse(decisions[0].arguments).value, old)
    await submit(env.lab, id, prompt(`steer: Revise the answer. Use plain text now. The final answer should be ${revised}. Do not use any tools.`, { format: { type: 'text' } }))
    await until(async () => (await messages(env.lab, id)).filter(m => m.info.role === 'user').length === 2, 'completion guidance persistence')
    const before = await messages(env.lab, id), originalUsers = before.filter(m => m.info.role === 'user')
    const permission = (await env.lab.request(`/session/${id}`)).permission
    await writeFile(path.join(env.directory, 'messages-before-release.json'), JSON.stringify(before, null, 2))
    release.resolve()
    await until(async () => decisions.length === 2 && await idle(env.lab, id), 'real automatic completion recovery', { timeout: 200000, failures: env.failures })
    await delay(500)
    const after = await messages(env.lab, id), userRows = after.filter(m => m.info.role === 'user')
    const controls = userRows.filter(m => m.parts.length && m.parts.every(p => p.synthetic === true))
    assert.equal(userRows.length, 3, 'Two original inputs plus one disclosed synthetic control record')
    assert.equal(controls.length, 1)
    assert.equal(controls[0].parts[0].metadata?.codeagentSteering?.kind, 'continuation')
    for (const original of originalUsers) {
      const retained = userRows.find(m => m.info.id === original.info.id)
      assert.ok(retained)
      assert.deepEqual(retained.parts, original.parts)
      for (const key of Object.keys(original.info).filter(key => key !== 'summary')) assert.deepEqual(retained.info[key], original.info[key])
    }
    assert.deepEqual((await env.lab.request(`/session/${id}`)).permission, permission)
    assert.ok(JSON.stringify(env.requests[1].messages).includes(revised))
    assert.ok(JSON.stringify(env.requests[1].messages).includes(`Preserve original note ${token}`))
    assert.equal(decisions[1].kind, 'text')
    assert.ok(decisions[1].text.includes(revised))
    assert.equal((await logEvents(env.log)).length, 0, 'No tool side effects or replay')
    assert.equal(env.requests.length, 2, 'Recovery must not loop')
    const state = await stateFor(env.stateDirectory, id), guidance = state.messages.find(m => m.messageID === originalUsers[1].info.id)
    assert.ok(guidance.prepared.length)
    assert.equal(guidance.provider.status, 'unknown')
    assert.equal(guidance.adopted.status, 'unknown')
    await writeFile(path.join(env.directory, 'messages-final.json'), JSON.stringify(after, null, 2))
    await writeFile(path.join(env.directory, 'status.json'), JSON.stringify(state, null, 2))
    return { claims: ['ST-01', 'ST-02', 'ST-05', 'ST-06'], sessionID: id, modelDecisions: decisions,
      assertions: { realModelResponses: 2, originalUserInputs: 2, syntheticControlRecords: 1, preservedOriginalPartsAndMetadata: true, permissionsUnchanged: true, nextRequestContainsGuidanceAndAttachment: true, revisedModelOutput: true, noToolReplay: true, noRecoveryLoop: true }, evidence: env.directory }
  } finally { release.resolve(); if (id) await env.lab.request(`/session/${id}/abort`, {}).catch(() => {}); await env.stop() }
}
