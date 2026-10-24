// Public-hook timing probe: native IDs, delayed persistence, and synthetic-control recovery.
import http from 'node:http'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { startKernel, root } from './lib/kernel-lab.mjs'

await mkdir(root + '/.codeagent', { recursive: true })
const evidence = await mkdtemp(root + '/.codeagent/steering-late-save-')
const requests = [], responses = [], barriers = new Map(), events = []
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const p of req) raw += p
  if (req.url.startsWith('/barrier/')) { barriers.set(req.url.split('/').at(-1), res); return }
  if (req.url === '/event') { events.push(JSON.parse(raw)); res.end('{}'); return }
  requests.push(JSON.parse(raw)); responses.push(res)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}`
const plugin = evidence + '/probe.ts'
await writeFile(plugin, `export default async ({client,directory}) => {
 let compacting=false
 const log=event=>fetch(${JSON.stringify(url + '/event')},{method:'POST',body:JSON.stringify(event)})
 return {
  async 'chat.message'(input,output) {
   if(input.messageID && output.parts.length===0) {
    const saved=await client.session.message({path:{id:input.sessionID,messageID:input.messageID},query:{directory}})
    if(saved.error||!saved.data) throw Error('original metadata unavailable')
    for(const k of Object.keys(output.message)) delete output.message[k]
    Object.assign(output.message,structuredClone(saved.data.info))
    await log({kind:'same-id-wake',id:input.messageID}); return
   }
   const text=output.parts.find(p=>p.type==='text'&&!p.synthetic)?.text||''
   const which=text.startsWith('LATE_TASK')?'task':text.startsWith('LATE_GUIDANCE')?'guide':undefined
   await log({kind:'chat.message',which,id:output.message.id})
   if(which) await fetch(${JSON.stringify(url + '/barrier/')}+which)
  },
  async 'experimental.session.compacting'(){compacting=true},
  async 'experimental.chat.messages.transform'(_,output) {
   if(compacting){compacting=false;await log({kind:'compaction-transform'});return}
   const sessionID=output.messages[0]?.info.sessionID
   if(!sessionID)return
   const all=await client.session.messages({path:{id:sessionID},query:{directory}})
   if(all.error||!all.data)throw Error('public messages query failed')
   const guide=all.data.find(m=>m.parts.some(p=>p.type==='text'&&p.text.startsWith('LATE_GUIDANCE')))
   if(guide&&!output.messages.some(m=>m.info.id===guide.info.id)) {
    output.messages.unshift(structuredClone(guide))
    await log({kind:'raw-guidance-restored',id:guide.info.id})
   }
   await log({kind:'normal-transform',ids:output.messages.map(m=>m.info.id)})
  },
  async 'tool.execute.before'(input){await log({kind:'tool-execute-before',...input})}
 }
}
`)
let lab, report
try {
  lab = await startKernel({plugin,config:{provider:{late:{npm:'@ai-sdk/openai-compatible',options:{apiKey:'fixture',baseURL:url+'/v1'},models:{late:{name:'late',tool_call:true,limit:{context:32000,output:1000}}}}},agent:{title:{disable:true},summary:{disable:true}}}})
  await lab.request('/experimental/tool/ids')
  const session=await lab.request('/session',{title:'Late persistence counterexample',permission:[{permission:'*',pattern:'*',action:'deny'}]})
  const route='/session/'+session.id, model={providerID:'late',modelID:'late'}
  await lab.request(route+'/prompt_async',{model,parts:[{type:'text',text:'LATE_TASK: finish with a short plain-text response.'}]})
  await until(()=>barriers.has('task'),'task public hook')
  await lab.request(route+'/prompt_async',{model,system:'original-guidance-system',variant:'fixture-variant',parts:[{type:'text',text:'LATE_GUIDANCE: replace the initial result with corrected-value.'},{type:'file',mime:'text/plain',filename:'original.txt',url:'data:text/plain;base64,cHJlc2VydmVkIGF0dGFjaG1lbnQ='}]})
  await until(()=>barriers.has('guide'),'guidance public hook')
  barriers.get('task').end('{}')
  await until(()=>requests.length===1,'initial normal request')
  assert.ok(!JSON.stringify(requests[0].messages).includes('LATE_GUIDANCE'))
  barriers.get('guide').end('{}')
  let before
  await until(async()=>{before=await lab.request(route+'/message');return before.filter(m=>m.info.role==='user').length===2},'guidance saved')
  const guide=before.find(m=>m.parts.some(p=>p.text?.startsWith('LATE_GUIDANCE')))
  const assistant=before.find(m=>m.info.role==='assistant')
  assert.ok(guide.info.id<assistant.info.id,'Native guide ID must predate normal assistant ID')
  finish(0,'Initial plain completion, without the late correction.')
  await idle(session.id);await delay(200)
  const ended=await lab.request(route+'/message')
  assert.equal(requests.length,1)
  const permissionBefore=(await lab.request(route)).permission
  await lab.request(route+'/prompt_async',{messageID:guide.info.id,parts:[],model:guide.info.model,agent:guide.info.agent,system:guide.info.system,variant:guide.info.variant})
  await until(()=>events.some(e=>e.kind==='same-id-wake'),'same-ID wake hook')
  await idle(session.id);await delay(300)
  const afterWake=await lab.request(route+'/message')
  assert.equal(requests.length,1,'Same-ID wake must reproduce the early exit before any model request')
  assert.deepEqual(afterWake.find(m=>m.info.id===guide.info.id),ended.find(m=>m.info.id===guide.info.id))
  assert.deepEqual((await lab.request(route)).permission,permissionBefore)
  const controlText='Resume processing the original pending guidance already saved in this session. This is a scheduling control record, not a new user instruction.'
  await lab.request(route+'/prompt_async',{model,parts:[{type:'text',synthetic:true,text:controlText}]})
  await until(()=>requests.length===2,'normal request after synthetic control')
  assert.ok(JSON.stringify(requests[1].messages).includes('LATE_GUIDANCE'))
  assert.ok(JSON.stringify(requests[1].messages).includes(controlText))
  finish(1,'Corrected-value received after synthetic control recovery.')
  await idle(session.id)
  const afterControl=await lab.request(route+'/message')
  for(const original of afterWake.filter(m=>m.info.role==='user')) assert.deepEqual(afterControl.find(m=>m.info.id===original.info.id),original)
  assert.deepEqual((await lab.request(route)).permission,permissionBefore)
  assert.equal(events.filter(e=>e.kind==='tool-execute-before').length,0)
  const added=afterControl.filter(m=>m.info.role==='user'&&!afterWake.some(old=>old.info.id===m.info.id))
  assert.equal(added.length,1)
  assert.ok(added.some(m=>m.parts.some(p=>p.type==='text'&&p.synthetic===true)))
  report={passed:true,kernel:'517e6c9aa4c61dbc125e7654fc596f1d529f20d9',fixture:lab.fixture,session:session.id,
    nativeIDs:true,guideID:guide.info.id,assistantID:assistant.info.id,counterexample:{lateSaveAfterNormalTransform:true,guideIDPredatesAssistant:true,normalStopRequests:1,sameIDWakeRequests:1},
    candidate:{publicRoute:'session.prompt_async with a distinct synthetic text control record',providerRequests:requests.length,originalUserCount:2,finalUserRoleRows:afterControl.filter(m=>m.info.role==='user').length,addedRows:added,originalUserInfoAndPartsUnchanged:true,permissionUnchanged:true,toolExecutions:0,originalGuidancePresentInActualNextRequest:true,rawGuidanceTransformRestorationEvents:events.filter(e=>e.kind==='raw-guidance-restored')},
    permissionBefore,events,requests,ended,afterWake,afterControl,
    limitations:['Deterministic provider, not model quality evidence.','Initial task hook and guidance hook barriers create a real concurrent preparation ordering; no custom IDs or private hooks used.','Candidate adds one synthetic continuation user-role record; it is not a zero-new-row resume and not a second copy of the original guidance.','No cancellation race, concurrent permission edit, compaction or replay-side-effect coverage.','Uses a feasibility fixture plugin, not the production installed steering package.']}
}catch(error){report={passed:false,error:error.stack,fixture:lab?.fixture,events,requests};process.exitCode=1}
finally{await writeFile(evidence+'/report.json',JSON.stringify(report,null,2));for(const r of responses)r.destroy();for(const r of barriers.values())r.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));if(lab)await lab.stop();console.log(JSON.stringify({report:evidence+'/report.json',passed:report.passed,counterexample:report.counterexample,candidate:report.candidate&&{providerRequests:report.candidate.providerRequests,finalUserRoleRows:report.candidate.finalUserRoleRows,originalUserInfoAndPartsUnchanged:report.candidate.originalUserInfoAndPartsUnchanged,permissionUnchanged:report.candidate.permissionUnchanged},error:report.error}))}
async function until(check,label){const end=Date.now()+25000;while(Date.now()<end){if(await check())return;await delay(30)}throw Error('Timeout: '+label)}
async function idle(session){await until(async()=>{const s=await lab.request('/session/status');return !s[session]||s[session].type==='idle'},'idle')}
function finish(i,text){const frame=(delta,finish_reason)=>({id:'late-'+i,object:'chat.completion.chunk',created:1,model:'late',choices:[{index:0,delta,finish_reason}]});responses[i].writeHead(200,{'content-type':'text/event-stream'});responses[i].write('data: '+JSON.stringify(frame({role:'assistant',content:text},null))+'\n\n');responses[i].end('data: '+JSON.stringify(frame({},'stop'))+'\n\ndata: [DONE]\n\n')}
