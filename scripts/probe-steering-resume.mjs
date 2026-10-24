// Public-API feasibility probe, not a production steering implementation.
// Reproduce StructuredOutput delivery loss, then wake with the existing user ID.
import http from 'node:http'
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { writeFile, readFile, mkdir, mkdtemp } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { startKernel, root } from './lib/kernel-lab.mjs'

await mkdir(root + '/.codeagent', { recursive: true })
const evidence = await mkdtemp(root + '/.codeagent/steering-resume-')
const requests = [], held = [], stages = []
const preserveMetadata = process.env.PRESERVE_METADATA === '1'
const log = evidence + '/events.jsonl'
await writeFile(log, '')
const plugin = evidence + '/probe.ts'
await writeFile(plugin, `import { appendFileSync } from 'node:fs'
export default async ({client, directory}) => ({
  async 'chat.message'(input, output) {
    if (${preserveMetadata} && input.messageID && output.parts.length === 0) {
      const prior = await client.session.message({path:{id:input.sessionID,messageID:input.messageID},query:{directory}})
      if (prior.error || !prior.data || prior.data.info.role !== 'user') throw Error('Cannot restore wake metadata')
      const received = structuredClone(output.message)
      // The kernel retains the original info object: replacement is insufficient.
      for (const key of Object.keys(output.message)) delete output.message[key]
      Object.assign(output.message, structuredClone(prior.data.info))
      appendFileSync(${JSON.stringify(log)}, JSON.stringify({kind:'metadata-restored', before:prior.data.info, received, restored:output.message})+'\\n')
    }
    appendFileSync(${JSON.stringify(log)}, JSON.stringify({kind:'chat.message', input, message:output.message, parts:output.parts})+'\\n')
  },
  async 'experimental.chat.messages.transform'(_, output) {
    appendFileSync(${JSON.stringify(log)}, JSON.stringify({kind:'snapshot', messages:output.messages})+'\\n')
  },
  async event({event}) {
    if (['session.status','session.idle','session.error'].includes(event.type))
      appendFileSync(${JSON.stringify(log)}, JSON.stringify({kind:'lifecycle-event', event})+'\\n')
  }
})
`)
const provider = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  requests.push(JSON.parse(raw)); held.push(res)
})
await new Promise(r => provider.listen(0, '127.0.0.1', r))
let lab, session, report
try {
  lab = await startKernel({ plugin, config: {
    provider: { probe: { npm: '@ai-sdk/openai-compatible', name: 'Resume protocol fixture',
      options: { apiKey: 'test', baseURL: 'http://127.0.0.1:' + provider.address().port + '/v1' },
      models: { probe: { name: 'probe', tool_call: true, limit: { context: 32000, output: 1000 } } } } },
    agent: { title: { disable: true }, summary: { disable: true } },
  } })
  await lab.request('/experimental/tool/ids')
  session = await lab.request('/session', { title: 'Same message ID resume probe' })
  const route = '/session/' + session.id
  const model = { providerID: 'probe', modelID: 'probe' }
  await lab.request(route + '/prompt_async', { model, parts: [{ type: 'text', text: 'Return structured completion.' }],
    format: { type: 'json_schema', schema: { type: 'object', properties: { done: { type: 'boolean' } }, required: ['done'], additionalProperties: false } } })
  await until(() => requests.length === 1)
  assert.ok(requests[0].tools.some(t => t.function.name === 'StructuredOutput'))
  await lab.request(route + '/prompt_async', { model, agent: 'build', system: 'ORIGINAL_GUIDANCE_SYSTEM',
    variant: 'probe-original-variant', format: { type: 'text' }, tools: { bash: true },
    parts: [{ type: 'text', text: 'RESUME_GUIDANCE: change the result before finishing.' }, { type: 'text', text: 'Keep this second part intact.' }] })
  await until(async () => (await messages()).filter(m => m.info.role === 'user').length === 2)
  finish(0, { role: 'assistant', tool_calls: [{ index: 0, id: 'structured', type: 'function', function: { name: 'StructuredOutput', arguments: '{"done":true}' } }] }, 'tool_calls')
  await idle(); await delay(300)
  const before = await capture('structured-ended-undelivered')
  assert.equal(requests.length, 1)
  const original = before.messages.find(m => m.parts.some(p => p.text?.startsWith('RESUME_GUIDANCE:')))
  assert.ok(original)
  const wake = { messageID: original.info.id, parts: [] }
  // input.tools mutates the current session permission after chat.message. The
  // hook restores historical info.tools, but wake must not replay that policy.
  if (preserveMetadata) for (const key of ['agent','model','system','format','variant']) {
    if (original.info[key] !== undefined) wake[key] = structuredClone(original.info[key])
  }
  assert.equal(Object.hasOwn(wake, 'tools'), false)
  let permissionRegression
  if (preserveMetadata) {
    const beforePolicy = await lab.request(route)
    assert.deepEqual(original.info.tools, { bash: true })
    assert.deepEqual(beforePolicy.permission, [{ permission: 'bash', action: 'allow', pattern: '*' }])
    // Public noReply is used only to change policy in this probe, not to resume.
    // The same-ID hook restores the original info while input.tools narrows the
    // current session's independent permission ruleset after that hook returns.
    await lab.request(route + '/message', { ...wake, noReply: true, tools: { bash: false } })
    const tightened = await lab.request(route)
    assert.deepEqual(tightened.permission, [{ permission: 'bash', action: 'deny', pattern: '*' }])
    const afterPolicy = await capture('permission-tightened-without-waking')
    assert.equal(requests.length, 1)
    assert.equal(afterPolicy.messages.filter(m => m.info.role === 'user').length, 2)
    assert.deepEqual(afterPolicy.messages.find(m => m.info.id === original.info.id), original)
    permissionRegression = { originalMessageTools: original.info.tools, beforePermission: beforePolicy.permission,
      tightenedPermission: tightened.permission, policyChangeMethod: 'public same-ID noReply prompt with tools:false; this step is not a wake',
      wakeOmitsTools: true, metadataAfterTighteningUnchanged: true }
  }
  await lab.request(route + '/prompt_async', wake)
  await until(() => requests.length === 2)
  const afterWake = await capture('same-id-wake-request-held')
  assert.equal(afterWake.messages.filter(m => m.info.role === 'user').length, 2)
  assert.deepEqual(afterWake.messages.find(m => m.info.id === original.info.id).parts, original.parts)
  assert.ok(JSON.stringify(requests[1].messages).includes('RESUME_GUIDANCE:'))
  if (preserveMetadata) {
    permissionRegression.afterWakePermission = (await lab.request(route)).permission
    assert.deepEqual(permissionRegression.afterWakePermission, permissionRegression.tightenedPermission)
    assert.deepEqual(afterWake.messages.find(m => m.info.id === original.info.id).info.tools, { bash: true })
    assert.ok(!requests[1].tools.some(tool => tool.function.name === 'bash'), 'Current deny must remove bash even though historical message tools allowed it')
    permissionRegression.providerExcludedDeniedTool = true
  }
  await lab.request(route + '/prompt_async', wake)
  await until(async () => (await events()).filter(e => e.kind === 'chat.message').length === (preserveMetadata ? 5 : 4))
  await delay(150)
  const activeDuplicate = await capture('duplicate-wake-during-active-request')
  assert.equal(requests.length, 2)
  const normalIdleStart = (await events()).length
  finish(1, { role: 'assistant', content: 'REVISED_RESULT: received RESUME_GUIDANCE and completed the revised request.' }, 'stop')
  await idle(); await delay(150)
  await capture('revised-completed')
  const naturalIdleEvents = (await events()).slice(normalIdleStart).filter(e => e.kind === 'lifecycle-event').map(e => e.event)
  await lab.request(route + '/prompt_async', wake)
  await until(async () => (await events()).filter(e => e.kind === 'chat.message').length === (preserveMetadata ? 6 : 5))
  await idle(); await delay(300)
  const completedDuplicate = await capture('duplicate-wake-after-completion')
  assert.equal(requests.length, 2)
  assert.equal(completedDuplicate.messages.filter(m => m.info.role === 'user').length, 2)
  assert.deepEqual(completedDuplicate.messages.find(m => m.info.id === original.info.id).parts, original.parts)
  const cancelStart = (await events()).length
  const beforeIdleCancel = await messages()
  const idleStatusBefore = await lab.request('/session/status')
  await lab.request(route + '/abort', {})
  await until(async () => (await events()).slice(cancelStart).some(e => e.kind === 'lifecycle-event' && e.event.type === 'session.idle'))
  await delay(150)
  const afterIdleCancel = await capture('cancel-when-already-idle')
  const idleCancelEvents = (await events()).slice(cancelStart).filter(e => e.kind === 'lifecycle-event').map(e => e.event)
  const expectedIdle = [{ type: 'session.status', properties: { sessionID: session.id, status: { type: 'idle' } } }, { type: 'session.idle', properties: { sessionID: session.id } }]
  const naturalIdleNotifications = naturalIdleEvents.filter(event => event.type === 'session.idle' || event.type === 'session.status' && event.properties.status.type === 'idle')
  assert.deepEqual(naturalIdleNotifications, expectedIdle)
  assert.deepEqual(idleCancelEvents, expectedIdle)
  assert.deepEqual(afterIdleCancel.status, idleStatusBefore)
  assert.deepEqual(afterIdleCancel.messages, beforeIdleCancel)
  assert.equal(requests.length, 2)
  const idleCancellation = { naturalIdleEvents, naturalIdleNotifications, idleCancelEvents, samePublicIdlePayloads: true,
    completeLifecycleSequencesEqual: isDeepStrictEqual(naturalIdleEvents, idleCancelEvents),
    statusUnchanged: true, messagesUnchanged: true, providerRequests: requests.length,
    observableCancellationReason: false, conclusion: 'An abort invoked after the session is already idle emits only the same reason-free session.status idle and session.idle payloads as ordinary completion. A normal loop may also emit busy before its idle notifications; neither idle payload identifies cancellation intent.' }
  const rewrites = stages.map(s => ({ stage: s.name, info: s.messages.find(m => m.info.id === original.info.id)?.info }))
  const metadataComparisons = rewrites.map(s => ({stage:s.stage, exactOriginal:isDeepStrictEqual(s.info, original.info),
    changedOriginalKeys:Object.keys(original.info).filter(key => !isDeepStrictEqual(s.info[key], original.info[key])),
    addedKeys:Object.keys(s.info).filter(key => !(key in original.info))}))
  if (preserveMetadata) {
    const restores = (await events()).filter(e => e.kind === 'metadata-restored')
    assert.equal(restores.length, 4)
    for (const e of restores) assert.deepEqual(e.restored, e.before)
    for (const c of metadataComparisons) assert.deepEqual(c.changedOriginalKeys, [])
    permissionRegression.afterDuplicateWakePermission = (await lab.request(route)).permission
    assert.deepEqual(permissionRegression.afterDuplicateWakePermission, permissionRegression.tightenedPermission)
    permissionRegression.passed = true
  }
  report = { outcome: 'observed', kernel: '517e6c9aa4c61dbc125e7654fc596f1d529f20d9', fixture: lab.fixture,
    session: session.id, provider: 'deterministic wire fixture', wakePayload: wake, preserveMetadata,
    conclusion: preserveMetadata ? 'Public message lookup and in-place chat.message restoration preserved every original metadata field and all parts during explicit same-ID resume. Every hook restoration exactly matched the saved message; native summary updates may add metadata during resumed processing. Duplicate wakes in flight and after completion produced no extra provider request in this tested ordering.' : 'Same-ID empty-parts prompt resumed the undelivered guidance without an extra user message or changed parts. Every wake re-entered chat.message and rewrote user metadata. Duplicate wakes in flight and after completion produced no extra provider request in this tested ordering.',
    assertions: { reproducedStructuredGap: true, resumedWithSameID: true, providerReceivedGuidance: true,
      userMessages: 2, providerRequests: requests.length, chatMessageCalls: (await events()).filter(e => e.kind === 'chat.message').length,
      preservedParts: true, duplicateActiveRequestCount: activeDuplicate.providerRequests,
      duplicateCompletedRequestCount: completedDuplicate.providerRequests },
    permissionRegression, idleCancellation, metadataComparisons, rewrites, stages, requests, events: await events(),
    limitations: ['No atomic active-turn check or delivery acknowledgement.', 'Metadata preservation is not automatic; plain wake clears omitted optional metadata and refreshes info.time.created.',
      'Permission regression covers a prior allow and current deny with tools omitted from wake. This is not an atomic permission or cancellation transaction.',
      'Only tested after StructuredOutput idle, these two duplicate timings, and cancel after idle; restart, active cancellation races, failures, concurrent writers, and earlier snapshot/ID race are not covered.',
      'Cancel after idle has no distinct public cancellation reason in the observed status/events; automatic recovery cannot infer intent safely from those events.',
      'No assertion of exactly-once semantics or real-model quality. This uses public prompt upsert, not a dedicated resume endpoint.'] }
} catch (error) {
  report = { outcome: 'failed', error: error.stack, fixture: lab?.fixture, session: session?.id, stages, requests, events: await events() }
  process.exitCode = 1
} finally {
  await writeFile(evidence + '/report.json', JSON.stringify(report, null, 2))
  await writeFile(evidence + '/compact.json', JSON.stringify({ outcome: report.outcome, kernel: report.kernel,
    fixture: report.fixture, session: report.session, preserveMetadata, assertions: report.assertions,
    permissionRegression: report.permissionRegression, idleCancellation: report.idleCancellation,
    metadataComparisons: report.metadataComparisons, limitations: report.limitations, error: report.error }, null, 2))
  for (const res of held) res.destroy()
  provider.closeAllConnections(); await new Promise(r => provider.close(r))
  if (lab) await lab.stop()
  console.log(JSON.stringify({ evidence: evidence + '/report.json', fixture: lab?.fixture, outcome: report.outcome, conclusion: report.conclusion, assertions: report.assertions, error: report.error }))
}
async function events() { return (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse) }
async function messages() { return lab.request('/session/' + session.id + '/message') }
async function capture(name) { const s = { name, providerRequests: requests.length, messages: await messages(), status: await lab.request('/session/status') }; stages.push(s); return s }
async function idle() { await until(async () => { const s = await lab.request('/session/status'); return !s[session.id] || s[session.id].type === 'idle' }) }
async function until(check) { const end = Date.now() + 30000; while (Date.now() < end) { if (await check()) return; await delay(30) } throw Error('Resume probe timed out') }
function finish(index, delta, reason) {
  const res = held[index]
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const frame = (delta, finish_reason) => ({ id: 'resume-' + index, object: 'chat.completion.chunk', created: 1, model: 'probe', choices: [{ index: 0, delta, finish_reason }] })
  res.write('data: ' + JSON.stringify(frame(delta, null)) + '\n\n')
  res.end('data: ' + JSON.stringify(frame({}, reason)) + '\n\ndata: [DONE]\n\n')
}
