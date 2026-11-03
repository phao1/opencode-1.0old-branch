import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { callRealModel, sendModelResponse } from './lib/model-relay.mjs'
import { DatabaseSync } from 'node:sqlite'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const evidence=path.resolve(process.env.PACKAGE_STEERING_EVIDENCE??path.join(root,'.codeagent/package-real-steering-20261028'))
const bundle=path.resolve(process.argv[2]??path.join(evidence,'installed/Mac 包测试/codeagent-opencode-darwin-arm64'))
const python=process.env.PYTHON_BINARY??'python3'
if(process.env.STEERING_PROVIDER_COMMAND)throw new Error('Custom provider commands have unverified provenance; use the actual CODEX_BINARY CLI for real-model acceptance')
await mkdir(evidence,{recursive:true})
const build=JSON.parse(await readFile(path.join(bundle,'BUILD.json'),'utf8'))
assert.equal(build.kernelCommit,'517e6c9aa4c61dbc125e7654fc596f1d529f20d9')
assert.equal(build.nativeLauncher,true)
const manifest=(await readFile(path.join(bundle,'SHA256SUMS'),'utf8')).trim().split('\n')
for(const line of manifest){const [hash,file]=line.split('  ');assert.equal(createHash('sha256').update(await readFile(path.join(bundle,file))).digest('hex'),hash,file)}
const reports=[]
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve}}
async function until(check,label,{timeout=120000,failures=[]}={}){
 const end=Date.now()+timeout
 while(Date.now()<end){if(failures.length)throw failures[0];if(await check())return;await delay(80)}
 throw new Error('Timed out: '+label)
}
async function availablePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p}
async function readState(directory,id){
 for(const entry of await readdir(directory,{withFileTypes:true}).catch(()=>[])){
  const file=path.join(directory,entry.name)
  if(entry.isDirectory()){const v=await readState(file,id);if(v)return v}
  else if(entry.name.endsWith('.json')){try{const v=JSON.parse(await readFile(file,'utf8'));if(v.sessionID===id)return v}catch{}}
 }
}
async function createLab(name,holdAt,{gate=true}={}){
 const dir=path.join(evidence,name),project=path.join(dir,'project'),profile=path.join(dir,'profile')
 await mkdir(project,{recursive:true})
 const requests=[],decisions=[],failures=[],release=deferred(),held=deferred()
 const provider=http.createServer(async(req,res)=>{
  try{
   let raw='';for await(const chunk of req)raw+=chunk
   const body=JSON.parse(raw),number=requests.push(body)
   if(number>9)throw new Error('Real-model request cap exceeded')
   const folder=path.join(dir,'model-'+number)
   await mkdir(folder,{recursive:true})
   const result=await callRealModel(body,folder,{timeout:120000})
   decisions.push({number,result})
   console.log(JSON.stringify({case:name,providerRequest:number,realModel:true,kind:result.kind,tool:result.tool_name}))
   if(number===holdAt){held.resolve(result);await release.promise}
   if(!res.destroyed)sendModelResponse(res,result,number)
  }catch(error){failures.push(error);if(!res.headersSent)res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}))}
 })
 await new Promise(r=>provider.listen(0,'127.0.0.1',r))
 const port=await availablePort(),url=`http://127.0.0.1:${port}`
 const config={model:'real/codex-default',small_model:'real/codex-default',default_agent:'verification',
  enabled_providers:['real'],provider:{real:{npm:'@ai-sdk/openai-compatible',name:'Real Codex CLI relay',options:{apiKey:'local-test',baseURL:`http://127.0.0.1:${provider.address().port}/v1`},models:{'codex-default':{name:'Codex CLI default (real)',tool_call:true,limit:{context:128000,output:3000}}}}},
  agent:{title:{disable:true},summary:{disable:true},verification:{mode:'primary',permission:{'*':'deny',bash:'allow',steering_status:'allow'}}},compaction:{auto:false}}
 const env={...process.env}
 for(const key of Object.keys(env))if(key.startsWith('OPENCODE_'))delete env[key]
 Object.assign(env,{TERM:'xterm-256color',TERM_PROGRAM:'Apple_Terminal',OPENCODE_CONFIG_CONTENT:JSON.stringify(config),
  OPENCODE_DISABLE_MODELS_FETCH:'true',OPENCODE_TEST_HOME:path.join(profile,'home'),XDG_CONFIG_HOME:path.join(profile,'config'),XDG_DATA_HOME:path.join(profile,'data'),XDG_CACHE_HOME:path.join(profile,'cache'),XDG_STATE_HOME:path.join(profile,'state'),CODEAGENT_LAUNCH_LOG:path.join(dir,'launch.json')})
 if(!gate)env.OPENCODE_PURE='true'
 // Register tools against the actual extracted package in server mode, then
 // stop that server. Ordinary TUI testing uses its normal in-process RPC path.
 // The pinned kernel's optional external-port TUI path stalls before rendering;
 // never replace a successful HTTP test with a claim about user TUI behavior.
 const server=spawn(path.join(bundle,'opencode'),['--project',project,'serve','--port',String(port),'--hostname','127.0.0.1'],{env,stdio:['ignore','pipe','pipe']})
 let serverLog='';server.stdout.on('data',c=>serverLog+=c);server.stderr.on('data',c=>serverLog+=c)
 async function request(route,body){
  const response=await fetch(url+route+(route.includes('?')?'&':'?')+'directory='+encodeURIComponent(project),{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)})
  const text=await response.text();assert.ok(response.ok,route+': '+response.status+' '+text.slice(0,200));return text?JSON.parse(text):undefined
 }
 let registration
 try{
  await until(async()=>{try{return(await request('/global/health')).healthy}catch{return false}},name+' package server',{timeout:60000,failures})
  const tools=await request('/experimental/tool/ids'),skills=await request('/skill'),commands=await request('/command')
  if(gate){
   for(const tool of ['one_shot_issue','one_shot_start','one_shot_status','one_shot_cancel','steering_status'])assert.ok(tools.includes(tool),tool)
   for(const skill of ['one-shot','external-plugin-dev','create-issue'])assert.ok(skills.some(s=>s.name===skill),skill)
  }else assert.ok(!tools.includes('steering_status'),'The real baseline must disable external plugin loading')
  registration={tools:tools.filter(t=>t.startsWith('one_shot_')||t==='steering_status'),skills:skills.map(s=>s.name),commands:commands.map(c=>c.name)}
  await writeFile(path.join(dir,'registration.json'),JSON.stringify(registration,null,2))
 }catch(error){provider.closeAllConnections();await new Promise(r=>provider.close(r));throw error
 }finally{
  server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),1500)
  await new Promise(r=>server.once('close',r));clearTimeout(timer)
  await writeFile(path.join(dir,'package-server.log'),serverLog)
 }
 const database=path.join(profile,'data/opencode/opencode-codeagent-test.db')
 function sql(query,...values){const db=new DatabaseSync(database,{readOnly:true});try{return db.prepare(query).all(...values)}finally{db.close()}}
 async function savedMessages(id){
  return sql('select * from message where session_id=? order by time_created,id',id).map(row=>({
   info:{...JSON.parse(row.data),id:row.id,sessionID:row.session_id},
   parts:sql('select * from part where message_id=? order by time_created,id',row.id).map(p=>({...JSON.parse(p.data),id:p.id,messageID:p.message_id,sessionID:p.session_id})),
  }))
 }
 const p=spawn(python,[path.join(root,'scripts/lib/packaged-tui.py'),path.join(bundle,'opencode'),project,'none',path.join(dir,'tui.ansi')],{cwd:root,env,stdio:['pipe','pipe','pipe']})
 let output='',lineBuffer='',stderr='',exitEvent,serial=0
 const acknowledgements=new Map(),exited=new Promise(r=>p.once('close',r))
 p.stdout.on('data',chunk=>{
  lineBuffer+=chunk
  while(lineBuffer.includes('\n')){
   const at=lineBuffer.indexOf('\n'),line=lineBuffer.slice(0,at);lineBuffer=lineBuffer.slice(at+1)
   try{const event=JSON.parse(line);if(event.type==='screen')output=(output+Buffer.from(event.data,'base64').toString()).slice(-2000000)
    else if(event.type==='ack'){acknowledgements.get(event.id)?.();acknowledgements.delete(event.id)}else if(event.type==='exit')exitEvent=event
   }catch(error){failures.push(error)}
  }
 })
 p.stderr.on('data',chunk=>stderr+=chunk)
 p.on('error',error=>failures.push(error))
 async function control(value){const id=++serial;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('PTY control timeout')),10000);acknowledgements.set(id,()=>{clearTimeout(timer);resolve()});p.stdin.write(JSON.stringify({...value,id})+'\n')})}
 async function keys(text){await control({type:'keys',text})}
 async function submit(text){await keys('\x1b[200~'+text+'\x1b[201~');await delay(150);await keys('\r')}
 async function stop(){
  release.resolve()
  if(p.exitCode===null){try{await keys('\x03');await delay(300);await keys('\x03')}catch{}}
  await Promise.race([exited,delay(4000)])
  if(p.exitCode===null){p.kill('SIGTERM');await Promise.race([exited,delay(4000)])}
  if(p.exitCode===null){p.kill('SIGKILL');await exited}
  provider.closeAllConnections();await new Promise(r=>provider.close(r))
  await writeFile(path.join(dir,'helper-stderr.log'),stderr)
  await writeFile(path.join(dir,'decisions.json'),JSON.stringify(decisions,null,2))
 }
 try{
  await until(()=>output.includes('Ask anything'),name+' TUI home',{timeout:30000,failures})
  return {dir,project,profile,requests,decisions,failures,held,release,keys,submit,request,stop,control,registration,
   get output(){return output},get exitEvent(){return exitEvent},
   async session(){let id;await until(()=>{id=sql('select id from session where directory=? order by time_created desc',project)[0]?.id;return !!id},name+' TUI session',{failures});return id},
   messages:savedMessages,
   state(id){return readState(path.join(profile,'state/codeagent-steering'),id)},
   async idle(id){const state=await readState(path.join(profile,'state/codeagent-steering'),id);return state&&['idle','cancelled','failed'].includes(state.lifecycle)},
  }
 }catch(error){await stop();throw error}
}

