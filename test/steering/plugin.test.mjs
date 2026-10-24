import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SteeringPlugin } from '../../external-plugins/src/steering.ts'
import { composeSteeringHooks } from '../../external-plugins/src/steering/compose.ts'

async function fixture(t, existing = {}, options = {}) {
  const stateDirectory = options.stateDirectory ?? await mkdtemp(path.join(tmpdir(), 'steering-unit-'))
  if (!options.stateDirectory) t.after(() => rm(stateDirectory, { recursive: true, force: true }))
  const sessions = structuredClone(existing)
  const calls = []
  const state = { fail: false, statuses: {}, sessions, calls, stateDirectory }
  const input = { directory: '/project', project: { id: 'project' }, client: { session: {
    messages: async args => { calls.push(args); if (state.fail) throw new Error('offline'); return { data: structuredClone(sessions[args.path.id] ?? []) } },
    status: async () => ({ data: state.statuses }),
    abort: () => assert.fail('must not abort'), prompt: () => assert.fail('must not resubmit'),
  } } }
  const hooks = await SteeringPlugin(input, { stateDirectory, autoResume: options.autoResume ?? false })
  const user = (id, text = 'task', sessionID = 'one', extra = []) => ({
    info: { id, sessionID, role: 'user', time: { created: Number(id.replace(/\D/g, '')) || 1 }, agent: 'build', model: { providerID: 'test', modelID: 'test' } },
    parts: [{ id: `prt_${id}`, sessionID, messageID: id, type: 'text', text }, ...extra],
  })
  const save = async message => {
    const sessionID = message.info.sessionID
    await hooks['chat.message']({ sessionID }, { message: message.info, parts: message.parts })
    const list = sessions[sessionID] ??= []
    const index = list.findIndex(item => item.info.id === message.info.id)
    if (index < 0) list.push(message); else list[index] = message
    return message
  }
  const assistant = (id, parentID, sessionID = 'one', extra = {}) => {
    const message = { info: { id, sessionID, role: 'assistant', parentID, time: { created: Number(id.replace(/\D/g, '')) || 2 }, ...extra }, parts: [] }
    ;(sessions[sessionID] ??= []).push(message)
    return message
  }
  const prepare = async (a, context) => {
    const output = { messages: structuredClone(context ?? sessions[a.info.sessionID].filter(item => item !== a)) }
    await hooks['experimental.chat.messages.transform']({}, output)
    return output.messages
  }
  const call = async (a, callID = 'call', name = 'write') => {
    a.parts.push({ type: 'tool', id: `part_${callID}`, messageID: a.info.id, sessionID: a.info.sessionID, callID, tool: name, state: { status: 'pending' } })
    return hooks['tool.execute.before']({ tool: name, sessionID: a.info.sessionID, callID }, { args: {} })
  }
  const status = async (sessionID = 'one', messageID) => JSON.parse(await hooks.tool.steering_status.execute({ messageID }, { sessionID }))
  return { ...state, state, input, hooks, user, save, assistant, prepare, call, status }
}

async function nativeSubtask(f, extra = []) {
  const source = f.user('m10', '')
  const subtask = { id: 'subtask', type: 'subtask', sessionID: 'one', messageID: 'm10', prompt: 'Review the saved change', description: 'Review', agent: 'general', command: 'review' }
  source.parts = [subtask, ...extra]
  await f.save(source)
  const owner = f.assistant('m11', source.info.id, 'one', { agent: subtask.agent, mode: subtask.agent })
  const part = { id: 'native-part', type: 'tool', sessionID: 'one', messageID: owner.info.id, tool: 'task', callID: 'native-separate-call', state: { status: 'running', input: {
    prompt: subtask.prompt, description: subtask.description, subagent_type: subtask.agent, command: subtask.command,
  } } }
  owner.parts.push(part)
  const call = () => f.hooks['tool.execute.before']({ tool: 'task', sessionID: 'one', callID: part.id }, { args: part.state.input })
  return { source, subtask, owner, part, call }
}

