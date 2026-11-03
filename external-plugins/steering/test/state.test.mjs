import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SteeringPlugin } from '../src/index.ts'
import { composeSteeringHooks } from '../../src/steering/compose.ts'
import { setTimeout as delay } from 'node:timers/promises'

async function fixture(options = {}, plugin = SteeringPlugin) {
  const sessions = {}, reads = [], controls = [], statuses = {}, details = {}
  let hooks, offline = false
  const client = { tui: { showToast: async () => { throw Error('toast offline') } }, session: {
    messages: async ({ path }) => { reads.push(path.id); if (offline) throw Error('offline'); return { data: structuredClone(sessions[path.id] ?? []) } },
    status: async () => ({ data: statuses }), get: async ({ path }) => ({ data: details[path.id] ?? { id: path.id } }),
    promptAsync: async args => { controls.push(args); return { data: undefined } },
  } }
  hooks = await plugin({ directory: '/fixture', client }, options)
  const event = (type, properties) => hooks.event({ event: { type, properties } })
  const user = (id, text = 'task', extra = [], sessionID = 'one') => ({ info: { id, sessionID, role: 'user', agent: 'build',
    model: { providerID: 'fixture', modelID: 'fixture' }, time: { created: 1 } },
    parts: [{ id: 'p_' + id, type: 'text', text, sessionID, messageID: id }, ...extra.map((p, i) => ({ id: 'extra_' + i, messageID: id, sessionID, ...p }))] })
  const observe = m => hooks['chat.message']({ sessionID: m.info.sessionID }, { message: m.info, parts: m.parts })
  const persist = async m => {
    const list = sessions[m.info.sessionID] ??= []
    const index = list.findIndex(v => v.info.id === m.info.id)
    if (index < 0) list.push(m); else list[index] = m
    await event('message.updated', { info: m.info })
    for (const part of m.parts) await event('message.part.updated', { part })
    return m
  }
  const save = async m => { await observe(m); return persist(m) }
  const assistant = (id, parentID, sessionID = 'one') => {
    const m = { info: { id, parentID, sessionID, role: 'assistant', time: { created: 2 } }, parts: [] }
    ;(sessions[sessionID] ??= []).push(m); return m
  }
  const prepare = async (m, context) => {
    const output = { messages: structuredClone(context ?? sessions[m.info.sessionID].filter(v => v !== m)) }
    await hooks['experimental.chat.messages.transform']({}, output); return output.messages
  }
  const call = async (m, callID, tool = 'bash', notify = true) => {
    const part = { id: 'part_' + callID, callID, type: 'tool', tool, messageID: m.info.id, sessionID: m.info.sessionID }
    m.parts.push(part)
    if (notify) await event('message.part.updated', { part })
    return hooks['tool.execute.before']({ tool, sessionID: m.info.sessionID, callID }, { args: {} })
  }
  const status = async (id = 'one') => JSON.parse(await hooks.tool.steering_status.execute({}, { sessionID: id }))
  return { sessions, reads, controls, client, statuses, details, hooks, event, user, observe, persist, save, assistant, prepare, call, status,
    offline: () => { offline = true } }
}
async function running(options, plugin) {
  const f = await fixture(options, plugin)
  const task = await f.save(f.user('m01'))
  const a = f.assistant('m03', task.info.id)
  await f.prepare(a, [task])
  return { ...f, task, a }
}
async function until(fn) { const end = Date.now() + 2000; while (Date.now() < end) { if (await fn()) return; await delay(10) } assert.fail('timeout') }
async function finish(f) { f.a.info.finish = 'stop'; f.a.info.time.completed = 3; await f.event('session.idle', { sessionID: 'one' }) }