async function steeringCase(){
 const lab=await createLab('real-tui-repeated-steering',2);let id
 try{
  await lab.submit('Perform this local file task using bash. In your first tool call write exactly KEEP to completed.txt. In a separate, later tool call write exactly OLD to old.txt. Never combine these two actions in one command. Then give a short completion. Use one bash call per step.')
  id=await lab.session()
  await until(()=>lab.decisions.some(d=>d.number===2),'real stale decision held',{failures:lab.failures})
  assert.equal(await readFile(path.join(lab.project,'completed.txt'),'utf8'),'KEEP')
  await lab.submit('steer: Change the remaining task: preserve completed.txt. Do not create old.txt. Instead write MIDDLE to intermediate.txt using bash.')
  await until(async()=>(await lab.messages(id)).filter(m=>m.info.role==='user').length===2,'first TUI guidance saved',{failures:lab.failures})
  await lab.submit('steer: Final correction: preserve completed.txt exactly. Do not create old.txt or intermediate.txt. Use bash to write exactly FINAL to final.txt, then call steering_status and briefly report completion.')
  await until(async()=>(await lab.messages(id)).filter(m=>m.info.role==='user').length===3,'second TUI guidance saved',{failures:lab.failures})
  const original=(await lab.messages(id)).filter(m=>m.info.role==='user')
  lab.release.resolve()
  await until(async()=>lab.requests.length>=4&&await lab.idle(id),'real revised execution',{timeout:420000,failures:lab.failures})
  assert.equal(await readFile(path.join(lab.project,'completed.txt'),'utf8'),'KEEP')
  assert.equal(await readFile(path.join(lab.project,'final.txt'),'utf8'),'FINAL')
  for(const file of ['old.txt','intermediate.txt'])await assert.rejects(stat(path.join(lab.project,file)),{code:'ENOENT'})
  const messages=await lab.messages(id),users=messages.filter(m=>m.info.role==='user')
  assert.equal(users.length,3)
  for(const user of original)assert.deepEqual(users.find(m=>m.info.id===user.info.id).parts,user.parts)
  const blocked=messages.flatMap(m=>m.parts).filter(p=>p.type==='tool'&&p.state?.status==='error'&&p.state?.error?.includes('STEERING_STALE_CONTEXT'))
  assert.ok(blocked.length>=1,'Actual stale native bash call was blocked')
  const next=JSON.stringify(lab.requests[2].messages);assert.ok(next.includes('MIDDLE')&&next.includes('FINAL'))
  const state=await lab.state(id);assert.ok(state)
  for(const message of state.messages){assert.equal(message.provider.status,'unknown');assert.equal(message.adopted.status,'unknown')}
  await writeFile(path.join(lab.dir,'messages.json'),JSON.stringify(messages,null,2))
  await writeFile(path.join(lab.dir,'ledger.json'),JSON.stringify(state,null,2))
  const marker=lab.output.length;await lab.keys('\x10');await delay(400);assert.ok(lab.output.slice(marker).includes('Commands'));await lab.keys('\x1b')
  await lab.control({type:'resize',rows:44,cols:136});await delay(400)
  return {name:'repeated-steering',passed:true,sessionID:id,evidence:lab.dir,realModelRequests:lab.requests.length,blockedTools:blocked.length,completedWorkPreserved:true,finalActionObserved:true,oldActionsAbsent:true,sameSession:true,originalMessagesUnchanged:true,keyboardMenu:true,registration:lab.registration}
 }finally{await lab.stop()}
}
async function cancelCase(){
 const lab=await createLab('real-tui-explicit-cancel',1)
 try{
  await lab.submit('Use bash to write exactly OLD to cancelled-old.txt, then finish.')
  const id=await lab.session();await until(()=>lab.decisions.length===1,'cancel held real decision',{failures:lab.failures})
  await lab.submit('steer: Instead write NEW to cancelled-new.txt using bash.')
  await until(async()=>(await lab.messages(id)).filter(m=>m.info.role==='user').length===2,'cancel guidance saved',{failures:lab.failures})
  await lab.keys('\x1b');await delay(120);await lab.keys('\x1b')
  await until(()=>lab.idle(id),'native TUI explicit interruption',{timeout:20000,failures:lab.failures})
  lab.release.resolve();await delay(2500)
  assert.equal(lab.requests.length,1,'Cancel must not automatically resume')
  for(const file of ['cancelled-old.txt','cancelled-new.txt'])await assert.rejects(stat(path.join(lab.project,file)),{code:'ENOENT'})
  const messages=await lab.messages(id),state=await lab.state(id)
  await writeFile(path.join(lab.dir,'messages.json'),JSON.stringify(messages,null,2))
  await writeFile(path.join(lab.dir,'ledger.json'),JSON.stringify(state,null,2))
  return {name:'explicit-cancel',passed:true,sessionID:id,evidence:lab.dir,realModelRequests:lab.requests.length,nativeTuiStop:true,noAutomaticResume:true,noSideEffects:true,lifecycle:state?.lifecycle}
 }finally{await lab.stop()}
}
async function completionCase(){
 const lab=await createLab('real-tui-completion-boundary',1)
 try{
  await lab.submit('Reply with exactly ORIGINAL_DONE. Do not call tools.')
  const id=await lab.session();await until(()=>lab.decisions.length===1,'completion held real answer',{failures:lab.failures})
  assert.equal(lab.decisions[0].result.kind,'text')
  await lab.submit('steer: Before finishing, use bash to write exactly RECOVERED to recovered.txt, then reply briefly.')
  await until(async()=>(await lab.messages(id)).filter(m=>m.info.role==='user').length===2,'late TUI guidance saved',{failures:lab.failures})
  lab.release.resolve()
  await until(async()=>lab.requests.length>=3&&await lab.idle(id),'real completion-boundary recovery',{timeout:420000,failures:lab.failures})
  assert.equal(await readFile(path.join(lab.project,'recovered.txt'),'utf8'),'RECOVERED')
  const messages=await lab.messages(id),state=await lab.state(id)
  assert.equal(messages.filter(m=>m.info.role==='user'&&m.parts.some(p=>p.type==='text'&&p.text.startsWith('steer:'))).length,1)
  await writeFile(path.join(lab.dir,'messages.json'),JSON.stringify(messages,null,2))
  await writeFile(path.join(lab.dir,'ledger.json'),JSON.stringify(state,null,2))
  const controls=messages.flatMap(m=>m.parts).filter(p=>p.synthetic&&p.metadata?.codeagentSteering?.plugin==='@oneshot/opencode-steering')
  return {name:'completion-boundary',passed:true,sessionID:id,evidence:lab.dir,realModelRequests:lab.requests.length,automaticContinuation:true,pluginRecoveryObserved:controls.length>0,syntheticRecoveryControls:controls.length,revisedActionObserved:true,guidanceNotDuplicated:true}
 }finally{await lab.stop()}
}
async function inFlightToolCase(){
 const lab=await createLab('real-tui-in-flight-tool',0)
 try{
  await lab.submit('Use bash for this local file task. Execute this command in one call: printf %s STARTED > in-flight.txt; sleep 6; printf %s DONE > completed-in-flight.txt. After that, in a separate later tool call, write OLD to old-after-tool.txt. Do not combine the later action with the first command. Then finish briefly.')
  const id=await lab.session()
  await until(async()=>{try{return(await readFile(path.join(lab.project,'in-flight.txt'),'utf8'))==='STARTED'}catch{return false}},'actual bash command in flight',{failures:lab.failures})
  await assert.rejects(stat(path.join(lab.project,'completed-in-flight.txt')),{code:'ENOENT'})
  await lab.submit('steer: Preserve the command already running and its completed file. Do not create old-after-tool.txt. After the current command finishes, use bash to write exactly NEW to after-flight.txt, then finish.')
  await until(async()=>(await lab.messages(id)).filter(m=>m.info.role==='user').length===2,'in-flight TUI guidance saved',{failures:lab.failures})
  const guidanceSavedAt=Date.now()
  await until(async()=>{try{return await lab.idle(id)&&(await readFile(path.join(lab.project,'after-flight.txt'),'utf8'))==='NEW'}catch{return false}},'natural next-step adoption',{timeout:420000,failures:lab.failures})
  assert.equal(await readFile(path.join(lab.project,'completed-in-flight.txt'),'utf8'),'DONE')
  const completedAt=(await stat(path.join(lab.project,'completed-in-flight.txt'))).mtimeMs
  assert.ok(guidanceSavedAt<completedAt,'Guidance was saved while the real command was still running')
  await assert.rejects(stat(path.join(lab.project,'old-after-tool.txt')),{code:'ENOENT'})
  assert.ok(lab.requests.slice(1).some(r=>JSON.stringify(r.messages).includes('After the current command finishes')))
  await writeFile(path.join(lab.dir,'messages.json'),JSON.stringify(await lab.messages(id),null,2))
  await writeFile(path.join(lab.dir,'ledger.json'),JSON.stringify(await lab.state(id),null,2))
  return{name:'in-flight-tool',passed:true,sessionID:id,evidence:lab.dir,realModelRequests:lab.requests.length,noResponseHeld:true,guidanceSavedDuringActualTool:true,currentCommandCompleted:true,nextActionRevised:true,oldActionAbsent:true,guidanceSavedAt,completedAt}
 }finally{await lab.stop()}
}
async function baselineCase(){
 const lab=await createLab('real-tui-baseline-without-plugin',2,{gate:false})
 try{
  await lab.submit('Perform this local file task using bash. In your first tool call write exactly KEEP to completed.txt. In a separate, later tool call write exactly OLD to old.txt. Never combine these two actions in one command. Then give a short completion. Use one bash call per step.')
  const id=await lab.session();await until(()=>lab.decisions.some(d=>d.number===2),'baseline stale real decision held',{failures:lab.failures})
  assert.equal(await readFile(path.join(lab.project,'completed.txt'),'utf8'),'KEEP')
  await lab.submit('steer: Change the remaining task: preserve completed.txt. Do not create old.txt. Instead write MIDDLE to intermediate.txt using bash.')
  await until(async()=>(await lab.messages(id)).filter(m=>m.info.role==='user').length===2,'baseline first input saved',{failures:lab.failures})
  await lab.submit('steer: Final correction: preserve completed.txt exactly. Do not create old.txt or intermediate.txt. Use bash to write exactly FINAL to final.txt, then briefly report completion.')
  await until(async()=>(await lab.messages(id)).filter(m=>m.info.role==='user').length===3,'baseline final input saved',{failures:lab.failures})
  lab.release.resolve()
  await until(async()=>{try{return lab.decisions.at(-1)?.result.kind==='text'&&(await lab.messages(id)).filter(m=>m.info.role==='assistant').at(-1)?.info.time?.completed&&(await readFile(path.join(lab.project,'final.txt'),'utf8'))==='FINAL'}catch{return false}},'baseline natural adoption after stale action',{timeout:420000,failures:lab.failures})
  assert.equal(await readFile(path.join(lab.project,'old.txt'),'utf8'),'OLD','Without the plugin the already-generated old action really executes')
  const messages=await lab.messages(id)
  assert.ok(!messages.flatMap(m=>m.parts).some(p=>p.state?.error?.includes('STEERING_STALE_CONTEXT')))
  await writeFile(path.join(lab.dir,'messages.json'),JSON.stringify(messages,null,2))
  return{name:'baseline-without-plugin',passed:true,sessionID:id,evidence:lab.dir,realModelRequests:lab.requests.length,externalPluginsDisabled:true,oldActionReallyExecuted:true,nativeEventuallyAdoptedGuidance:true,expectedControlOutcome:true}
 }finally{await lab.stop()}
}

let failed=false
const allCases={steering:steeringCase,cancel:cancelCase,completion:completionCase,'in-flight-tool':inFlightToolCase,baseline:baselineCase}
const selected=process.argv.find(x=>x.startsWith('--case='))?.slice(7)
const cases=selected?[allCases[selected]]:Object.values(allCases)
assert.ok(cases.every(Boolean),'Unknown --case')
for(const run of cases){
 try{const result=await run();reports.push(result);console.log(JSON.stringify(result))}
 catch(error){failed=true;reports.push({name:run.name,passed:false,error:error.stack});console.log(JSON.stringify({case:run.name,passed:false,error:error.message}))}
  await writeFile(path.join(evidence,'packaged-steering-report.json'),JSON.stringify({bundle,build,manifestFilesVerified:manifest.length,provider:'Real Codex CLI relay (not OpenCode Zen and not a deterministic model)',input:'Keys and bracketed paste through the actual native TUI',observation:'Read-only native SQLite messages, real provider payloads, filesystem effects and plugin ledger; separate server mode verifies registration',reports,passed:!failed&&reports.length===cases.length},null,2))
}
if(failed)process.exitCode=1