test('literal inputs, metadata and attachments stay intact; observed is not saved', async t => {
  const f = await fixture(t)
  const attachment = { id: 'file', type: 'file', mime: 'text/plain', url: 'data:text/plain;base64,YQ==' }
  const message = f.user('m01', 'steer: !cmd @file `shell` $(echo private)', 'one', [attachment])
  message.info.system = 'original user system'; message.info.variant = 'x'; message.info.format = { type: 'text' }
  const before = structuredClone(message)
  await f.hooks['chat.message']({ sessionID: 'one' }, { message: message.info, parts: message.parts })
  assert.deepEqual(message, before)
  const observed = (await f.status()).messages[0]
  assert.equal(observed.saved, 'unknown'); assert.equal(observed.prepared.length, 0)
  f.sessions.one = [message]
  const saved = (await f.status()).messages[0]
  assert.equal(saved.saved, 'confirmed'); assert.equal(saved.provider.status, 'unknown'); assert.equal(saved.adopted.status, 'unknown')
  assert.equal(f.calls[0].query.directory, '/project'); assert.ok(f.calls[0].signal instanceof AbortSignal)
})

test('empty explicit guidance fails; attachment-only valid; ignored and synthetic text do not create pending', async t => {
  const f = await fixture(t)
  await assert.rejects(f.save(f.user('m01', 'steer: \n\t')), /Usage/)
  for (const [index, extra] of [{ ignored: true }, { synthetic: true }, {}].entries()) {
    const message = f.user(`m0${index + 2}`, index === 2 ? ' \t' : 'steer: internal')
    Object.assign(message.parts[0], extra)
    await f.save(message)
  }
  const file = f.user('m09', 'steer: ', 'one', [{ id: 'file', type: 'file', url: 'data:text/plain;base64,YQ==', mime: 'text/plain' }])
  await f.save(file)
  assert.deepEqual((await f.status()).messages.map(item => item.messageID), ['m09'])
})

test('same ID observation is idempotent; equal text under different IDs remains distinct', async t => {
  const f = await fixture(t)
  const one = await f.save(f.user('m01', 'same'))
  await f.save(one)
  await f.save(f.user('m02', 'same'))
  await f.hooks.event({ event: { type: 'message.updated', properties: { info: one.info } } })
  assert.deepEqual((await f.status()).messages.map(item => item.messageID), ['m01', 'm02'])
})

test('per-assistant snapshots block every stale call even after newer assistant prepares guidance', async t => {
  const f = await fixture(t)
  const one = await f.save(f.user('m01'))
  const old = f.assistant('m02', one.info.id)
  await f.prepare(old)
  await f.call(old, 'already-passed')
  const guidance = await f.save(f.user('m03', 'steer: revised'))
  await assert.rejects(f.call(old, 'old1'), /STEERING_STALE_CONTEXT.*m03/)
  old.info.finish = 'tool-calls'; old.info.time.completed = 4
  const current = f.assistant('m04', guidance.info.id)
  await f.prepare(current)
  await f.call(current, 'revised')
  await assert.rejects(f.call(old, 'old2'), /STEERING_STALE_CONTEXT/)
  const status = await f.status()
  assert.equal(status.snapshots.length, 2)
  assert.equal(status.messages[1].prepared[0].assistantID, 'm04')
})

test('parallel calls and sessions are isolated', async t => {
  const f = await fixture(t)
  const one = await f.save(f.user('m01', 'one'))
  const two = await f.save(f.user('m01', 'two', 'two'))
  const a = f.assistant('m02', one.info.id), b = f.assistant('m02', two.info.id, 'two')
  await f.prepare(a); await f.prepare(b)
  await f.save(f.user('m03', 'change one'))
  const results = await Promise.allSettled([f.call(a, 'a1'), f.call(a, 'a2'), f.call(b, 'b1')])
  assert.deepEqual(results.map(result => result.status), ['rejected', 'rejected', 'fulfilled'])
})

test('kernel reminder has distinct source and actual context fingerprints', async t => {
  const f = await fixture(t)
  const one = await f.save(f.user('m01', 'steer: revised'))
  const a = f.assistant('m02', 'm01')
  const context = structuredClone(one)
  context.parts[0].text = '<system-reminder>\nThe user sent the following message:\n' + one.parts[0].text + '\n\nPlease address this message and continue with your tasks.\n</system-reminder>'
  await f.prepare(a, [context]); await f.call(a)
  const prepared = (await f.status()).messages[0].prepared[0]
  assert.notEqual(prepared.sourceFingerprint, prepared.contextFingerprint)
  assert.equal(one.parts[0].text, 'steer: revised')
})