test('all effective parts must save; request reminder leaves original attachments unchanged', async () => {
  const f = await running({ autoResume: false })
  const g = f.user('m02', 'latest', [{ type: 'file', url: 'data:text/plain,hello', mime: 'text/plain' },
    { type: 'text', text: 'generated attachment text', synthetic: true }, { type: 'file', url: 'data:text/plain,two', mime: 'text/plain' }])
  const before = structuredClone(g)
  await f.observe(g); await f.event('message.updated', { info: g.info })
  await f.event('message.part.updated', { part: g.parts[0] })
  assert.equal((await f.status()).messages[1].saved, false)
  await f.persist(g)
  assert.equal((await f.status()).messages[1].saved, true)
  await assert.rejects(f.call(f.a, 'old1'), /STEERING_STALE_CONTEXT/)
  await assert.rejects(f.call(f.a, 'old2'), /STEERING_STALE_CONTEXT/)
  f.a.info.finish = 'tool-calls'; f.a.info.time.completed = 4
  const a2 = f.assistant('m04', g.info.id)
  const copy = await f.prepare(a2)
  assert.ok(JSON.stringify(copy).includes('Latest user guidance takes priority'))
  assert.ok(JSON.stringify(copy).includes('generated attachment text'))
  await f.call(a2, 'new')
  await assert.rejects(f.call(f.a, 'old3'), /STEERING_STALE_CONTEXT/)
  assert.deepEqual(g, before)
})

test('ignored, synthetic and empty input are not guidance', async () => {
  const f = await running()
  for (const [id, parts] of [['m04', [{ type: 'text', text: 'ignored', ignored: true }]], ['m05', [{ type: 'text', text: 'generated', synthetic: true }]], ['m06', [{ type: 'text', text: ' ' }]]]) {
    const m = f.user(id); m.parts = parts; await f.save(m)
  }
  assert.equal((await f.status()).messages.length, 1)
  await f.call(f.a, 'normal')
})

test('one calibration per request; stream deltas and many mapped tools do not scan history', async () => {
  const f = await running({ autoResume: false })
  for (let i = 0; i < 200; i++) await f.event('message.part.delta', { sessionID: 'one', messageID: f.a.info.id, delta: 'x' })
  for (let i = 0; i < 20; i++) await f.call(f.a, 'tool' + i)
  assert.equal(f.reads.length, 1)
  await finish(f); await delay(100); assert.equal(f.controls.length, 0)
})

test('request assistant must be unique; never associate the last historical assistant', async () => {
  const f = await running({ autoResume: false })
  await f.save(f.user('m04', 'new guidance'))
  f.assistant('m05', 'm04'); const a = f.assistant('m06', 'm04')
  await f.prepare(a, f.sessions.one.filter(m => m.info.role === "user"))
  await assert.rejects(f.call(a, 'ambiguous'), /STEERING_STALE_CONTEXT/)
})

test('multi-session observations do not leak', async () => {
  const f = await running({ autoResume: false })
  await f.save(f.user('m04', 'one correction'))
  const u = await f.save(f.user('m10', 'other task', [], 'two'))
  const a = f.assistant('m11', u.info.id, 'two'); await f.prepare(a)
  await f.call(a, 'allowed')
  await assert.rejects(f.call(f.a, 'blocked'), /STEERING_STALE_CONTEXT/)
})

test('native part.id path and unknown task query failure never throw; ordinary task still gates', async () => {
  const f = await running({ autoResume: false })
  await f.save(f.user('m04', 'do not launch task'))
  const part = { type: 'tool', tool: 'task', id: 'native', callID: 'separate', messageID: f.a.info.id, sessionID: 'one' }
  await f.event('message.part.updated', { part })
  await f.hooks['tool.execute.before']({ tool: 'task', sessionID: 'one', callID: 'native' }, { args: {} })
  await assert.rejects(f.call(f.a, 'ordinary', 'task'), /STEERING_STALE_CONTEXT/)
  f.offline()
  await f.hooks['tool.execute.before']({ tool: 'task', sessionID: 'one', callID: 'unknown' }, { args: {} })
  await f.hooks['tool.execute.before']({ tool: 'steering_status', sessionID: 'one', callID: 'status' }, { args: {} })
})

test('stable native ID ordering, edits and partial/whole deletion keep useful guidance', async () => {
  const f = await running({ autoResume: false })
  const b = await f.save(f.user('m05', 'second')), a = await f.save(f.user('m04', 'first', [{ type: 'file', url: 'data:text/plain,note' }]))
  assert.deepEqual((await f.status()).messages.map(g => g.messageID), ['m01', 'm04', 'm05'])
  a.parts[0].text = 'edited'; await f.event('message.part.updated', { part: a.parts[0] })
  assert.equal((await f.status()).messages[1].prepared, false)
  a.parts.splice(1); await f.event('message.part.removed', { sessionID: 'one', messageID: a.info.id, partID: 'extra_0' })
  await assert.rejects(f.call(f.a, 'still stale'), /STEERING_STALE_CONTEXT/)
  f.sessions.one.splice(f.sessions.one.indexOf(b), 1)
  await f.event('message.removed', { sessionID: 'one', messageID: b.info.id })
  f.a.info.finish = 'stop'; f.a.info.time.completed = 4
  const next = f.assistant('m06', a.info.id); await f.prepare(next); await f.call(next, 'after deletion')
})

