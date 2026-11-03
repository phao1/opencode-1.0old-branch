import assert from 'node:assert/strict'
import { test } from 'node:test'
import http from 'node:http'
import { mkdtemp, mkdir, writeFile, access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { startKernel, until, finish, root, entry, model } from './kernel.mjs'

async function lab(t, enabled, { barriers = false, dispatchBarrier = false, afterSaveBarrier = false, compactingBarrier = false, steeringOptions, extra = {} } = {}) {
  const requests = [], held = [], events = [], waits = new Map()
  await mkdir(path.join(root, '.codeagent'), { recursive: true })
  const directory = await mkdtemp(path.join(root, '.codeagent/steering-v2-case-'))
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c
    if (req.url.startsWith('/barrier/')) { waits.set(req.url.split('/').at(-1), res); return }
    if (req.url === '/event') { events.push(JSON.parse(raw)); res.end('{}'); return }
    requests.push(JSON.parse(raw)); held.push(res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const provider = `http://127.0.0.1:${server.address().port}`
  const companion = path.join(directory, 'companion.mjs')
  await writeFile(companion, `export default async ctx => {
    if (${dispatchBarrier}) {
      const get = ctx.client.session.get.bind(ctx.client.session); let once = false
      ctx.client.session.get = async args => { if (!once) { once = true; await fetch(${JSON.stringify(provider + "/barrier/dispatch")}) }; return get(args) }
    }
    return ({
    async 'experimental.session.compacting'() {
      if (${compactingBarrier}) await fetch(${JSON.stringify(provider + '/barrier/compacting')})
    },
    async 'chat.message'(_, out) {
      const text = out.parts.find(p=>p.type==='text'&&!p.synthetic)?.text || ''
      const which = ${barriers} && (text.startsWith('TASK:')?'task':text.startsWith('GUIDE:')?'guide':undefined)
      await fetch(${JSON.stringify(provider + '/event')}, {method:'POST', body:JSON.stringify({kind:'message',which,id:out.message.id,parts:out.parts,info:out.message})})
      if(which) await fetch(${JSON.stringify(provider + '/barrier/')}+which)
    }
  })}`)
  const post = path.join(directory, 'after-product.mjs')
  await writeFile(post, `export default async () => ({ async 'chat.message'(_, out) {
    if (out.parts.some(p => p.type === 'text' && p.text?.startsWith('GUIDE:'))) await fetch(${JSON.stringify(provider + '/barrier/post-guide')})
  } })`)
  let kernel, session
  try { kernel = await startKernel({ provider, directory, plugin: [companion, ...(enabled ? [steeringOptions ? [entry, steeringOptions] : entry] : []), ...(afterSaveBarrier ? [post] : [])], extra }) }
  catch (e) { server.closeAllConnections(); server.close(); throw e }
  t.after(async () => {
    const messages = session ? await kernel.request('/session/' + session.id + '/message').catch(() => []) : []
    for (const r of [...held, ...waits.values()]) r.destroy()
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await kernel.stop()
    await writeFile(path.join(directory, 'evidence.json'), JSON.stringify({ source: 'deterministic', enabled, requests, events, messages, kernelFixture: kernel.fixture }, null, 2))
  })
  session = await kernel.request('/session', { title: 'Steering v2 integration', permission: [{ permission: '*', pattern: '*', action: 'allow' }] })
  const route = '/session/' + session.id
  const submit = (text, fields = {}) => kernel.request(route + '/prompt_async', { model, agent: 'build', parts: [{ type: 'text', text }], ...fields })
  const messages = () => kernel.request(route + '/message')
  const idle = async () => !(await kernel.request('/session/status'))[session.id]
  return { ...kernel, directory, session, route, submit, messages, idle, requests, held, events, waits }
}
async function exists(file) { return access(file).then(() => true, () => false) }

for (const enabled of [false, true]) test(`A2/A4/A5/A10 multiple tools in one assistant; plugin=${enabled}`, { timeout: 60000 }, async t => {
  const f = await lab(t, enabled)
  await f.submit('TASK: write the old files, then finish.')
  await until(() => f.requests.length === 1, 'first provider request')
  await f.submit('CORRECTION_ONE: do not write old files.')
  await until(async () => (await f.messages()).filter(m => m.info.role === 'user').length === 2, 'first guide saved')
  await f.submit('CORRECTION_TWO: newest guidance wins. Preserve completed results.')
  await until(async () => (await f.messages()).filter(m => m.info.role === 'user').length === 3, 'second guide saved')
  const targets = ['old-a.txt', 'old-b.txt'].map(name => path.join(f.directory, name))
  finish(f.held[0], null, targets.map(target => ({ name: 'bash', args: { command: `printf obsolete > '${target}'`, description: 'old action' } })))
  await until(() => f.requests.length >= 2, 'second request')
  const saved = await f.messages(), toolMessages = saved.filter(m => m.parts.some(p => p.type === 'tool'))
  assert.equal(toolMessages.length, 1, 'Both calls belong to the same assistant')
  const parts = toolMessages[0].parts.filter(p => p.type === 'tool')
  assert.equal(parts.length, 2)
  for (const target of targets) assert.equal(await exists(target), !enabled)
  if (enabled) {
    assert.ok(parts.every(p => p.state.status === 'error' && p.state.error.includes('STEERING_STALE_CONTEXT')))
    assert.ok(JSON.stringify(f.requests[1]).includes('Latest user guidance takes priority'))
  } else assert.ok(parts.every(p => p.state.status === 'completed'))
  for (const text of ['CORRECTION_ONE:', 'CORRECTION_TWO:']) assert.ok(JSON.stringify(f.requests[1]).includes(text))
  const newTarget = path.join(f.directory, 'SUMMARY.md')
  finish(f.held[1], null, [{ name: 'bash', args: { command: `printf corrected > '${newTarget}'`, description: 'current action' } }])
  await until(() => f.requests.length >= 3, 'final request')
  assert.equal(await readFile(newTarget, 'utf8'), 'corrected')
  finish(f.held[2]); await until(f.idle, 'idle'); await delay(250)
  assert.equal(f.requests.length, 3, 'No duplicate native continuation')
  assert.equal((await f.messages()).filter(m => m.info.role === 'user').length, 3)
})

for (const enabled of [false, true]) test(`A3 late-save native-ID double barrier; plugin=${enabled}`, { timeout: 60000 }, async t => {
  const f = await lab(t, enabled, { barriers: true })
  await f.submit('TASK: finish original task.')
  await until(() => f.waits.has('task'), 'task ID allocated')
  await f.submit('GUIDE: corrected late-save guidance', { system: 'inherited-system', variant: 'chosen', format: { type: 'text' },
    parts: [{ type: 'text', text: 'GUIDE: corrected late-save guidance' }, { type: 'file', mime: 'text/plain', filename: 'guide.txt', url: 'data:text/plain;base64,YXR0YWNobWVudA==' }] })
  await until(() => f.waits.has('guide'), 'guide ID allocated')
  f.waits.get('task').end('{}'); await until(() => f.requests.length === 1, 'initial request')
  assert.ok(!JSON.stringify(f.requests[0]).includes('GUIDE:'))
  f.waits.get('guide').end('{}')
  let originals, guide
  await until(async () => { originals = await f.messages(); guide = originals.find(m => m.parts.some(p => p.text?.startsWith('GUIDE:'))); return guide?.parts.some(p => p.type === 'file') && guide.parts.some(p => p.text === 'attachment') }, 'all guide parts saved')
  const a = originals.find(m => m.info.role === 'assistant')
  assert.ok(guide.info.id < a.info.id, 'Natural native IDs establish actual late save')
  const permissions = (await f.request(f.route)).permission
  finish(f.held[0])
  if (enabled) {
    await until(() => f.requests.length === 2, 'automatic continuation')
    assert.ok(JSON.stringify(f.requests[1]).includes('GUIDE:'))
    assert.equal(JSON.stringify(f.requests[1]).split('[Steering reminder]').length - 1, 1)
    const current = path.join(f.directory, 'g2-current.txt')
    finish(f.held[1], null, [{ name: 'bash', args: { command: `printf current > '${current}'`, description: 'current recovered action' } }])
    await until(() => f.requests.length === 3, 'request after recovered tool')
    assert.equal(await readFile(current, 'utf8'), 'current')
    assert.equal(JSON.stringify(f.requests[2]).split('[Steering reminder]').length - 1, 0)
    finish(f.held[2]); await until(f.idle, 'continued idle')
  } else await until(f.idle, 'native stopped without continuation')
  await delay(300)
  assert.equal(f.requests.length, enabled ? 3 : 1)
  const saved = await f.messages(), users = saved.filter(m => m.info.role === 'user')
  assert.equal(users.length, enabled ? 3 : 2)
  assert.deepEqual(users.find(m => m.info.id === guide.info.id).parts, guide.parts)
  assert.deepEqual((await f.request(f.route)).permission, permissions)
  if (enabled) {
    const control = users.find(m => !originals.some(o => o.info.id === m.info.id))
    assert.ok(control.parts.some(p => p.synthetic && p.metadata?.codeagentSteering))
    assert.equal(control.info.system, guide.info.system); assert.equal(control.info.variant, guide.info.variant); assert.deepEqual(control.info.format, guide.info.format)
    assert.ok(!JSON.stringify(control.parts).includes('corrected late-save guidance'))
    assert.ok(!JSON.stringify(control.parts).includes('[Steering reminder]'))
  }
  const next = f.requests.length, manual = path.join(f.directory, 'g2-manual.txt')
  await f.submit('Continue with an ordinary input after G2')
  await until(() => f.requests.length === next + 1)
  assert.equal(JSON.stringify(f.requests[next]).split('[Steering reminder]').length - 1, 0)
  finish(f.held[next], null, [{ name: 'bash', args: { command: `printf manual > '${manual}'`, description: 'ordinary follow-on action' } }])
  await until(() => f.requests.length === next + 2)
  assert.equal(await readFile(manual, 'utf8'), 'manual')
  finish(f.held[next + 1]); await until(f.idle)
})

for (const enabled of [false, true]) test(`A5 no steering leaves request count and tools unchanged; plugin=${enabled}`, { timeout: 60000 }, async t => {
  const f = await lab(t, enabled)
  await f.submit('Ordinary task'); await until(() => f.requests.length === 1)
  const target = path.join(f.directory, 'normal.txt')
  finish(f.held[0], null, [{ name: 'bash', args: { command: `printf normal > '${target}'`, description: 'normal' } }])
  await until(() => f.requests.length === 2); finish(f.held[1]); await until(f.idle); await delay(200)
  assert.equal(await readFile(target, 'utf8'), 'normal'); assert.equal(f.requests.length, 2)
  assert.equal((await f.messages()).filter(m => m.info.role === 'user').length, 1)
})

test('A6 native SubtaskPart completes with mixed input; ordinary task is gated', { timeout: 60000 }, async t => {
  const f = await lab(t, true, { extra: { agent: { title: { disable: true }, summary: { disable: true }, general: { mode: 'subagent', model: 'fixture/fixture' } } } })
  await f.submit('Mixed native guidance', { parts: [{ type: 'text', text: 'Mixed native guidance' }, { type: 'subtask', agent: 'general', description: 'read only', prompt: 'Respond briefly without tools.' }] })
  await until(() => f.requests.length === 1, 'child request'); finish(f.held[0])
  await until(() => f.requests.length === 2, 'parent request'); finish(f.held[1]); await until(f.idle)
  const parts = (await f.messages()).flatMap(m => m.parts.filter(p => p.type === 'tool'))
  assert.ok(parts.some(p => p.tool === 'task' && p.state.status === 'completed'))
  assert.ok(parts.every(p => p.state.status !== 'running'))
  const prior = f.requests.length
  await f.submit('Start task'); await until(() => f.requests.length === prior + 1)
  await f.submit('New correction: no subagent')
  await until(async () => (await f.messages()).some(m => m.parts.some(p => p.text === 'New correction: no subagent')))
  finish(f.held[prior], null, [{ name: 'task', args: { description: 'obsolete', prompt: 'old', subagent_type: 'general' } }])
  await until(() => f.requests.length === prior + 2); finish(f.held[prior + 1]); await until(f.idle)
  const saved = await f.messages()
  assert.ok(saved.flatMap(m => m.parts).some(p => p.tool === 'task' && p.state.status === 'error' && p.state.error.includes('STEERING_STALE_CONTEXT')))
  assert.equal((await f.request(f.route + '/children')).length, 1)
})

test('A6 abort suppresses continuation of saved guidance', { timeout: 60000 }, async t => {
  const f = await lab(t, true)
  await f.submit('Running task'); await until(() => f.requests.length === 1)
  await f.submit('Correction before cancel'); await until(async () => (await f.messages()).filter(m => m.info.role === 'user').length === 2)
  await f.request(f.route + '/abort', {}); await until(f.idle); await delay(300)
  assert.equal(f.requests.length, 1)
  assert.equal((await f.messages()).filter(m => m.info.role === 'user').length, 2)
})

test('A6 revert before late-save completion preserves undo and supports redo', { timeout: 60000 }, async t => {
  const f = await lab(t, true, { barriers: true, dispatchBarrier: true })
  await f.submit('TASK: finish'); await until(() => f.waits.has('task'))
  await f.submit('GUIDE: never resurrect reverted guidance'); await until(() => f.waits.has('guide'))
  f.waits.get('task').end('{}'); await until(() => f.requests.length === 1)
  f.waits.get('guide').end('{}'); await until(async () => (await f.messages()).filter(m => m.info.role === 'user').length === 2)
  // Delay the public SDK get used for dispatch, without changing its response.
  // This makes the persisted-revert-before-dispatch condition deterministic.
  const users = (await f.messages()).filter(m => m.info.role === 'user')
  finish(f.held[0]); await until(() => f.waits.has('dispatch'), 'public SDK dispatch barrier')
  await f.request(f.route + '/revert', { messageID: users[1].info.id })
  f.waits.get('dispatch').end('{}')
  await delay(300)
  assert.equal(f.requests.length, 1)
  assert.equal((await f.request(f.route)).revert.messageID, users[1].info.id)
  await f.request(f.route + '/unrevert', {})
  assert.equal((await f.request(f.route)).revert, undefined)
  assert.ok((await f.messages()).some(m => m.info.id === users[1].info.id))
})

test('A2/A3/A6 slow save gates current request, next transform drops missing guide and never permanently blocks', { timeout: 60000 }, async t => {
  const f = await lab(t, true, { barriers: true, afterSaveBarrier: true })
  await f.submit('TASK: perform old actions'); await until(() => f.waits.has('task'))
  await f.submit('GUIDE: slow native save must remain observable'); await until(() => f.waits.has('guide'))
  f.waits.get('task').end('{}'); await until(() => f.requests.length === 1)
  f.waits.get('guide').end('{}'); await until(() => f.waits.has('post-guide'), 'observed by product, held by downstream hook')
  // Deliberately exceed the former 1.5s eviction threshold while no save exists.
  await delay(1650)
  const targets = ['slow-old-a', 'slow-old-b'].map(name => path.join(f.directory, name))
  finish(f.held[0], null, targets.map(target => ({ name: 'bash', args: { command: `printf obsolete > '${target}'`, description: 'old slow-save action' } })))
  await until(() => f.requests.length === 2, 'request after rejected stale tools')
  for (const file of targets) assert.equal(await exists(file), false)
  assert.ok((await f.messages()).flatMap(m => m.parts).filter(p => p.type === 'tool').every(p => p.state.status === 'error' && p.state.error.includes('STEERING_STALE_CONTEXT')))
  assert.ok(!JSON.stringify(f.requests[1]).includes('GUIDE: slow'))
  f.waits.get('post-guide').end('{}')
  let guide
  await until(async () => { guide = (await f.messages()).find(m => m.parts.some(p => p.text === 'GUIDE: slow native save must remain observable')); return guide })
  const assistants = (await f.messages()).filter(m => m.info.role === 'assistant')
  assert.ok(guide.info.id < assistants.at(-1).info.id)
  const target = path.join(f.directory, 'after-slow-save.txt')
  finish(f.held[1], null, [{ name: 'bash', args: { command: `printf current > '${target}'`, description: 'new request is fail-open' } }])
  await until(() => f.requests.length === 3, 'normal loop after slow save')
  assert.equal(await readFile(target, 'utf8'), 'current')
  assert.ok(JSON.stringify(f.requests[2]).includes('GUIDE: slow'))
  assert.ok(!JSON.stringify(f.requests[2].messages.filter(m => m.role === 'user')).includes('[Steering reminder]'))
  finish(f.held[2]); await until(f.idle); await delay(250)
  assert.equal(f.requests.length, 3)
  const users = (await f.messages()).filter(m => m.info.role === 'user')
  assert.equal(users.length, 2)
  assert.equal(users.filter(m => m.parts.some(p => p.metadata?.codeagentSteering)).length, 0)
})

test('A5/A6 manual summarize permits first ordinary tool and subsequent normal requests', { timeout: 60000 }, async t => {
  const f = await lab(t, true)
  await f.submit('Finish an initial ordinary task'); await until(() => f.requests.length === 1)
  finish(f.held[0]); await until(f.idle)
  const summarized = f.request(f.route + '/summarize', { providerID: model.providerID, modelID: model.modelID, auto: false })
  await until(() => f.requests.length === 2, 'summary model request')
  finish(f.held[1], 'Summary: initial task completed. Preserve prior work; follow new user tasks.')
  await summarized; await until(f.idle)
  assert.ok((await f.messages()).some(m => m.info.summary === true && m.info.time.completed))
  for (let i = 0; i < 2; i++) {
    const index = f.requests.length, target = path.join(f.directory, 'after-summary-' + i)
    await f.submit('Perform the next ordinary task ' + i)
    await until(() => f.requests.length === index + 1)
    finish(f.held[index], null, [{ name: 'bash', args: { command: `printf current > '${target}'`, description: 'first ordinary tool after summary' } }])
    await until(() => f.requests.length === index + 2)
    assert.equal(await readFile(target, 'utf8'), 'current')
    const tools = (await f.messages()).flatMap(m => m.parts).filter(p => p.type === 'tool')
    assert.ok(tools.every(p => p.state.status === 'completed'))
    finish(f.held[index + 1]); await until(f.idle)
  }
  assert.equal(f.requests.length, 6)
})

test('A4/A6 real overflow compaction replays guidance under new IDs and admits its ordinary tool', { timeout: 60000 }, async t => {
  const f = await lab(t, true)
  await f.submit('Complete a first history task'); await until(() => f.requests.length === 1)
  finish(f.held[0]); await until(f.idle)
  await f.submit('Start the next task while waiting for updated guidance'); await until(() => f.requests.length === 2)
  const guidance = 'OVERFLOW_GUIDE: preserve history and write the current artifact only.'
  await f.submit(guidance, { system: 'replay-system', variant: 'chosen', parts: [{ type: 'text', text: guidance },
    { type: 'file', mime: 'text/plain', filename: 'replay.txt', url: 'data:text/plain;base64,bmF0aXZlIHJlcGxheSBhdHRhY2htZW50' }] })
  let original
  await until(async () => { original = (await f.messages()).find(m => m.parts.some(p => p.text === guidance)); return original?.parts.some(p => p.text === 'native replay attachment') })
  f.held[1].writeHead(400, { 'content-type': 'application/json' })
  f.held[1].end(JSON.stringify({ error: { message: 'Input exceeds the context window of this model', type: 'invalid_request_error', code: 'context_length_exceeded' } }))
  await until(() => f.requests.length === 3, 'native overflow summary request')
  assert.ok(!JSON.stringify(f.requests[2].messages).includes(guidance), 'Overflow must actually exclude the latest original guide')
  assert.ok(!JSON.stringify(f.requests[2].messages).includes('[Steering reminder]'))
  finish(f.held[2], 'Summary: preserve completed history and follow latest user guidance.')
  await until(() => f.requests.length === 4, 'native replay normal request')
  const body = JSON.stringify(f.requests[3].messages)
  assert.ok(body.includes(guidance)); assert.ok(body.includes('native replay attachment'))
  assert.ok(!body.includes('[Steering reminder]'))
  const users = (await f.messages()).filter(m => m.info.role === 'user' && m.parts.some(p => p.text === guidance))
  assert.equal(users.length, 2)
  const replay = users.find(m => m.info.id !== original.info.id)
  assert.ok(replay)
  assert.ok(replay.parts.every(p => !original.parts.some(old => old.id === p.id)))
  for (const field of ['agent', 'model', 'system', 'variant', 'format', 'tools']) assert.deepEqual(replay.info[field], original.info[field])
  const target = path.join(f.directory, 'overflow-current.txt')
  finish(f.held[3], null, [{ name: 'bash', args: { command: `printf current > '${target}'`, description: 'current action after native replay' } }])
  await until(() => f.requests.length === 5)
  assert.equal(await readFile(target, 'utf8'), 'current')
  assert.ok((await f.messages()).flatMap(m => m.parts).filter(p => p.type === 'tool').every(p => p.state.status === 'completed'))
  finish(f.held[4]); await until(f.idle)
})

test('A3/A6 three manual summaries and summary-only continuation never retain old gate or reminder', { timeout: 60000 }, async t => {
  const f = await lab(t, true, { barriers: true, steeringOptions: { autoResume: false } })
  await f.submit('TASK: preserve completed initial work'); await until(() => f.waits.has('task'))
  await f.submit('GUIDE: latest direction must survive summary chains'); await until(() => f.waits.has('guide'))
  f.waits.get('task').end('{}'); await until(() => f.requests.length === 1)
  f.waits.get('guide').end('{}'); await until(async () => (await f.messages()).filter(m => m.info.role === 'user').length === 2)
  finish(f.held[0]); await until(f.idle)
  for (let i = 0; i < 3; i++) {
    const index = f.requests.length
    const result = f.request(f.route + '/summarize', { providerID: model.providerID, modelID: model.modelID, auto: false })
    await until(() => f.requests.length === index + 1)
    assert.ok(!JSON.stringify(f.requests[index].messages).includes('[Steering reminder]'), 'Summary '+i+' must not get a reminder')
    finish(f.held[index], 'Compact summary of prior work.'); await result; await until(f.idle)
  }
  await f.submit('Continue with the next ordinary tool')
  await until(() => f.requests.length === 5)
  assert.ok(!JSON.stringify(f.requests[4].messages).includes('[Steering reminder]'))
  const target = path.join(f.directory, 'summary-chain.txt')
  finish(f.held[4], null, [{ name: 'bash', args: { command: `printf continued > '${target}'`, description: 'ordinary tool after three summaries' } }])
  await until(() => f.requests.length === 6); assert.equal(await readFile(target, 'utf8'), 'continued')
  finish(f.held[5]); await until(f.idle)
})


for (const enabled of [false, true]) test(`R3-P1/A3/A4 summary-period late save uses summary parent boundary; plugin=${enabled}`, { timeout: 60000 }, async t => {
  const f=await lab(t,enabled,{barriers:true,compactingBarrier:true})
  await f.submit('Initial completed task'); await until(()=>f.requests.length===1)
  finish(f.held[0]); await until(f.idle)
  const summarize=f.request(f.route+'/summarize',{...model,auto:false})
  await until(()=>f.waits.has('compacting'),'public compacting hook barrier')
  const trigger=(await f.messages()).find(m=>m.parts.some(p=>p.type==='compaction'))
  assert.ok(trigger)
  const guidance='GUIDE: correction allocated after compaction trigger; preserve completed work and write current output.'
  await f.submit(guidance)
  await until(()=>f.waits.has('guide'),'guide ID allocated, save held before product')
  const allocated=f.events.find(e=>e.which==='guide')
  assert.ok(trigger.info.id<allocated.id,'Guide ID must be later than native compaction trigger')
  f.waits.get('compacting').end('{}')
  await until(()=>f.requests.length===2,'actual summary transform and assistant allocation')
  const summary=(await f.messages()).find(m=>m.info.summary===true)
  assert.equal(summary.info.parentID,trigger.info.id)
  assert.ok(allocated.id<summary.info.id,'Late-save guide precedes the summary assistant ID')
  assert.ok(!JSON.stringify(f.requests[1]).includes(guidance))
  assert.ok(!JSON.stringify(f.requests[1]).includes('[Steering reminder]'))
  f.waits.get('guide').end('{}')
  await until(async()=>(await f.messages()).some(m=>m.info.id===allocated.id && m.parts.some(p=>p.text===guidance)),'guide actually saved during summary')
  finish(f.held[1],'Summary of the completed initial task, before the late-save correction.')
  await summarize
  if(enabled) {
    await until(()=>f.requests.length===3,'one automatic continuation after summary idle')
    assert.ok(JSON.stringify(f.requests[2]).includes(guidance),'Actual provider must receive retained post-trigger guidance')
    assert.equal(JSON.stringify(f.requests[2]).split('[Steering reminder]').length-1,1)
    const target=path.join(f.directory,'summary-current.txt')
    finish(f.held[2],null,[{name:'bash',args:{command:`printf current > '${target}'`,description:'current tool after recovered summary'}}])
    await until(()=>f.requests.length===4)
    assert.equal(await readFile(target,'utf8'),'current')
    assert.equal(JSON.stringify(f.requests[3]).split('[Steering reminder]').length-1,0,'Following ordinary request has no G3 reminder')
    finish(f.held[3]); await until(f.idle)
  } else await until(f.idle)
  await delay(300)
  assert.equal(f.requests.length,enabled?4:2)
  const saved=await f.messages()
  const controls = saved.filter(m=>m.parts.some(p=>p.synthetic && p.metadata?.codeagentSteering))
  assert.equal(controls.length,enabled?1:0)
  assert.ok(controls.every(m=>!JSON.stringify(m.parts).includes('[Steering reminder]')))
  assert.ok(saved.flatMap(m=>m.parts).filter(p=>p.type==='tool').every(p=>p.state.status==='completed'))
})