test('a user-authored literal reminder envelope is preserved and does not become a false mismatch', async t => {
  const f = await fixture(t)
  const literal = '<system-reminder>\nThe user sent the following message:\nThis is literal user content\n\nPlease address this message and continue with your tasks.\n</system-reminder>'
  const one = await f.save(f.user('m01', literal))
  const a = f.assistant('m02', 'm01')
  await f.prepare(a, [one]); await f.call(a)
  const status = await f.status()
  assert.equal(status.messages[0].prepared.length, 1)
  assert.equal(status.messages[0].prepared[0].sourceFingerprint, status.messages[0].prepared[0].contextFingerprint)
  assert.equal(one.parts[0].text, literal)
})

test('unknown association and unavailable SDK fail closed; diagnostic status remains callable', async t => {
  const f = await fixture(t)
  await f.save(f.user('m01'))
  const a = f.assistant('m02', 'm01')
  await assert.rejects(f.call(a, 'no-snapshot'), /STEERING_EVIDENCE_UNAVAILABLE/)
  await f.prepare(a)
  f.state.fail = true
  await assert.rejects(f.call(a, 'offline'), /STEERING_EVIDENCE_UNAVAILABLE/)
  assert.equal((await f.status()).evidence, 'unavailable')
  await f.hooks['tool.execute.before']({ tool: 'steering_status', sessionID: 'one', callID: 'status' }, { args: {} })
})

test('native SubtaskPart dispatch passes its own checkpoint without inventing a normal snapshot', async t => {
  const f = await fixture(t)
  const native = await nativeSubtask(f)
  const before = structuredClone(f.sessions.one)
  await native.call()
  assert.deepEqual(f.sessions.one, before)
  const status = await f.status()
  assert.deepEqual(status.messages, [])
  assert.deepEqual(status.snapshots, [])
  const checkpoint = status.diagnostics.find(item => item.code === 'native-subtask-checkpoint-passed')
  assert.equal(checkpoint.assistantID, native.owner.info.id)
  assert.equal(checkpoint.callID, native.part.id)
  assert.equal(status.diagnostics.some(item => item.code === 'tool-checkpoint-passed'), false)
})

test('native subtask accepts normal-prepared or completed-history input without changing its evidence', async t => {
  for (const mode of ['prepared', 'baseline']) {
    const f = await fixture(t)
    const history = f.user('m01', 'earlier task')
    if (mode === 'prepared') await f.save(history)
    else f.sessions.one = [history]
    const old = f.assistant('m02', history.info.id)
    if (mode === 'prepared') await f.prepare(old)
    old.info.time.completed = 3; old.info.finish = 'stop'
    const native = await nativeSubtask(f)
    await native.call()
    const status = await f.status(), entry = status.messages[0]
    assert.equal(entry.saved, 'confirmed')
    assert.equal(entry.historicalBaseline, mode === 'baseline')
    assert.equal(entry.prepared.length, mode === 'prepared' ? 1 : 0)
    assert.equal(status.snapshots.length, mode === 'prepared' ? 1 : 0)
    assert.equal(entry.provider.status, 'unknown'); assert.equal(entry.adopted.status, 'unknown')
  }
})

test('native subtask blocks mixed pending text or files and guidance saved before its checkpoint', async t => {
  for (const pending of ['text', 'file', 'late']) {
    const f = await fixture(t)
    const extra = pending === 'text' ? [{ id: 'text', type: 'text', text: 'steer: read this first' }]
      : pending === 'file' ? [{ id: 'file', type: 'file', url: 'data:text/plain;base64,YQ==', mime: 'text/plain' }] : []
    const native = await nativeSubtask(f, extra)
    if (pending === 'late') await f.save(f.user('m12', 'steer: read this first'))
    await assert.rejects(native.call(), /STEERING_STALE_CONTEXT/)
    const status = await f.status()
    assert.equal(status.messages[0].saved, 'confirmed')
    assert.deepEqual(status.messages[0].prepared, [])
    assert.deepEqual(status.snapshots, [])
    assert.equal(status.diagnostics.some(item => item.code === 'native-subtask-checkpoint-passed'), false)
    assert.equal(native.part.state.status, 'running')
  }
})