test('native system reminder normalization does not turn wrapping into an edit', async () => {
  const f = await running({ autoResume: false })
  const g = await f.save(f.user('m04', 'correction'))
  f.a.info.finish = 'stop'; f.a.info.time.completed = 4
  const a = f.assistant('m05', g.info.id)
  const copy = structuredClone(f.sessions.one.filter(v => v !== a))
  copy.find(m => m.info.id === g.info.id).parts[0].text = '<system-reminder>\nThe user sent the following message:\ncorrection\n\nPlease address this message and continue with your tasks.\n</system-reminder>'
  await f.prepare(a, copy); await f.call(a, 'wrapped')
  assert.equal((await f.status()).messages.at(-1).prepared, true)
})

test('late save resumes at most once, preserving model/agent/system/variant/format and omitting tools', async () => {
  const f = await running()
  const g = f.user('m02', 'late original'); Object.assign(g.info, { system: 'custom', variant: 'v', format: { type: 'text' }, tools: { bash: false } })
  await f.save(g); await finish(f)
  await until(() => f.controls.length)
  const body = f.controls[0].body
  for (const key of ['agent', 'model', 'system', 'variant', 'format']) assert.deepEqual(body[key], g.info[key])
  assert.equal(Object.hasOwn(body, 'tools'), false)
  assert.equal(body.parts[0].synthetic, true)
  assert.ok(!body.parts[0].text.includes('late original'))
  const control = f.user('m10'); control.parts = body.parts
  await f.observe(control)
  assert.equal((await f.status()).recovery[0].controlID, 'm10')
  await finish(f); await delay(150); assert.equal(f.controls.length, 1)
  assert.equal((await f.status()).provider, 'unknown'); assert.equal((await f.status()).adopted, 'unknown')
})

for (const type of ['cancel', 'error', 'delete', 'compact', 'revert', 'new input', 'prepared']) test('control permit invalidated before save: ' + type, async () => {
  const f = await running()
  const g = await f.save(f.user('m02', 'late guidance')); await finish(f)
  await until(() => f.controls.length)
  if (type === 'cancel' || type === 'error') await f.event('session.error', { sessionID: 'one', error: { name: type === 'cancel' ? 'MessageAbortedError' : 'APIError' } })
  if (type === 'delete') await f.event('session.deleted', { info: { id: 'one' } })
  if (type === 'compact') await f.hooks['experimental.session.compacting']({ sessionID: 'one' }, { context: [] })
  if (type === 'revert') await f.event('session.updated', { info: { id: 'one', revert: { messageID: 'm01' } } })
  if (type === 'new input') await f.save(f.user('m04', 'new'))
  if (type === 'prepared') { const a = f.assistant('m04', g.info.id); await f.prepare(a) }
  const control = f.user('m10'); control.parts = f.controls[0].body.parts
  await assert.rejects(f.observe(control), /STEERING_RECOVERY_SUPPRESSED/)
})

test('dispatch checks revert via SDK even if event absent; no retries after unknown outcome', async () => {
  const f = await running()
  await f.save(f.user('m02', 'late')); f.details.one = { revert: { messageID: 'm01' } }; await finish(f)
  await delay(150); assert.equal(f.controls.length, 0)
  const g = await running(); await g.save(g.user('m02', 'late'))
  g.client.session.promptAsync = async args => { g.controls.push(args); throw Error('lost response') }
  await finish(g); await until(() => g.controls.length); await finish(g); await delay(150)
  assert.equal(g.controls.length, 1); assert.equal((await g.status()).recovery[0].status, 'dispatch-unknown')
})

test('restart history never becomes eligible, status remains callable offline, compaction transform does not invent preparation', async () => {
  const f = await running()
  await f.save(f.user('m02', 'late'))
  await f.hooks['experimental.session.compacting']({ sessionID: 'one' }, { context: [] })
  await f.prepare(f.a)
  assert.equal((await f.status()).messages[1].prepared, false)
  const restarted = await fixture(); restarted.sessions.one = f.sessions.one
  await restarted.event('session.idle', { sessionID: 'one' }); await delay(100)
  assert.equal(restarted.controls.length, 0)
  restarted.offline(); assert.equal((await restarted.status()).provider, 'unknown')
})

