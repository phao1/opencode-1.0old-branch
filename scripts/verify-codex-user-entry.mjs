import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const evidence=path.join(root,'.codeagent/codex-user-entry-20261028')
const artifact=JSON.parse(await readFile(path.join(evidence,'artifact.json'),'utf8'))
const dir=path.join(evidence,'real-entry'),project=path.join(dir,'project'),profile=path.join(dir,'profile')
await mkdir(project,{recursive:true})
const before=(await readdir(tmpdir())).filter(s=>s.startsWith('opencode-codex-request-'))
const env={...process.env,PATH:'/usr/bin:/bin:/usr/sbin:/sbin',TERM:'xterm-256color',TERM_PROGRAM:'Apple_Terminal',
 OPENCODE_DISABLE_MODELS_FETCH:'true',OPENCODE_TEST_HOME:path.join(profile,'home'),XDG_CONFIG_HOME:path.join(profile,'config'),XDG_DATA_HOME:path.join(profile,'data'),XDG_CACHE_HOME:path.join(profile,'cache'),XDG_STATE_HOME:path.join(profile,'state'),CODEAGENT_LAUNCH_LOG:path.join(dir,'launch.json'),CODEAGENT_BRIDGE_DIAGNOSTICS:path.join(dir,'bridge.json')}
for(const key of ['NODE_BINARY','BUN_BINARY','CODEX_BINARY','CODEAGENT_BUNDLE','OPENCODE_CONFIG_CONTENT'])delete env[key]
const executable=path.join(artifact.bundle,'使用Codex模型启动.command')
const child=spawn('/Users/penghao/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3',
 [path.join(root,'scripts/lib/packaged-tui.py'),executable,project,'none',path.join(dir,'tui.ansi')],{env,stdio:['pipe','pipe','pipe']})
let buffered='',screen='',stderr='',next=0,exitEvent
const acks=new Map(),ended=new Promise(r=>child.once('close',r))
child.stdout.on('data',chunk=>{buffered+=chunk;while(buffered.includes('\n')){const at=buffered.indexOf('\n'),event=JSON.parse(buffered.slice(0,at));buffered=buffered.slice(at+1)
 if(event.type==='screen')screen+=Buffer.from(event.data,'base64').toString()
 else if(event.type==='ack'){acks.get(event.id)?.();acks.delete(event.id)}else if(event.type==='exit')exitEvent=event
}})
child.stderr.on('data',chunk=>stderr+=chunk)
async function keys(text){const id=++next;await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Entry input timeout')),10000);acks.set(id,()=>{clearTimeout(t);resolve()});child.stdin.write(JSON.stringify({type:'keys',id,text})+'\n')})}
async function submit(text){await keys('\x1b[200~'+text+'\x1b[201~');await delay(150);await keys('\r')}
async function until(check,label,timeout=180000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;if(child.exitCode!==null)throw new Error('Launcher exited before '+label+'; '+stderr.slice(-1000));await delay(100)}throw new Error('Timed out: '+label)}
const dbfile=path.join(profile,'data/opencode/opencode-codeagent-test.db')
function rows(query,...values){const db=new DatabaseSync(dbfile,{readOnly:true});try{return db.prepare(query).all(...values)}finally{db.close()}}
function messages(id){return rows('select * from message where session_id=? order by time_created,id',id).map(m=>({info:{...JSON.parse(m.data),id:m.id},parts:rows('select * from part where message_id=? order by time_created,id',m.id).map(p=>({...JSON.parse(p.data),id:p.id}))}))}
let id,passed=false
try{
 await until(()=>screen.includes('Ask anything')&&screen.includes('Codex CLI'),'Codex model TUI',45000)
 console.log(JSON.stringify({home:true,codexModelVisible:true,entry:executable}))
 await submit('只回复 CODEX_USER_ENTRY_OK，不要调用任何工具。')
 await until(()=>{id=rows('select id from session where directory=? order by time_created desc',project)[0]?.id;return !!id},'native session')
 await until(()=>messages(id).some(m=>m.info.role==='assistant'&&m.info.time?.completed&&m.parts.some(p=>p.type==='text'&&p.text.includes('CODEX_USER_ENTRY_OK'))),'real text reply')
 console.log(JSON.stringify({realTextReply:true,sessionID:id}))
 await submit('请使用 bash 执行 printf %s CODEX_CLI_BRIDGE_OK > codex-bridge-result.txt，然后调用 steering_status，最后简短回复完成。')
 await until(async()=>{try{return(await readFile(path.join(project,'codex-bridge-result.txt'),'utf8'))==='CODEX_CLI_BRIDGE_OK'&&messages(id).some(m=>m.parts.some(p=>p.type==='tool'&&p.tool==='steering_status'&&p.state?.status==='completed'))&&messages(id).filter(m=>m.info.role==='assistant').at(-1)?.info.time?.completed}catch{return false}},'real OpenCode bash and steering tool',360000)
 const all=messages(id),parts=all.flatMap(m=>m.parts)
 assert.ok(parts.some(p=>p.type==='tool'&&p.tool==='bash'&&p.state?.status==='completed'))
 assert.equal(all.filter(m=>m.info.role==='user').length,2)
 await writeFile(path.join(dir,'messages.json'),JSON.stringify(all,null,2))
 passed=true
}finally{
 if(child.exitCode===null){try{await keys('\x03');await delay(350);if(child.exitCode===null)await keys('\x03')}catch{}}
 await Promise.race([ended,delay(5000)])
 if(child.exitCode===null){child.kill('SIGTERM');await ended}
 await writeFile(path.join(dir,'helper-stderr.log'),stderr)
}
const bridge=JSON.parse(await readFile(path.join(dir,'bridge.json'),'utf8'))
assert.equal(bridge.cliExecutable,'/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex')
assert.equal(bridge.stats.active,0);assert.equal(bridge.stats.failed,0);assert.ok(bridge.stats.completed>=3);assert.ok(bridge.stats.usage.input_tokens>0)
await assert.rejects(fetch(bridge.endpoint+'/models',{signal:AbortSignal.timeout(800)}))
const after=(await readdir(tmpdir())).filter(s=>s.startsWith('opencode-codex-request-'));assert.deepEqual(after.sort(),before.sort())
const report={passed,artifact,entry:executable,model:'Existing Codex CLI default',homeVisible:true,realTextReply:true,realBashFile:'codex-bridge-result.txt=CODEX_CLI_BRIDGE_OK',realSteeringStatus:true,sessionID:id,bridge,exitEvent,localServiceClosed:true,temporaryRequestsRemoved:true,sourceCheckoutUsedAsRuntime:false,finderClickObserved:false}
await writeFile(path.join(evidence,'real-entry-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed,realCliCalls:bridge.stats.completed,realTextReply:true,realBash:true,realSteeringStatus:true,localServiceClosed:true}))