test('native subtask rejects unknown saves, changed history and unavailable evidence', async t => {
  for (const failure of ['unsaved', 'partial', 'changed', 'read', 'write']) {
    const f = await fixture(t)
    if (failure === 'changed') {
      const history = await f.save(f.user('m01', 'original'))
      const old = f.assistant('m02', history.info.id); await f.prepare(old)
      old.info.time.completed = 3; old.info.finish = 'stop'
      history.parts[0].text = 'changed after normal preparation'
    }
    const native = await nativeSubtask(f)
    if (failure === 'unsaved' || failure === 'partial') {
      const incoming = f.user('m12', 'guidance', 'one', [{ id: 'file', type: 'file', url: 'data:text/plain;base64,YQ==' }])
      await f.hooks['chat.message']({ sessionID: 'one' }, { message: incoming.info, parts: incoming.parts })
      if (failure === 'partial') f.sessions.one.push({ info: incoming.info, parts: [incoming.parts[0]] })
    }
    if (failure === 'read') f.state.fail = true
    if (failure === 'write') {
      const status = await f.status()
      await rm(path.dirname(status.stateFile), { recursive: true, force: true })
      await writeFile(path.dirname(status.stateFile), 'blocked')
    }
    await assert.rejects(native.call(), /STEERING_EVIDENCE_UNAVAILABLE/)
  }
})

test('native subtask recognition requires a unique matching saved source and native tool shape', async t => {
  for (const mismatch of ['parent', 'agent', 'prompt', 'description', 'subagent', 'command', 'extra-input', 'status', 'part-session', 'part-message', 'source-session', 'source-message', 'duplicate-source', 'duplicate-owner', 'same-call-id']) {
    const f = await fixture(t)
    const native = await nativeSubtask(f)
    if (mismatch === 'parent') native.owner.info.parentID = 'missing'
    if (mismatch === 'agent') native.owner.info.agent = 'other'
    if (mismatch === 'prompt') native.part.state.input.prompt = 'other'
    if (mismatch === 'description') native.part.state.input.description = 'other'
    if (mismatch === 'subagent') native.part.state.input.subagent_type = 'other'
    if (mismatch === 'command') native.part.state.input.command = 'other'
    if (mismatch === 'extra-input') native.part.state.input.unexpected = true
    if (mismatch === 'status') native.part.state.status = 'pending'
    if (mismatch === 'part-session') native.part.sessionID = 'other'
    if (mismatch === 'part-message') native.part.messageID = 'other'
    if (mismatch === 'source-session') native.subtask.sessionID = 'other'
    if (mismatch === 'source-message') native.subtask.messageID = 'other'
    if (mismatch === 'duplicate-source') native.source.parts.push(structuredClone(native.subtask))
    if (mismatch === 'duplicate-owner') {
      const duplicate = structuredClone(native.owner); duplicate.info.id = 'm12'; duplicate.parts[0].messageID = 'm12'; f.sessions.one.push(duplicate)
    }
    if (mismatch === 'same-call-id') native.part.callID = native.part.id
    await assert.rejects(native.call(), /STEERING_EVIDENCE_UNAVAILABLE/, mismatch)
    assert.equal((await f.status()).diagnostics.some(item => item.code === 'native-subtask-checkpoint-passed'), false)
  }
})

test('ordinary model task calls still require their own normal snapshot and block stale guidance', async t => {
  const f = await fixture(t)
  await f.save(f.user('m01', 'task'))
  const old = f.assistant('m02', 'm01')
  await assert.rejects(f.call(old, 'ordinary-no-snapshot', 'task'), /STEERING_EVIDENCE_UNAVAILABLE/)
  await f.prepare(old)
  await f.call(old, 'ordinary-prepared', 'task')
  const guidance = await f.save(f.user('m03', 'steer: revised'))
  old.info.finish = 'tool-calls'; old.info.time.completed = 4
  const current = f.assistant('m04', guidance.info.id); await f.prepare(current)
  await f.call(current, 'ordinary-current', 'task')
  await assert.rejects(f.call(old, 'ordinary-stale', 'task'), /STEERING_STALE_CONTEXT/)
  assert.equal((await f.status()).diagnostics.some(item => item.code === 'native-subtask-checkpoint-passed'), false)
})