test('composition preserves both tools and event handlers', async () => {
  const calls = []
  const hooks = composeSteeringHooks({ tool: { first: {} }, event: async () => { calls.push(1) } }, { tool: { second: {} }, event: async () => { calls.push(2) } })
  await hooks.event({}); assert.deepEqual(calls, [1, 2]); assert.deepEqual(Object.keys(hooks.tool), ['first', 'second'])
  assert.throws(() => composeSteeringHooks({ tool: { same: {} } }, { tool: { same: {} } }), /Duplicate/)
})

test('SDK calibration cannot confirm a newly observed attachment set while only its text has saved', async () => {
  const f = await running({ autoResume: false })
  const g = f.user('m04', 'text', [{ type: 'file', url: 'data:text/plain,one' }, { type: 'file', url: 'data:text/plain,two' }])
  await f.observe(g)
  const partial = structuredClone(g); partial.parts = partial.parts.slice(0, 1)
  f.sessions.one.push(partial)
  await assert.rejects(f.call(f.a, 'partial-save'), /STEERING_STALE_CONTEXT/)
  assert.equal((await f.status()).messages.at(-1).saved, false)
  await f.persist(g)
  assert.equal((await f.status()).messages.at(-1).saved, true)
})

test('normal tool missing events receives one coalesced fallback, never another assistants snapshot', async () => {
  const f = await running({ autoResume: false })
  await f.call(f.a, 'fallback', 'bash', false)
  assert.equal(f.reads.length, 2)
  await f.save(f.user('m04', 'new'))
  const other = f.assistant('m05', 'm04'); f.a.info.finish = 'stop'; f.a.info.time.completed = 4
  await f.prepare(other)
  await assert.rejects(f.call(f.a, 'old-after-next-request', 'bash', false), /STEERING_STALE_CONTEXT/)
  const count = f.reads.length
  await assert.rejects(f.call(f.a, 'more-missing-events', 'bash', false), /STEERING_STALE_CONTEXT/)
  assert.equal(f.reads.length, count)
})

test('missing candidates remain unknown after 1.5s and still confirm a late save', async () => {
  const f = await running({ autoResume: false })
  const realNow = Date.now, clock = { now: realNow() }
  Date.now = () => clock.now
  try {
    const g = f.user('m04', 'slow save')
    await f.observe(g); clock.now += 2000
    await assert.rejects(f.call(f.a, 'before-save'), /STEERING_STALE_CONTEXT/)
    assert.equal((await f.status()).messages.at(-1).saved, false)
    await f.persist(g)
    await assert.rejects(f.call(f.a, 'after-save'), /STEERING_STALE_CONTEXT/)
    assert.equal((await f.status()).messages.at(-1).saved, true)
  } finally { Date.now = realNow }
})

test('delayed old part events cannot admit a stale assistant after an in-place edit', async () => {
  const f = await running({ autoResume: false })
  const oldPart = structuredClone(f.task.parts[0])
  f.task.parts[0].text = 'edited guidance'
  await f.event('message.part.updated', { part: structuredClone(f.task.parts[0]) })
  await f.event('message.part.updated', { part: oldPart })
  await assert.rejects(f.call(f.a, 'edited despite delayed event'), /STEERING_STALE_CONTEXT/)
  const a = f.assistant('m04', 'm01'); f.a.info.finish = 'stop'; f.a.info.time.completed = 3
  await f.prepare(a); await f.call(a, 'current edit')
})

test('delayed removal events cannot retire guidance still present in native history', async () => {
  const f = await running({ autoResume: false })
  const g = await f.save(f.user('m04', 'retain this', [{ type: 'file', url: 'data:text/plain,attachment' }]))
  await f.event('message.removed', { sessionID: 'one', messageID: g.info.id })
  await assert.rejects(f.call(f.a, 'stale-removal'), /STEERING_STALE_CONTEXT/)
  assert.equal((await f.status()).messages.at(-1).saved, true)
  await f.event('message.part.removed', { sessionID: 'one', messageID: g.info.id, partID: g.parts[0].id })
  await assert.rejects(f.call(f.a, 'stale-part-removal'), /STEERING_STALE_CONTEXT/)
})

