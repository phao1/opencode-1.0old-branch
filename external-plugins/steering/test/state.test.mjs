import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SteeringPlugin } from '../src/index.ts'
import { composeSteeringHooks } from '../../src/steering/compose.ts'
import { setTimeout as delay } from 'node:timers/promises'

async function fixture(options = {}, plugin = SteeringPlugin) {
  const sessions = {}, reads = [], controls = [], statuses = {}, details = {}, sdk = []
  let hooks, offline = false
  const client = { tui: { showToast: async () => { throw Error('toast offline') } }, session: {
    messages: async ({ path }) => { sdk.push('messages'); reads.push(path.id); if (offline) throw Error('offline'); return { data: structuredClone(sessions[path.id] ?? []) } },
    status: async () => { sdk.push('status'); return { data: statuses } },
    get: async ({ path }) => { sdk.push('get'); return { data: details[path.id] ?? { id: path.id } } },
    promptAsync: async args => { sdk.push('promptAsync'); controls.push(args); return { data: undefined } },
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
  return { sessions, reads, controls, client, statuses, details, sdk, hooks, event, user, observe, persist, save, assistant, prepare, call, status,
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
async function finish(f) { f.a.info.finish = 'stop'; f.a.info.time.completed = 3; await f.event('session.status', { sessionID: 'one', status: { type: 'idle' } }) }

test('A1/A5 idle input >300 and 129 cancelled sessions never create retained state or SDK reads', async () => {
  const f = await fixture()
  for (let i = 0; i < 350; i++) {
    const u = await f.save(f.user('idle' + i)), a = f.assistant('a' + i, u.info.id)
    await f.prepare(a, [u]); await f.call(a, 'ordinary' + i)
    await f.event('session.status', {sessionID:'one',status:{type:'idle'}})
  }
  for (let i = 0; i < 129; i++) {
    const u = f.user('task', 'task', [], 's' + i), a = f.assistant('a', 'task', u.info.sessionID)
    await f.prepare(a, [u]); await f.save(f.user('g', 'guide', [], u.info.sessionID))
    await f.event('session.error', { sessionID: u.info.sessionID, error: { data: { message: 'cancelled' } } })
    await f.event('session.status', { sessionID: u.info.sessionID, status: { type: 'idle' } })
    assert.equal((await f.status(u.info.sessionID)).request, 'unknown')
  }
  await delay(100); assert.equal(f.reads.length, 0); assert.equal(f.controls.length, 0); assert.deepEqual(f.sdk, [])
})

test('A1/A2/A5 empty, ignored, synthetic and other-session input do not gate; file-only does', async () => {
  const f = await running({ autoResume: false })
  for (const parts of [[{type:'text',text:' ',ignored:false}], [{type:'text',text:'x',ignored:true}],
    [{type:'text',text:'x',synthetic:true}], [{type:'agent'}], [{type:'subtask'}], [{type:'file',url:''}],
    [{type:'text',text:'<system-reminder>\nThe user sent the following message:\n \n\nPlease address this message and continue with your tasks.\n</system-reminder>'}]]) {
    const m = f.user('invalid'); m.parts = parts; await f.save(m)
  }
  await f.save(f.user('other', 'elsewhere', [], 'two')); await f.call(f.a, 'ok')
  const file = f.user('file'); file.parts = [{type:'file',url:'data:text/plain,valid'}]; await f.save(file)
  await assert.rejects(f.call(f.a, 'stale'), /STEERING_STALE_CONTEXT/)
  assert.equal(f.reads.length, 0)
})

test('A2 concurrent bash/task are gated without history; status, native prt_, unknown/cross session pass', async () => {
  const f = await running({ autoResume: false }); await f.save(f.user('guide', 'new guidance'))
  const calls = await Promise.allSettled([f.call(f.a,'bash'), f.call(f.a,'task','task')])
  assert.ok(calls.every(r => r.status === 'rejected' && /STEERING_STALE_CONTEXT/.test(r.reason)))
  for (const [tool, callID, sessionID] of [['task','prt_native','one'], ['bash','prt_conservative','one'],
    ['steering_status','status','one'], ['bash','unknown','missing'], ['bash','child','child']]) {
    await f.hooks['tool.execute.before']({tool,callID,sessionID}, {args:{}})
  }
  assert.equal(f.reads.length,0)
})

test('A3 reminder exactly once at matching effective user ID; attachments untouched, subsequent gates reset', async () => {
  const f = await running({autoResume:false})
  const g = await f.save(f.user('guide','latest',[{type:'file',url:'data:text/plain,attachment'}]))
  const original = structuredClone(g)
  const output = await f.prepare(f.a,[f.task,g])
  assert.equal(output.flatMap(m=>m.parts).filter(p=>p.synthetic).length,1)
  assert.deepEqual(g,original); await f.call(f.a,'new')
  assert.equal((await f.prepare(f.a,[g])).flatMap(m=>m.parts).filter(p=>p.synthetic).length,0)
  assert.equal(f.reads.length,0)
})

test('A3/A6 preceding-plugin removal/insertion, ID rewrite and invalid edits consume all pending', async () => {
  for (const mode of ['removed','new-id','empty','ignored','synthetic','assistant']) {
    const f = await running({autoResume:false}), g = await f.save(f.user('guide','correction'))
    const m = structuredClone(g)
    if (mode==='new-id') m.info.id='overflow-replay'
    if (mode==='empty') m.parts[0].text=' '
    if (mode==='ignored') m.parts[0].ignored=true
    if (mode==='synthetic') m.parts[0].synthetic=true
    if (mode==='assistant') m.info.role='assistant'
    const output = await f.prepare(f.a,mode==='removed'?[f.task]:[f.task,m])
    assert.ok(!JSON.stringify(output).includes('[Steering reminder]'),mode)
    await f.call(f.a,mode); assert.deepEqual((await f.status()).pending,[])
  }
  const f = await running({autoResume:false})
  const inserted=f.user('inserted','prior plugin input')
  await f.prepare(f.a,[f.task,inserted]); await f.call(f.a,'inserted')
})

test('A2/A3 empty, missing-session and mixed-session transforms invalidate all gates and recovery', async () => {
  for (const messages of [[], [{info:{id:'missing',role:'user'},parts:[]}],
    [{info:{id:'one',role:'user',sessionID:'one'},parts:[]},{info:{id:'two',role:'user',sessionID:'two'},parts:[]}]]) {
    const f=await running(); await f.save(f.user('g','latest'))
    await f.hooks['experimental.chat.messages.transform']({}, {messages})
    await f.call(f.a,'fail-open'); assert.equal((await f.status()).request,'unknown')
    await finish(f); await delay(100); assert.equal(f.controls.length,0)
  }
})

test('A3/A6 single and consecutive compactions never gate summaries or carry reminder lineage', async () => {
  const f=await running({autoResume:false}); await f.save(f.user('g','latest'))
  for(let i=0;i<3;i++) {
    await f.hooks['experimental.session.compacting']({sessionID:'one'}, {})
    assert.ok(!JSON.stringify(await f.prepare(f.a)).includes('[Steering reminder]'))
    await f.call(f.a,'summary'+i)
    await f.event('session.compacted',{sessionID:'one'})
    await f.prepare(f.a,[f.task]); await f.call(f.a,'ordinary'+i)
  }
  assert.equal(f.reads.length,0)
})

test('A1/A5 streaming, idle, restart and failing history never affect ordinary traffic', async () => {
  const f=await running(); f.offline()
  for(let i=0;i<200;i++) await f.event('message.part.delta',{sessionID:'one',delta:'x'})
  for(let i=0;i<20;i++) await f.call(f.a,'tool'+i)
  await finish(f); await delay(100); assert.equal(f.reads.length,0)
  await f.save(f.user('late-idle','idle guidance')); assert.equal((await f.status()).request,'unknown')
  const fresh=await fixture(); fresh.sessions.one=f.sessions.one
  await fresh.call(f.a,'unknown-after-restart'); assert.equal(fresh.reads.length,0)
})

test('A4 successful idle uses parent position even when guide ID precedes assistant, inherits fields but not tools', async () => {
  const f=await running(), g=await f.save(f.user('m02','latest'))
  Object.assign(g.info,{system:'system',variant:'chosen',format:{type:'text'},tools:{bash:false}})
  await f.event('session.idle',{sessionID:'one'}) // Deprecated companion notification has no effect.
  await finish(f); await f.event('session.idle',{sessionID:'one'})
  await until(()=>f.controls.length===1)
  assert.deepEqual(f.reads,['one']); const body=f.controls[0].body
  for(const key of ['model','agent','system','variant','format']) assert.deepEqual(body[key],g.info[key])
  assert.equal(body.tools,undefined); assert.ok(!JSON.stringify(body.parts).includes('latest'))
  assert.ok(body.parts[0].synthetic && body.parts[0].metadata.codeagentSteering)
  await f.event('session.status',{sessionID:'one',status:{type:'idle'}})
  await delay(100); assert.equal(f.controls.length,1)
})

test('A4 latest assistant must succeed and latest valid user must be a pending candidate after parent', async () => {
  for(const mode of ['failure','running','tool-calls','unknown','error','no-parent','at-parent','newest-not-candidate','missing-assistant','unsaved','partial']) {
    const f=await running(); await f.observe(f.user('m02','latest'))
    if(!['unsaved','partial'].includes(mode)) await f.persist(f.user('m02','latest'))
    if(mode==='partial') await f.persist({...f.user('m02'),parts:[]})
    f.a.info.finish='stop'; f.a.info.time.completed=3
    if(mode==='failure') f.a.info.error={name:'failed'}
    if(mode==='running') delete f.a.info.time.completed
    if(['tool-calls','unknown','error'].includes(mode)) f.a.info.finish=mode
    if(mode==='no-parent') f.a.info.parentID='missing'
    if(mode==='at-parent') f.a.info.parentID='m02'
    if(mode==='newest-not-candidate') await f.persist(f.user('later-unobserved','external'))
    if(mode==='missing-assistant') f.sessions.one=f.sessions.one.filter(m=>m.info.role!=='assistant')
    await f.event('session.status',{sessionID:'one',status:{type:'idle'}})
    await delay(110); assert.equal(f.controls.length,0,mode); assert.equal(f.reads.length,1,mode)
    await f.prepare(f.a,[f.task]); await f.call(f.a,'normal-'+mode)
  }
})

test('A4 structured success and file-only guidance recover; repeated idle does not retry', async () => {
  const f=await running(); const g=f.user('m02'); g.parts=[{type:'file',url:'data:text/plain,hello'}]
  await f.save(g); f.a.info.structured={ok:true}; f.a.info.finish='unknown'; f.a.info.time.completed=3
  await f.event('session.status',{sessionID:'one',status:{type:'idle'}})
  await until(()=>f.controls.length===1)
  await f.event('session.status',{sessionID:'one',status:{type:'idle'}})
  await delay(110); assert.equal(f.reads.length,1); assert.equal(f.controls.length,1)
})

test('A4/A6 SDK failure or slow save abandons recovery; new transform and tools always proceed', async () => {
  for(const stage of ['messages','status','get','promptAsync']) {
    const f=await running(); await f.save(f.user('m02','guidance'))
    f.client.session[stage]=async()=>{throw Error('offline')}
    await finish(f); await delay(120)
    await f.save(f.user('manual','manual retry')); await f.prepare(f.a,[f.task]); await f.call(f.a,'retry')
    assert.equal((await f.status()).recovery,false)
  }
  const f=await running(); const guide=f.user('m02','slow save'); await f.observe(guide)
  await finish(f); await delay(120); await f.persist(guide); await delay(100)
  assert.equal(f.controls.length,0); assert.equal(f.reads.length,1)
})

test('A4 invalidation during each await prevents continuation, including a second status-idle cancellation', async () => {
  for(const stage of ['messages','status','get']) for(const reason of ['idle','real-input','transform','error','delete','revert','compact']) {
    const f=await running(); await f.save(f.user('m02','guidance'))
    let release, entered=false; const original=f.client.session[stage]
    f.client.session[stage]=async args=>{entered=true; await new Promise(r=>release=r); return original(args)}
    await finish(f); await until(()=>entered)
    if(reason==='idle') await f.event('session.status',{sessionID:'one',status:{type:'idle'}})
    if(reason==='real-input') await f.save(f.user('manual','new'))
    if(reason==='transform') await f.prepare(f.a,[f.task])
    if(reason==='error') await f.event('session.error',{sessionID:'one'})
    if(reason==='delete') await f.event('session.deleted',{info:{id:'one'}})
    if(reason==='revert') await f.event('session.updated',{info:{id:'one',revert:{messageID:'m02'}}})
    if(reason==='compact') await f.hooks['experimental.session.compacting']({sessionID:'one'}, {})
    release(); await delay(20); assert.equal(f.controls.length,0,stage+reason)
  }
})

test('A4 status busy or persisted revert suppress dispatch and controls recheck status/get', async () => {
  for(const mode of ['busy','revert']) {
    const f=await running(); await f.save(f.user('m02','latest'))
    if(mode==='busy') f.statuses.one={type:'busy'}; else f.details.one={id:'one',revert:{messageID:'m02'}}
    await finish(f); await delay(120); assert.equal(f.controls.length,0)
  }
  const f=await running(); await f.save(f.user('m02','latest')); await finish(f); await until(()=>f.controls.length)
  const control=f.user('control'); control.parts=f.controls[0].body.parts
  await f.observe(control)
  f.details.one={id:'one',revert:{messageID:'m02'}}
  await assert.rejects(f.observe(control),/STEERING_RECOVERY_SUPPRESSED/)
  assert.equal((await f.status()).recovery,false)
})

test('A4 stale own control errors do not clear a new genuine request; ordinary errors do', async () => {
  const f=await running(); await f.save(f.user('m02','latest')); await finish(f); await until(()=>f.controls.length)
  const control=f.user('control'); control.parts=f.controls[0].body.parts
  await f.save(f.user('manual','manual')); await f.prepare(f.a,[f.task]); await f.save(f.user('new-guide','new guide'))
  let error; try {await f.observe(control)} catch(e){error=e}
  assert.match(error.message,/STEERING_RECOVERY_SUPPRESSED/)
  await f.event('session.error',{sessionID:'one',error:{data:{message:error.message}}})
  await assert.rejects(f.call(f.a,'still-stale'),/STEERING_STALE_CONTEXT/)
  await f.event('session.error',{sessionID:'one',error:{data:{message:'ordinary failure'}}})
  await f.call(f.a,'after-error')
})

test('A4 timeout expires hung query and rejects late controls without rejecting user input', async () => {
  const f=await running(); await f.save(f.user('m02','latest'))
  let release; f.client.session.messages=async()=>new Promise(r=>release=()=>r({data:f.sessions.one}))
  await finish(f); await until(()=>release); await delay(5050); release(); await delay(20)
  assert.equal(f.controls.length,0); assert.equal((await f.status()).recovery,false)
  await f.save(f.user('new','new')); await f.prepare(f.a,[f.task]); await f.call(f.a,'new')
})

test('A6 empty/ignored edits and removals release pending without history; info-only and partial saves are dropped at next request', async () => {
  for(const mode of ['empty','ignored','synthetic','removed','part-removed','info-only','partial']) {
    const f=await running({autoResume:false}), g=f.user('m02','latest',[{type:'file',url:'data:text/plain,x'}])
    await f.observe(g)
    if(mode==='empty') g.parts[0].text=' '
    if(mode==='ignored') g.parts[0].ignored=true
    if(mode==='synthetic') g.parts[0].synthetic=true
    if(['empty','ignored','synthetic'].includes(mode)) await f.event('message.part.updated',{part:g.parts[0]})
    if(mode==='removed') await f.event('message.removed',{sessionID:'one',messageID:g.info.id})
    if(mode==='part-removed') await f.event('message.part.removed',{sessionID:'one',messageID:g.info.id,partID:g.parts[0].id})
    if(['info-only','partial'].includes(mode)) {
      await f.event('message.updated',{info:g.info})
      await assert.rejects(f.call(f.a,'briefly-stale'),/STEERING_STALE_CONTEXT/)
      await f.prepare(f.a,[f.task])
    }
    await f.call(f.a,mode); assert.equal(f.reads.length,0)
  }
})

test('A6 aggregate autoResume:false forwards option and performs zero recovery reads', async () => {
  const aggregate=async(input,options)=>composeSteeringHooks({},await SteeringPlugin(input,options))
  const f=await running({autoResume:false},aggregate); await f.save(f.user('m02','latest')); await finish(f); await delay(120)
  assert.equal(f.reads.length,0); assert.equal(f.controls.length,0)
})

test('A7 status is compact, unknown provider/adoption; offline toast never changes behavior', async () => {
  const f=await running({autoResume:false}); await f.save(f.user('m02','latest'))
  const status=await f.status(); assert.equal(status.provider,'unknown'); assert.equal(status.adopted,'unknown')
  assert.deepEqual(status.pending,['m02']); assert.equal(f.reads.length,0)
  await assert.rejects(f.call(f.a,'blocked'),/STEERING_STALE_CONTEXT/)
  await f.prepare(f.a); await f.call(f.a,'absorbed')
})

test('R3-P1/A1/A3/A4 summary observes guidance and recovers only after the last summary parent', async () => {
  for (const mode of ['after-trigger', 'before-trigger', 'failed-summary', 'unfinished-summary']) {
    const f=await running()
    await finish(f)
    const before=f.user('before-guide','guidance before trigger')
    if(mode==='before-trigger') await f.persist(before)
    const trigger=await f.persist({...f.user('trigger'),parts:[{type:'compaction'}]})
    await f.hooks['experimental.session.compacting']({sessionID:'one'}, {})
    const summary=f.assistant('summary','trigger'); summary.info.summary=true
    const output=await f.prepare(summary,[f.task,trigger])
    assert.ok(!JSON.stringify(output).includes('[Steering reminder]'))
    const guide=mode==='before-trigger' ? before : f.user('late-guide','summary-period guidance')
    await f.save(guide)
    await f.call(summary,'summary-call') // The summary gate is always open.
    assert.deepEqual((await f.status()).pending,[guide.info.id])
    summary.info.finish='stop'; summary.info.time.completed=4
    if(mode==='failed-summary') summary.info.error={name:'failed'}
    if(mode==='unfinished-summary') delete summary.info.time.completed
    await f.event('session.status',{sessionID:'one',status:{type:'idle'}})
    if(mode==='after-trigger') await until(()=>f.controls.length===1)
    else await delay(120)
    assert.equal(f.controls.length,mode==='after-trigger'?1:0,mode)
    assert.equal(f.reads.length,1)
    await f.prepare(summary,[f.task]); await f.call(summary,'new-request')
  }
})

test('R3-P1/A3 summary-period guidance gets one ordinary reminder when native loop consumes it', async () => {
  const f=await running({autoResume:false})
  await f.hooks['experimental.session.compacting']({sessionID:'one'}, {})
  await f.prepare(f.a,[f.task])
  const guide=await f.save(f.user('summary-guide','new direction'))
  await f.call(f.a,'during-summary')
  const first=await f.prepare(f.a,[f.task,guide])
  assert.equal(JSON.stringify(first).split('[Steering reminder]').length-1,1)
  assert.ok(!JSON.stringify(await f.prepare(f.a,[f.task,guide])).includes('[Steering reminder]'))
  assert.equal(f.reads.length,0)
})

test('R3-P2/A4 candidate part edits invalidate recovery during messages/status/get without extra queries', async () => {
  for(const stage of ['messages','status','get']) for(const mode of ['empty','ignored','synthetic','effective-edit']) {
    const f=await running(), guide=await f.save(f.user('m02','guidance'))
    let release, entered=false; const original=f.client.session[stage]
    f.client.session[stage]=async args=>{const result=await original(args); entered=true; await new Promise(r=>release=r); return result}
    await finish(f); await until(()=>entered)
    const part={...guide.parts[0]}
    if(mode==='empty') part.text=' '
    if(mode==='ignored') part.ignored=true
    if(mode==='synthetic') part.synthetic=true
    if(mode==='effective-edit') part.text='changed guidance'
    await f.event('message.part.updated',{part})
    release(); await delay(20)
    assert.equal(f.controls.length,0,stage+mode); assert.equal(f.reads.length,1)
    assert.equal((await f.status()).recovery,false)
    await f.save(f.user('manual','manual continuation')); await f.prepare(f.a,[f.task]); await f.call(f.a,'allowed')
  }
})

test('R3-P2/A4 candidate edits during control save checks reject own control only', async () => {
  for(const stage of ['get','status']) for(const mode of ['empty','ignored','synthetic']) {
    const f=await running(), guide=await f.save(f.user('m02','guidance'))
    await finish(f); await until(()=>f.controls.length===1)
    let release, entered=false; const original=f.client.session[stage]
    f.client.session[stage]=async args=>{const result=await original(args); entered=true; await new Promise(r=>release=r); return result}
    const control=f.user('control'); control.parts=f.controls[0].body.parts
    const pending=assert.rejects(f.observe(control),/STEERING_RECOVERY_SUPPRESSED/)
    await until(()=>entered)
    const part={...guide.parts[0]}
    if(mode==='empty') part.text=' '
    if(mode==='ignored') part.ignored=true
    if(mode==='synthetic') part.synthetic=true
    await f.event('message.part.updated',{part})
    release(); await pending
    assert.equal(f.reads.length,1); assert.equal(f.controls.length,1)
    await f.save(f.user('manual','manual continuation')); await f.prepare(f.a,[f.task]); await f.call(f.a,'allowed')
  }
})

test('R3-P3/A1/A4 unknown, missing and cross-session control keys pass without SDK calls or blocking input', async () => {
  const f=await running()
  for(const metadata of [{plugin:'@oneshot/opencode-steering'}, {plugin:'@oneshot/opencode-steering',recoveryKey:'never-issued'},
    {plugin:'other-plugin',recoveryKey:'other'}]) {
    const control=f.user('public-synthetic'); control.parts=[{type:'text',synthetic:true,text:'public synthetic',metadata:{codeagentSteering:metadata}}]
    await f.save(control)
  }
  assert.equal(f.sdk.length,0); await f.call(f.a,'ordinary')
  await f.save(f.user('m02','guidance')); await finish(f); await until(()=>f.controls.length===1)
  const control=f.user('cross-session','',[],'two'); control.parts=f.controls[0].body.parts
  const count=f.sdk.length; await f.observe(control)
  assert.equal(f.sdk.length,count); assert.equal((await f.status()).recovery,true)
  control.info.sessionID='one'
  await f.event('session.status',{sessionID:'one',status:{type:'idle'}})
  await assert.rejects(f.observe(control),/STEERING_RECOVERY_SUPPRESSED/)
  await f.save(f.user('manual','real user')); await f.prepare(f.a,[f.task]); await f.call(f.a,'new')
})

test('R3-P3/A4 expired signed keys become unknown; signed stale keys still reject before expiry', async () => {
  const {mock}=await import('node:test')
  mock.timers.enable({apis:['setTimeout']})
  try {
    const f=await running(); await f.save(f.user('m02','guidance')); await finish(f)
    mock.timers.tick(75)
    for(let i=0;i<12;i++) await Promise.resolve()
    assert.equal(f.controls.length,1)
    const control=f.user('control'); control.parts=f.controls[0].body.parts
    await f.event('session.status',{sessionID:'one',status:{type:'idle'}})
    await assert.rejects(f.observe(control),/STEERING_RECOVERY_SUPPRESSED/)
    // The short signed-key record expires after 30 seconds, independently of the 5s permit.
    mock.timers.tick(30001)
    const calls=f.sdk.length; await f.observe(control); assert.equal(f.sdk.length,calls)
    await f.save(f.user('manual','real user')); await f.prepare(f.a,[f.task]); await f.call(f.a,'new')
  } finally { mock.timers.reset() }
})

test('R4/A3/A4 recovery control stores only the guidance reference and first transform gets one temporary reminder', async () => {
  const f = await running()
  const guide = await f.save(f.user('m02', 'latest guidance', [{ type: 'file', url: 'data:text/plain,attachment' }]))
  const original = structuredClone(guide)
  await finish(f)
  await until(() => f.controls.length === 1)
  const control = f.user('control')
  control.parts = f.controls[0].body.parts
  assert.ok(!JSON.stringify(control.parts).includes('[Steering reminder]'))
  assert.ok(control.parts[0].text.includes(guide.info.id))
  assert.ok(!control.parts[0].text.includes('latest guidance'))
  await f.save(control)
  const first = await f.prepare(f.a, [f.task, guide, control])
  assert.equal(JSON.stringify(first).split('[Steering reminder]').length - 1, 1)
  assert.deepEqual(guide, original)
  assert.ok(!JSON.stringify(f.sessions.one).includes('[Steering reminder]'))
  assert.equal((await f.status()).recovery, false)
  await f.call(f.a, 'current-tool')
  const second = await f.prepare(f.a, [f.task, guide, control])
  assert.ok(!JSON.stringify(second).includes('[Steering reminder]'))
  await f.call(f.a, 'next-tool')
  assert.equal(f.reads.length, 1)
  await f.save(f.user('manual', 'next ordinary input'))
  await f.prepare(f.a)
  await f.call(f.a, 'manual-tool')
})

test('R4/A3 recovery candidates absent or ineffective at the first transform are consumed without later reminders', async () => {
  for (const mode of ['absent', 'empty', 'ignored', 'synthetic', 'wrong-role', 'new-id']) {
    const f = await running()
    const guide = await f.save(f.user('m02', 'latest guidance'))
    await finish(f)
    await until(() => f.controls.length === 1)
    const changed = structuredClone(guide)
    if (mode === 'empty') changed.parts[0].text = ' '
    if (mode === 'ignored') changed.parts[0].ignored = true
    if (mode === 'synthetic') changed.parts[0].synthetic = true
    if (mode === 'wrong-role') changed.info.role = 'assistant'
    if (mode === 'new-id') changed.info.id = 'replayed-id'
    const first = await f.prepare(f.a, mode === 'absent' ? [f.task] : [f.task, changed])
    assert.ok(!JSON.stringify(first).includes('[Steering reminder]'), mode)
    assert.equal((await f.status()).recovery, false)
    await f.call(f.a, mode)
    const restored = await f.prepare(f.a, [f.task, guide])
    assert.ok(!JSON.stringify(restored).includes('[Steering reminder]'), mode)
    assert.equal(f.reads.length, 1)
    await f.save(f.user('manual', 'continue normally'))
    await f.prepare(f.a)
    await f.call(f.a, 'manual-' + mode)
  }
})

test('R4/A3 cancelled, expired, edited, unknown and summary candidates cannot transfer a reminder', async () => {
  const { mock } = await import('node:test')
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    for (const mode of ['cancelled', 'expired', 'edited', 'new-input', 'unknown', 'summary']) {
      const f = await running()
      const guide = await f.save(f.user('m02', 'latest guidance'))
      await finish(f)
      mock.timers.tick(75)
      for (let i = 0; i < 12; i++) await Promise.resolve()
      assert.equal(f.controls.length, 1)
      let target = f
      if (mode === 'cancelled') await f.event('session.status', { sessionID: 'one', status: { type: 'idle' } })
      if (mode === 'expired') mock.timers.tick(5001)
      if (mode === 'edited') await f.event('message.part.updated', { part: { ...guide.parts[0], text: '' } })
      if (mode === 'new-input') await f.save(f.user('manual', 'new ordinary input'))
      if (mode === 'unknown') target = await fixture()
      if (mode === 'summary') await f.hooks['experimental.session.compacting']({ sessionID: 'one' }, {})
      const prepared = await target.prepare(f.a, [f.task, guide])
      assert.ok(!JSON.stringify(prepared).includes('[Steering reminder]'), mode)
      await target.call(f.a, 'allowed-' + mode)
      assert.ok(!JSON.stringify(await target.prepare(f.a, [f.task, guide])).includes('[Steering reminder]'), mode)
    }
  } finally { mock.timers.reset() }
})

test('A8 production effective lines <=200 using TypeScript AST type removal and comment scanner', async () => {
  const ts=await import('typescript/unstable/ast')
  const {API}=await import('typescript/unstable/sync')
  const {fileURLToPath}=await import('node:url')
  const api=new API(); const snapshot=api.updateSnapshot({openProjects:[fileURLToPath(new URL('../../../tsconfig.json',import.meta.url))]})
  const project=snapshot.getProjects()[0]
  const {readFile}=await import('node:fs/promises')
  let count=0
  for(const file of ['state.ts','index.ts']) {
    let source=await readFile(new URL('../src/'+file,import.meta.url),'utf8')
    const ast=project.program.getSourceFile(fileURLToPath(new URL('../src/'+file,import.meta.url)))
    const spans=[]
    const visit=node=>{
      if(ts.isTypeAliasDeclaration(node)||ts.isInterfaceDeclaration(node)||ts.isImportDeclaration(node)&&node.importClause?.isTypeOnly) spans.push([node.getStart(ast),node.end])
      else node.forEachChild(visit)
    }
    visit(ast)
    for(const [start,end] of spans.reverse()) source=source.slice(0,start)+source.slice(start,end).replace(/[^\n]/g,' ')+source.slice(end)
    const scanner=ts.createScanner(false,ts.LanguageVariant.Standard,source)
    const comments=[]
    for(let token=scanner.scan();token!==ts.SyntaxKind.EndOfFile;token=scanner.scan())
      if([ts.SyntaxKind.SingleLineCommentTrivia,ts.SyntaxKind.MultiLineCommentTrivia].includes(token)) comments.push([scanner.getTokenStart(),scanner.getTokenEnd()])
    for(const [start,end] of comments.reverse()) source=source.slice(0,start)+source.slice(start,end).replace(/[^\n]/g,' ')+source.slice(end)
    const lines=source.split('\n').filter(l=>l.trim()).length; count+=lines
    console.log(file+': '+lines+' effective lines')
  }
  snapshot.dispose(); api.close()
  assert.ok(count<=200,`effective production lines: ${count}`)
})