test('query error response is checked and ambiguous assistants never acquire snapshots', async t => {
  const f = await fixture(t)
  await f.save(f.user('m01'))
  const a = f.assistant('m02', 'm01'); f.assistant('m03', 'm01')
  await f.prepare(a, [f.sessions.one[0]])
  await assert.rejects(f.call(a), /STEERING_EVIDENCE_UNAVAILABLE/)
  f.input.client.session.messages = async () => ({ error: { message: 'bad' }, data: [] })
  assert.equal((await f.status()).evidence, 'unavailable')
})

test('partial saved parts stay unknown until complete; changed source cannot pass gate', async t => {
  const f = await fixture(t)
  const message = f.user('m01', 'task', 'one', [{ id: 'file', type: 'file', url: 'data:text/plain;base64,YQ==' }])
  await f.hooks['chat.message']({ sessionID: 'one' }, { message: message.info, parts: message.parts })
  f.sessions.one = [{ info: message.info, parts: [message.parts[0]] }]
  assert.equal((await f.status()).messages[0].saved, 'unknown')
  f.sessions.one[0] = message
  const a = f.assistant('m02', 'm01'); await f.prepare(a)
  message.parts[0].text = 'changed after snapshot'
  await assert.rejects(f.call(a), /STEERING_EVIDENCE_UNAVAILABLE/)
})

test('compaction preparation does not clear pending; normal context restores known omitted guidance once', async t => {
  const f = await fixture(t)
  const old = await f.save(f.user('m01', 'old task'))
  const a = f.assistant('m02', 'm01'); await f.prepare(a); a.info.time.completed = 2; a.info.finish = 'tool-calls'
  const guidance = await f.save(f.user('m03', 'steer: fix after compaction'))
  await f.hooks['experimental.session.compacting']({ sessionID: 'one' }, { context: [] })
  await f.hooks['experimental.chat.messages.transform']({}, { messages: [structuredClone(old)] })
  assert.equal((await f.status()).messages[1].prepared.length, 0)
  const current = f.assistant('m04', 'm01')
  const context = await f.prepare(current, [old])
  assert.equal(context.filter(item => item.info.id === guidance.info.id).length, 1)
  await f.call(current)
  assert.equal(f.sessions.one.filter(item => item.info.role === 'user').length, 2)
})

test('first attachment after compaction baselines completed history honestly and preserves late guidance', async t => {
  const f = await fixture(t)
  const old = f.user('m01', 'history'), late = f.user('m02', 'late guidance')
  const completed = { info: { id: 'm03', sessionID: 'one', role: 'assistant', parentID: 'm01', time: { created: 3, completed: 4 }, finish: 'stop' }, parts: [] }
  f.sessions.one = [old, late, completed]
  const status = await f.status()
  assert.equal(status.messages[0].historicalBaseline, true)
  assert.equal(status.messages[0].pendingReason, 'historical-coverage-unknown')
  assert.equal(status.messages[0].prepared.length, 0)
  assert.equal(status.messages[1].historicalBaseline, false)
  assert.equal(status.messages[1].pendingReason, 'pending-ended')
})

test('possible compaction replay is not duplicated and remains explicitly pending', async t => {
  const f = await fixture(t)
  await f.save(f.user('m01', 'guidance'))
  const replay = f.user('m02', 'guidance')
  f.sessions.one.push(replay)
  const a = f.assistant('m03', 'm02')
  const context = await f.prepare(a, [replay])
  assert.equal(context.length, 1)
  await assert.rejects(f.call(a), /STEERING_STALE_CONTEXT/)
})

test('restart preserves independent snapshots and pending without submitting or adopting', async t => {
  const f = await fixture(t)
  const old = await f.save(f.user('m01'))
  const a = f.assistant('m02', old.info.id); await f.prepare(a)
  await f.save(f.user('m03', 'pending'))
  await f.status()
  const restarted = await fixture(t, f.sessions, { stateDirectory: f.stateDirectory })
  const status = await restarted.status()
  assert.equal(status.messages[1].saved, 'confirmed'); assert.equal(status.messages[1].prepared.length, 0)
  await assert.rejects(restarted.call(restarted.sessions.one[1], 'after-restart'), /STEERING_STALE_CONTEXT/)
  assert.equal(status.messages[0].provider.status, 'unknown')
})