test('info-only history retains expected parts; later save blocks the original assistant', async () => {
  const f = await running({ autoResume: false })
  const g = f.user('m04', 'must not disappear', [{ type: 'file', url: 'data:text/plain,full' }])
  await f.observe(g)
  f.sessions.one.push({ info: g.info, parts: [] })
  await f.event('message.updated', { info: g.info })
  await assert.rejects(f.call(f.a, 'info-only'), /STEERING_STALE_CONTEXT/)
  assert.equal((await f.status()).messages.at(-1).saved, false)
  await f.persist(g)
  await assert.rejects(f.call(f.a, 'saved-parts'), /STEERING_STALE_CONTEXT/)
  assert.equal((await f.status()).messages.at(-1).saved, true)
})

test('concurrent bash and ordinary task both wait for shared ownership history', async () => {
  const f = await running({ autoResume: false })
  await f.save(f.user('m04', 'do not launch a child'))
  const original = f.client.session.messages
  let release, queries = 0
  f.client.session.messages = async args => { queries++; await new Promise(resolve => { release = resolve }); return original(args) }
  const bash = f.call(f.a, 'concurrent-bash', 'bash', false)
  await until(() => release)
  let taskSettled = false
  const task = f.call(f.a, 'concurrent-task', 'task', false).finally(() => { taskSettled = true })
  const outcomes = Promise.allSettled([bash, task])
  await delay(10); assert.equal(taskSettled, false)
  release()
  const result = await outcomes
  assert.equal(queries, 1)
  assert.ok(result.every(r => r.status === 'rejected' && /STEERING_STALE_CONTEXT/.test(r.reason.message)))
})

async function summarize(f, context, { success = true, id = "m10" } = {}) {
  await f.hooks['experimental.session.compacting']({ sessionID: 'one' }, { context: [] })
  await f.hooks['experimental.chat.messages.transform']({}, { messages: structuredClone(context) })
  const summary = f.assistant(id, context.at(-1).info.id)
  summary.info.summary = true; summary.info.agent = 'compaction'
  await f.event('message.updated', { info: summary.info })
  summary.info.finish = success ? 'stop' : 'error'; summary.info.time.completed = 10
  if (!success) summary.info.error = { name: 'APIError' }
  await f.event('message.updated', { info: summary.info })
  if (success) await f.event('session.compacted', { sessionID: 'one' })
  return summary
}

test('completed compaction clears only summary marker and admits first ordinary tool', async () => {
  const f = await running({ autoResume: false })
  f.a.info.finish = 'stop'; f.a.info.time.completed = 3
  const summary = await summarize(f, [f.task, f.a])
  const u = await f.save(f.user('m11', 'next task'))
  const a = f.assistant('m12', u.info.id)
  await f.prepare(a, [summary, u]); await f.call(a, 'first-after-summary')
})

test('successful summary retires only included versions without claiming normal preparation', async () => {
  const f = await running({ autoResume: false })
  const g = await f.save(f.user('m04', 'unprepared but summarized'))
  f.a.info.finish = 'stop'; f.a.info.time.completed = 3
  const summary = await summarize(f, [f.task, f.a, g])
  const evidence = (await f.status()).messages.find(v => v.messageID === g.info.id)
  assert.equal(evidence.prepared, false); assert.equal(evidence.compacted, true)
  for (let i = 0; i < 3; i++) {
    const u = await f.save(f.user('m2' + i, 'normal after summary'))
    const a = f.assistant('m3' + i, u.info.id)
    await f.prepare(a, [summary, u]); await f.call(a, 'post-summary-' + i)
    a.info.finish = 'stop'; a.info.time.completed = 20 + i
  }
  await assert.rejects(f.call(f.a, 'old-assistant-after-summary'), /STEERING_STALE_CONTEXT/)
})

