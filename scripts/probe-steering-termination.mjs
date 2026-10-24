// Negative capability probe: exit 0 means the pinned kernel reproduced a delivery gap.
// This is NOT a passing steering feature test and uses a deterministic provider.
import http from 'node:http'
import assert from 'node:assert/strict'
import {writeFile,readFile,mkdir,mkdtemp} from 'node:fs/promises'
import {setTimeout as delay} from 'node:timers/promises'
import {startKernel,root} from './lib/kernel-lab.mjs'
await mkdir(root+'/.codeagent',{recursive:true})
const evidence=await mkdtemp(root+'/.codeagent/steering-termination-')
let held;const requests=[]
const provider=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;requests.push(JSON.parse(raw));held=res})
await new Promise(r=>provider.listen(0,'127.0.0.1',r))
const log=evidence+'/events.jsonl';await writeFile(log,'')
let lab
try{
 lab=await startKernel({config:{plugin:[[root+'/test/steering/fixtures/public-api-probe.ts',{gate:true,log}]],provider:{probe:{npm:'@ai-sdk/openai-compatible',name:'Protocol fixture',options:{apiKey:'test',baseURL:'http://127.0.0.1:'+provider.address().port+'/v1'},models:{probe:{name:'probe',tool_call:true,limit:{context:32000,output:1000}}}}},agent:{title:{disable:true},summary:{disable:true}}}})
 await lab.request('/experimental/tool/ids')
 const session=await lab.request('/session',{title:'Structured-output steering boundary',permission:[{permission:'*',pattern:'*',action:'allow'}]})
 const prompt=text=>({model:{providerID:'probe',modelID:'probe'},parts:[{type:'text',text}]})
 await lab.request('/session/'+session.id+'/prompt_async',{...prompt('Return structured completion.'),format:{type:'json_schema',schema:{type:'object',properties:{done:{type:'boolean'}},required:['done'],additionalProperties:false}}})
 await until(()=>held)
 assert.ok(requests[0].tools.some(t=>t.function.name==='StructuredOutput'))
 await lab.request('/session/'+session.id+'/prompt_async',prompt('BOUNDARY_STEERING: change the requested result before finishing.'))
 await until(async()=>(await lab.request('/session/'+session.id+'/message')).filter(m=>m.info.role==='user').length===2)
 held.writeHead(200,{'content-type':'text/event-stream'})
 const frame=(delta,finish_reason)=>({id:'boundary',object:'chat.completion.chunk',created:1,model:'probe',choices:[{index:0,delta,finish_reason}]})
 held.write('data: '+JSON.stringify(frame({role:'assistant',tool_calls:[{index:0,id:'structured',type:'function',function:{name:'StructuredOutput',arguments:'{"done":true}'}}]},null))+'\n\n')
 held.end('data: '+JSON.stringify(frame({},'tool_calls'))+'\n\ndata: [DONE]\n\n')
 await until(async()=>{const s=await lab.request('/session/status');return !s[session.id]||s[session.id].type==='idle'})
 await delay(500)
 const messages=await lab.request('/session/'+session.id+'/message')
 assert.equal(requests.length,1)
 assert.equal(messages.filter(m=>m.info.role==='user').length,2)
 assert.ok(messages.some(m=>m.info.structured?.done===true))
 const report={kernel:'517e6c9aa4c61dbc125e7654fc596f1d529f20d9',fixture:lab.fixture,session:session.id,provider:'deterministic wire fixture',providerRequests:requests.length,userMessages:2,conclusion:'Concurrent guidance persisted, but structured completion ended the loop without another model request.',events: (await readFile(log,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse),requests,messages}
 await writeFile(evidence+'/report.json',JSON.stringify(report,null,2))
 console.log(JSON.stringify({evidence: evidence+'/report.json',fixture:lab.fixture,providerRequests:1,userMessages:2,conclusion:report.conclusion}))
}finally{held?.destroy();provider.closeAllConnections();await new Promise(r=>provider.close(r));if(lab)await lab.stop()}
async function until(check){const end=Date.now()+30000;while(Date.now()<end){if(await check())return;await delay(50)}throw Error('boundary probe timed out')}