test('idle, cancel and failed boundaries preserve pending without waking', async t => {
  for (const [event, expected] of [
    [{ type: 'session.idle', properties: { sessionID: 'one' } }, 'pending-ended'],
    [{ type: 'session.error', properties: { sessionID: 'one', error: { name: 'MessageAbortedError' } } }, 'pending-cancelled'],
    [{ type: 'session.error', properties: { sessionID: 'one', error: { name: 'APIError' } } }, 'pending-failed'],
  ]) {
    const f = await fixture(t)
    await f.save(f.user('m01', 'pending'))
    await f.hooks.event({ event })
    await f.hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'one' } } })
    const status = await f.status()
    assert.equal(status.messages[0].pendingReason, expected)
    assert.equal(status.messages[0].provider.status, 'unknown'); assert.equal(status.messages[0].adopted.status, 'unknown')
  }
})

test('restart retains cancellation and failure reasons without resuming work', async t => {
  for (const [name, pendingReason] of [['MessageAbortedError', 'pending-cancelled'], ['APIError', 'pending-failed']]) {
    const f = await fixture(t)
    await f.save(f.user('m01', 'pending'))
    await f.hooks.event({ event: { type: 'session.error', properties: { sessionID: 'one', error: { name } } } })
    const restarted = await fixture(t, f.sessions, { stateDirectory: f.stateDirectory })
    assert.equal((await restarted.status()).messages[0].pendingReason, pendingReason)
  }
})

test('corrupt and unwritable evidence fail closed; deletion removes the persisted state', async t => {
  const f = await fixture(t)
  await f.save(f.user('m01'))
  const status = await f.status()
  assert.ok(!(await readFile(status.stateFile, 'utf8')).includes('"text"'))
  await writeFile(status.stateFile, '{broken')
  const restarted = await fixture(t, f.sessions, { stateDirectory: f.stateDirectory })
  assert.equal((await restarted.status()).evidence, 'unavailable')
  await f.hooks.event({ event: { type: 'session.deleted', properties: { info: { id: 'one' } } } })
  await assert.rejects(readFile(status.stateFile), { code: 'ENOENT' })
  assert.equal((await f.status()).lifecycle, 'deleted')
  const blocked = path.join(f.stateDirectory, 'file-as-directory')
  await writeFile(blocked, 'file')
  const noWrite = await fixture(t, {}, { stateDirectory: blocked })
  await noWrite.save(noWrite.user('m01'))
  const a = noWrite.assistant('m02', 'm01'); await noWrite.prepare(a)
  await assert.rejects(noWrite.call(a), /STEERING_EVIDENCE_UNAVAILABLE/)
})

test('composition retains tools and both event handlers, rejects duplicate tool names', async () => {
  const calls = [], first = { execute() {} }, second = { execute() {} }
  const hooks = composeSteeringHooks({ tool: { one_shot_status: first }, event: async () => { calls.push('one') } }, { tool: { steering_status: second }, event: async () => { calls.push('two') } })
  assert.equal(hooks.tool.one_shot_status, first); assert.equal(hooks.tool.steering_status, second)
  await hooks.event({ event: {} }); assert.deepEqual(calls, ['one', 'two'])
  assert.throws(() => composeSteeringHooks({ tool: { duplicate: first } }, { tool: { duplicate: second } }), /Duplicate/)
})

async function recoveryFixture(t, options = {}) {
  const f = await fixture(t, {}, { autoResume: true, ...options })
  const original = await f.save(f.user('m01', 'original task'))
  const a = f.assistant('m03', 'm01')
  await f.prepare(a, [original])
  const guidance = await f.save(f.user('m02', 'steer: retained original guidance'))
  Object.assign(guidance.info, { system: 'original system', variant: 'chosen', format: { type: 'json_schema', schema: { type: 'object' } }, tools: { write: false } })
  const requests = []
  const accept = async options => {
    requests.push(options)
    const control = { info: { id: `m10${requests.length}`, sessionID: 'one', role: 'user', time: { created: 10 }, ...options.body }, parts: options.body.parts.map((part, i) => ({ ...part, id: `control-${i}`, sessionID: 'one' })) }
    delete control.info.parts
    await f.hooks['chat.message']({ sessionID: 'one' }, { message: control.info, parts: control.parts })
    f.sessions.one.push(control)
    return { data: undefined }
  }
  f.input.client.session.promptAsync = accept
  const finish = async () => {
    a.info.finish = 'stop'; a.info.time.completed = 4
    await f.hooks.event({ event: { type: 'session.status', properties: { sessionID: 'one', status: { type: 'idle' } } } })
  }
  return { ...f, original, guidance, a, requests, accept, finish }
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await pause(10) }
  assert.fail('recovery condition did not become true')
}