test('guidance arriving during summary and failed summaries never inherit retirement', async () => {
  const f = await running({ autoResume: false })
  const g = await f.save(f.user('m04', 'included'))
  await f.hooks['experimental.session.compacting']({ sessionID: 'one' }, { context: [] })
  await f.hooks['experimental.chat.messages.transform']({}, { messages: structuredClone([f.task, f.a, g]) })
  const late = await f.save(f.user('m05', 'arrived after summary input'))
  const summary = f.assistant('m10', 'm04'); Object.assign(summary.info, { summary: true, agent: 'compaction', finish: 'stop', time: { created: 9, completed: 10 } })
  await f.event('message.updated', { info: summary.info }); await f.event('session.compacted', { sessionID: 'one' })
  f.a.info.finish = 'stop'; f.a.info.time.completed = 3
  const u = await f.save(f.user('m11', 'next')), a = f.assistant('m12', 'm11')
  await f.prepare(a, [summary, u])
  await assert.rejects(f.call(a, 'late-not-in-summary'), /STEERING_STALE_CONTEXT/)
  const next = f.assistant('m13', 'm11'); a.info.finish = 'tool-calls'; a.info.time.completed = 12
  await f.prepare(next, [summary, late, u]); await f.call(next, 'late-prepared')
  const failed = await running({ autoResume: false }), pending = await failed.save(failed.user('m04', 'pending'))
  failed.a.info.finish = 'stop'; failed.a.info.time.completed = 3
  await summarize(failed, [failed.task, failed.a, pending], { success: false })
  const task = await failed.save(failed.user('m11', 'next')), assistant = failed.assistant('m12', task.info.id)
  await failed.prepare(assistant, [task])
  await assert.rejects(failed.call(assistant, 'failed-summary'), /STEERING_STALE_CONTEXT/)
  assert.notEqual((await failed.status()).messages.find(v => v.messageID === 'm04').compacted, true)
})

test('more than 300 ordinary completed turns prune settled evidence and keep bounded caches', async () => {
  const f = await fixture({ autoResume: false })
  for (let i = 0; i < 310; i++) {
    const id = String(i).padStart(4, '0'), u = await f.save(f.user('u' + id, 'ordinary task'))
    const a = f.assistant('a' + id, u.info.id)
    await f.prepare(a, [u]); await f.call(a, 'tool-' + i)
    a.info.finish = 'stop'; a.info.time.completed = 3
    await f.event('message.updated', { info: a.info }); await f.event('session.idle', { sessionID: 'one' })
    assert.equal((await f.status()).messages.length, 0)
  }
  assert.equal(f.controls.length, 0)
  const f2 = await fixture({ autoResume: false })
  for (let i = 0; i < 256; i++) await f2.observe(f2.user('unknown' + i, 'unknown save'))
  await assert.rejects(f2.observe(f2.user('overflow')), /STEERING_CAPACITY/)
  assert.equal((await f2.status()).messages.length, 256)
  assert.ok((await f2.status()).diagnostics.some(d => /capacity/i.test(d)))
})