test('successful idle recovery uses one synthetic control, retains original guidance and omits tools', async t => {
  const f = await recoveryFixture(t)
  const before = structuredClone(f.guidance)
  await f.finish()
  await until(async () => (await f.status()).recovery.attempts[0]?.status === 'dispatched')
  assert.equal(f.requests.length, 1)
  const body = f.requests[0].body
  assert.equal(body.parts.length, 1); assert.equal(body.parts[0].synthetic, true)
  assert.equal(body.parts[0].metadata.codeagentSteering.plugin, '@oneshot/opencode-steering')
  assert.ok(body.parts[0].metadata.codeagentSteering.recoveryKey)
  assert.ok(!body.parts[0].text.includes('retained original guidance'))
  assert.equal(body.system, f.guidance.info.system); assert.deepEqual(body.format, f.guidance.info.format)
  assert.equal(body.variant, f.guidance.info.variant); assert.deepEqual(body.model, f.guidance.info.model)
  assert.equal(Object.hasOwn(body, 'tools'), false)
  assert.deepEqual(f.guidance, before)
  assert.equal(f.sessions.one.filter(message => message.info.role === 'user').length, 3)
  assert.equal((await f.status()).messages.length, 2, 'synthetic control is not user guidance')
  await f.finish(); await pause(90)
  assert.equal(f.requests.length, 1, 'same fingerprints are attempted at most once')
})

test('prompt_async acknowledgment before chat.message retains the dispatch token', async t => {
  const f = await recoveryFixture(t)
  let options
  f.input.client.session.promptAsync = async value => { options = value; return { data: undefined } }
  await f.finish(); await until(() => !!options)
  await pause(30)
  await f.accept(options)
  assert.equal(f.requests.length, 1)
  assert.ok((await f.status()).recovery.attempts[0].controlMessageID)
})

test('autoResume:false, cancellation, provider error, deletion and busy suppress scheduled continuation', async t => {
  for (const condition of ['disabled', 'cancelled', 'failed', 'deleted', 'busy']) {
    const f = await recoveryFixture(t, { autoResume: condition !== 'disabled' })
    await f.finish()
    if (condition !== 'disabled') {
      const event = condition === 'deleted' ? { type: 'session.deleted', properties: { info: { id: 'one' } } }
        : condition === 'busy' ? { type: 'session.status', properties: { sessionID: 'one', status: { type: 'busy' } } }
        : { type: 'session.error', properties: { sessionID: 'one', error: { name: condition === 'cancelled' ? 'MessageAbortedError' : 'APIError' } } }
      await f.hooks.event({ event })
    }
    await pause(80)
    assert.equal(f.requests.length, 0, condition)
  }
})

test('cancel after dispatch but before control persistence is suppressed by chat.message', async t => {
  const f = await recoveryFixture(t)
  let options
  f.input.client.session.promptAsync = async value => { options = value; return { data: undefined } }
  await f.finish(); await until(() => !!options)
  await f.hooks.event({ event: { type: 'session.error', properties: { sessionID: 'one', error: { name: 'MessageAbortedError' } } } })
  await assert.rejects(f.accept(options), /STEERING_RECOVERY_SUPPRESSED/)
  assert.equal(f.sessions.one.filter(message => message.info.role === 'user').length, 2)
  assert.equal((await f.status()).recovery.attempts[0].status, 'suppressed')
})

test('new user input and already prepared guidance suppress delayed control persistence', async t => {
  const f = await recoveryFixture(t)
  let options
  f.input.client.session.promptAsync = async value => { options = value; return { data: undefined } }
  await f.finish(); await until(() => !!options)
  await f.save(f.user('m04', 'new user request'))
  await assert.rejects(f.accept(options), /STEERING_RECOVERY_SUPPRESSED/)
  const next = f.assistant('m05', 'm04'); await f.prepare(next)
  next.info.time.completed = 6; next.info.finish = 'stop'
  await f.finish(); await pause(80)
  assert.equal((await f.status()).recovery.attempts.length, 1)
})

test('network outcome unknown does not retry, and a restart never resumes historical pending', async t => {
  const f = await recoveryFixture(t)
  let count = 0
  f.input.client.session.promptAsync = async () => { count++; throw new Error('response lost') }
  await f.finish()
  await until(async () => (await f.status()).recovery.attempts[0]?.status === 'dispatch-unknown')
  await f.finish(); await pause(80); assert.equal(count, 1)
  const restarted = await fixture(t, f.sessions, { stateDirectory: f.stateDirectory, autoResume: true })
  restarted.input.client.session.promptAsync = () => assert.fail('must not auto-resume old pending after restart')
  await restarted.hooks.event({ event: { type: 'session.status', properties: { sessionID: 'one', status: { type: 'idle' } } } })
  await pause(80)
  assert.equal((await restarted.status()).recovery.attempts.length, 1)
})

test('recovery requires persisted evidence and a successfully completed assistant', async t => {
  const f = await recoveryFixture(t)
  f.a.info.finish = 'stop'
  await f.hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'one' } } })
  await pause(80); assert.equal(f.requests.length, 0)
  f.state.fail = true
  await f.finish(); await pause(80); assert.equal(f.requests.length, 0)
})


test('completed StructuredOutput with tool-calls finish is eligible for continuation', async t => {
  const f = await recoveryFixture(t)
  f.a.info.finish = 'tool-calls'; f.a.info.structured = { result: 'old' }; f.a.info.time.completed = 4
  await f.hooks.event({ event: { type: 'session.status', properties: { sessionID: 'one', status: { type: 'idle' } } } })
  await until(async () => (await f.status()).recovery.attempts[0]?.controlMessageID)
  assert.equal(f.requests.length, 1)
})


test('concurrent active guidance retains every eligibility fingerprint in one recovery attempt', async t => {
  const f = await recoveryFixture(t)
  await Promise.all([f.save(f.user('m04', 'first concurrent correction')), f.save(f.user('m05', 'second concurrent correction'))])
  await f.finish()
  await until(async () => (await f.status()).recovery.attempts[0]?.controlMessageID)
  assert.deepEqual((await f.status()).recovery.attempts[0].pending.map(item => item.messageID), ['m02', 'm04', 'm05'])
  assert.equal(f.requests.length, 1)
})


test('expired permit schedules newer pending; a late old callback cannot consume the new permit', async t => {
  const f = await recoveryFixture(t)
  const dispatched = []
  f.input.client.session.promptAsync = async options => { dispatched.push(options); return { data: undefined } }
  await f.finish(); await until(() => dispatched.length === 1)
  const nextUser = await f.save(f.user('m04', 'start the next normal turn'))
  const nextAssistant = f.assistant('m06', nextUser.info.id)
  await f.prepare(nextAssistant)
  await f.save(f.user('m05', 'guidance received during the next turn'))
  nextAssistant.info.finish = 'stop'; nextAssistant.info.time.completed = 7
  await f.hooks.event({ event: { type: 'session.status', properties: { sessionID: 'one', status: { type: 'idle' } } } })
  await pause(5200)
  await until(() => dispatched.length === 2)
  const status = await f.status()
  assert.deepEqual(status.recovery.attempts.map(attempt => attempt.pending.map(item => item.messageID)), [['m02'], ['m05']])
  let rejected
  try { await f.accept(dispatched[0]) } catch (error) { rejected = error }
  assert.match(rejected?.message, /STEERING_RECOVERY_SUPPRESSED/)
  // The real prompt_async route forwards hook rejection to session.error.
  await f.hooks.event({ event: { type: 'session.error', properties: { sessionID: 'one', error: { name: 'UnknownError', data: { message: rejected.message } } } } })
  await f.accept(dispatched[1])
  const after = await f.status()
  assert.equal(after.recovery.attempts[0].status, 'suppressed')
  assert.equal(after.recovery.attempts[1].status, 'dispatched')
  assert.ok(after.recovery.attempts[1].controlMessageID)
  assert.equal(dispatched.length, 2, 'old fingerprint was never retried')
})


test('an unrelated provider error cannot impersonate a synthetic suppression notification', async t => {
  const f = await recoveryFixture(t)
  await f.finish()
  await f.hooks.event({ event: { type: 'session.error', properties: { sessionID: 'one', error: { name: 'UnknownError', data: { message: 'STEERING_RECOVERY_SUPPRESSED: provider failure, no local token' } } } } })
  await pause(80)
  assert.equal(f.requests.length, 0)
  assert.equal((await f.status()).lifecycle, 'failed')
})