test('standalone and actual aggregate entry both honor autoResume:false without dropping extension tools', async t => {
  const { execFileSync } = await import('node:child_process')
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const { pathToFileURL } = await import('node:url')
  const dir = await mkdtemp(path.join(tmpdir(), 'steering-aggregate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const bundle = path.join(dir, 'index.mjs')
  execFileSync(process.env.BUN_BINARY ?? path.join(process.env.HOME, '.bun/bin/bun'), ['build', 'external-plugins/src/index.ts', '--target=node', '--outfile', bundle], { stdio: 'pipe' })
  const { CodeAgentPlugin } = await import(pathToFileURL(bundle))
  for (const plugin of [SteeringPlugin, CodeAgentPlugin]) {
    for (const disabled of [true, false]) {
      const f = await running({ autoResume: !disabled }, plugin)
      await f.save(f.user('m02', 'late')); await finish(f)
      if (disabled) { await delay(150); assert.equal(f.controls.length, 0) }
      else await until(() => f.controls.length === 1)
      if (plugin === CodeAgentPlugin) for (const key of ['one_shot_status', 'one_shot_start', 'capability_watch', 'steering_status']) assert.ok(f.hooks.tool[key])
    }
  }
})

test('three consecutive summaries transfer current coverage, preserve failures and exclude late edits', async () => {
  const f = await running({ autoResume: false }), g = await f.save(f.user('m04', 'summarized guidance'))
  f.a.info.finish = 'stop'; f.a.info.time.completed = 3
  let summary = await summarize(f, [f.task, f.a, g])
  for (const id of ['m20', 'm30']) {
    summary = await summarize(f, [summary], { id })
    const u = await f.save(f.user(id + 'u', 'continue'))
    const a = f.assistant(id + 'z', u.info.id)
    const request = await f.prepare(a, [summary, u]); await f.call(a, id + '-tool')
    assert.ok(JSON.stringify(request).includes('Latest user guidance takes priority'))
    a.info.finish = 'stop'; a.info.time.completed = 40
  }
  await summarize(f, [summary], { success: false, id: 'm40' })
  const u = await f.save(f.user('m41', 'after failed summary')), a = f.assistant('m42', u.info.id)
  await f.prepare(a, [summary, u]); await f.call(a, 'old-successful-summary')
  const late = await f.save(f.user('m43', 'late guidance not in any summary'))
  const nextSummary = await summarize(f, [summary], { id: 'm50' })
  a.info.finish = 'stop'; a.info.time.completed = 45
  const next = f.assistant('m52', u.info.id)
  await f.prepare(next, [nextSummary, u]); await assert.rejects(f.call(next, 'late-not-inherited'), /STEERING_STALE_CONTEXT/)
  g.parts[0].text = 'edited original guidance'; await f.event('message.part.updated', { part: g.parts[0] })
  await summarize(f, [nextSummary], { id: 'm60' })
  assert.equal((await f.status()).messages.find(v => v.messageID === g.info.id).compacted, false)
  assert.equal((await f.status()).messages.find(v => v.messageID === late.info.id).compacted, false)
})

test('summary request itself carries priority guidance without duplicating original attachments', async () => {
  const f = await running({ autoResume: false }), g = await f.save(f.user('m04', 'latest correction', [{ type: 'file', mime: 'text/plain', url: 'data:text/plain,original' }]))
  await f.hooks['experimental.session.compacting']({ sessionID: 'one' }, { context: [] })
  const output = { messages: structuredClone([f.task, f.a, g]) }
  await f.hooks['experimental.chat.messages.transform']({}, output)
  assert.ok(JSON.stringify(output).includes('Latest user guidance takes priority'))
  assert.equal(output.messages.flatMap(m => m.parts).filter(p => p.type === 'file').length, 1)
  assert.ok(!JSON.stringify(g).includes('Steering reminder'))
})

async function overflowReplayFixture({ media = false } = {}) {
  const f = await running({ autoResume: false })
  const files = [{ type: 'file', mime: 'text/plain', filename: 'note.txt', url: 'data:text/plain,attachment' },
    { type: 'text', text: 'expanded attachment', synthetic: true }]
  if (media) files.push({ type: 'file', mime: 'image/png', filename: 'picture.png', url: 'data:image/png;base64,aA==' })
  const g = await f.save(f.user('m04', 'overflow latest guidance', files))
  const trigger = f.user('m05'); trigger.parts = [{ id: 'compaction', type: 'compaction', auto: true, overflow: true }]
  await f.persist(trigger)
  f.a.info.finish = 'stop'; f.a.info.time.completed = 3
  const summary = await summarize(f, [f.task, f.a])
  const replay = structuredClone(g); replay.info.id = 'm11'; replay.info.time = { created: 11 }
  replay.parts = replay.parts.map((p, i) => ({ ...(media && p.type === 'file' && p.mime === 'image/png' ? { type: 'text', text: '[Attached image/png: picture.png]' } : p), id: 'replayed-' + i, messageID: 'm11' }))
  await f.persist(replay)
  return { ...f, g, trigger, summary, replay }
}

for (const media of [false, true]) test('overflow native replay binds new part IDs only when the request includes exact replay content; media=' + media, async () => {
  const f = await overflowReplayFixture({ media })
  const a = f.assistant('m12', f.replay.info.id)
  const copy = await f.prepare(a, [f.summary, f.replay])
  await f.call(a, 'replay-in-request')
  assert.equal((await f.status()).messages.find(v => v.messageID === f.g.info.id).prepared, true)
  assert.equal((await f.status()).messages.find(v => v.messageID === f.g.info.id).mediaStripped, media)
  assert.ok(JSON.stringify(copy).includes('Latest user guidance takes priority'))
  await assert.rejects(f.call(f.a, 'old-before-replay'), /STEERING_STALE_CONTEXT/)
})

for (const invalid of ['no-overflow', 'missing-attachment', 'different-metadata', 'observed-input', 'missing-request', 'ambiguous']) test('native replay rejects invalid association: ' + invalid, async () => {
  const f = await overflowReplayFixture()
  if (invalid === 'no-overflow') {
    const again = await running({ autoResume: false }), g = await again.save(again.user('m04', 'same text'))
    const summary = await summarize(again, [again.task, again.a])
    const replay = await again.persist(again.user('m11', 'same text'))
    const a = again.assistant('m12', 'm11'); await again.prepare(a, [summary, replay])
    await assert.rejects(again.call(a, 'not-native'), /STEERING_STALE_CONTEXT/); return
  }
  if (invalid === 'missing-attachment') f.replay.parts.splice(1)
  if (invalid === 'different-metadata') f.replay.info.system = 'different system'
  if (invalid === 'observed-input') await f.observe(f.replay)
  const a = f.assistant('m12', f.replay.info.id)
  await f.prepare(a, invalid === 'missing-request' ? [f.summary] : invalid === 'ambiguous' ? [f.summary, f.replay, structuredClone(f.replay)] : [f.summary, f.replay])
  await assert.rejects(f.call(a, 'invalid-replay'), /STEERING_STALE_CONTEXT/)
})

for (const kind of ['whitespace', 'ignored', 'synthetic']) test('saved guidance edited to no effective content stops blocking, then restoration gates old snapshots: ' + kind, async () => {
  const f = await running(), g = await f.save(f.user('m04', 'editable guidance'))
  const old = structuredClone(g.parts[0])
  Object.assign(g.parts[0], kind === 'whitespace' ? { text: '  ' } : { [kind]: true })
  await f.event('message.part.updated', { part: structuredClone(g.parts[0]) })
  await f.call(f.a, 'empty-edit')
  await finish(f); await delay(100); assert.equal(f.controls.length, 0)
  g.parts[0] = old; await f.event('message.part.updated', { part: old })
  await assert.rejects(f.call(f.a, 'restored-guidance'), /STEERING_STALE_CONTEXT/)
})

for (const name of ['MessageAbortedError', 'APIError']) test('more than 128 safely idle terminal sessions release global capacity: ' + name, async () => {
  const f = await fixture({ autoResume: false })
  for (let i = 0; i < 140; i++) {
    const sessionID = 'terminal-' + i, u = await f.save(f.user('u' + i, 'task', [], sessionID))
    const a = f.assistant('a' + i, u.info.id, sessionID); await f.prepare(a, [u])
    await f.event('session.error', { sessionID, error: { name } })
    await f.event('session.idle', { sessionID })
  }
  await f.save(f.user('new-session', 'allowed', [], 'new'))
  assert.equal(f.controls.length, 0)
})

test('terminated sessions with running parts or no idle boundary remain protected from eviction', async () => {
  const f = await fixture({ autoResume: false })
  for (let i = 0; i < 128; i++) {
    const sessionID = 'active-' + i
    await f.save(f.user('u' + i, 'pending work', [], sessionID))
    await f.event('session.status', { sessionID, status: { type: 'busy' } })
    await f.event('message.part.updated', { part: { type: 'tool', id: 'running', messageID: 'a', sessionID, callID: 'running', state: { status: 'running' } } })
    await f.event('session.error', { sessionID, error: { name: 'MessageAbortedError' } })
    if (i % 2 === 0) await f.event('session.idle', { sessionID })
  }
  await assert.rejects(f.save(f.user('overflow', 'must not evict running work', [], 'overflow')), /STEERING_CAPACITY/)
})

for (const second of ['failed', 'omits-first-summary']) test('second compaction cannot replace first covering summary without valid inherited coverage: ' + second, async () => {
  const f = await running({ autoResume: false }), g = await f.save(f.user('m04', 'first summary owns this guidance'))
  f.a.info.finish = 'stop'; f.a.info.time.completed = 3
  const first = await summarize(f, [f.task, f.a, g])
  const next = await summarize(f, second === 'failed' ? [first] : [f.task], { success: second !== 'failed', id: 'm20' })
  const u = await f.save(f.user('m21', 'normal request')), a = f.assistant('m22', u.info.id)
  await f.prepare(a, [next, u]); await assert.rejects(f.call(a, 'no-invalid-inheritance'), /STEERING_STALE_CONTEXT/)
  a.info.finish = 'stop'; a.info.time.completed = 22
  const valid = f.assistant('m23', u.info.id)
  await f.prepare(valid, [first, u]); await f.call(valid, 'first-summary-still-valid')
})
