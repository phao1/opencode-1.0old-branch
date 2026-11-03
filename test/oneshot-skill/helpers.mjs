import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const cli = fileURLToPath(new URL('../../.agents/skills/one-shot/scripts/oneshot.mjs', import.meta.url));
export const design = '# Design\n\n版本：v1.0\n\n## 目标与范围\n测试\n## 验收标准\nA1 输出可用\n## 关键决策\n最小实现\n## 实施计划\n生成一个文件\n## 验证命令\nnode --version\n## 变更记录\nv1 初版\n';
export function fixture(t, specs = [['one', 'ok', 0]]) {
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oneshot-test-')));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const fake = path.join(cwd, 'fake-agent.mjs');
  fs.writeFileSync(fake, `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const args=process.argv.slice(2);
const root=${JSON.stringify(cwd)};
const capture=path.join(root,'calls.jsonl');
const record=x=>fs.appendFileSync(capture,JSON.stringify(x)+'\\n');
if(args[0]==='exec') {
 let input=''; for await(const chunk of process.stdin) input+=chunk;
 record({args,input,cwd:process.cwd(),pid:process.pid});
 const out=args[args.indexOf('-o')+1];
 if(fs.existsSync(path.join(root,'generator-sleep')) && out.includes('/impl/')) {
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  fs.writeFileSync(path.join(root,'generator.child.pid'),String(child.pid));
  await new Promise(r=>setTimeout(r,60000));
 }
 if(fs.existsSync(path.join(root,'host-sleep')) && !args.includes('-m')) await new Promise(r=>setTimeout(r,800));
 console.log(JSON.stringify({type:'thread.started',thread_id:'test-thread-123'}));
 fs.mkdirSync(path.dirname(out),{recursive:true});
 const prompt=input.match(/读取并执行 (.+) 中的指令/);
 const probe=prompt && fs.existsSync(prompt[1]) && fs.readFileSync(prompt[1],'utf8').includes('仅回复 PONG');
 fs.writeFileSync(out,probe?'PONG\\n':'Generator report\\n');
 console.log(JSON.stringify({type:'turn.completed'}));
 process.exit(0);
}
const [prompt,mode,id,delay]=args;
if(prompt.includes('oneshot-probe-')) {
 if(mode==='auth') console.log('Not logged in. Authentication required MISSING_CREDENTIAL PONG');
 else if(mode==='nopong') console.log('hello');
 else console.log('PONG');
 process.exit(0);
}
record({id,mode,pid:process.pid,at:Date.now()});
if(mode==='hang') {
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
 fs.writeFileSync(path.join(root,id+'.child.pid'),String(child.pid));
 setInterval(()=>{},1000);
} else {
 await new Promise(r=>setTimeout(r,Number(delay)));
 if(mode==='fail') {console.error('deliberate failure');process.exit(7);}
 if(mode!=='empty') console.log('- [P2] suggestion '+id+' (evidence: DESIGN.md:1)');
}
`);
  fs.chmodSync(fake, 0o755);
  const config = { probeTimeoutSeconds: 10, cacheTTLHours: 6, agentTimeoutSeconds: 5, generatorTimeoutSeconds: 5,
    agents: specs.map(([id, mode, delay = 0]) => ({ id, bin: [fake], args: ['{prompt_file}', mode, id, String(delay)], stdin: false, output: 'stdout', readonly: true })),
    generator: { bin: [fake], model: 'fake' }, host: { bin: [fake] } };
  const configFile = path.join(cwd, 'oneshot.config.json');
  fs.writeFileSync(configFile, JSON.stringify(config));
  const env = { ...process.env, ONESHOT_CACHE_DIR: path.join(cwd, 'cache') };
  const run = (args, options = {}) => runCLI(args, { cwd, env, ...options });
  const readState = () => {
    const root = path.join(cwd, 'docs/oneshot/runs');
    const dir = path.join(root, fs.readdirSync(root)[0]);
    return { dir, state: JSON.parse(fs.readFileSync(path.join(dir, 'state.json'))) };
  };
  const calls = () => fs.existsSync(path.join(cwd, 'calls.jsonl')) ? fs.readFileSync(path.join(cwd, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  return { cwd, fake, config, configFile, run, readState, calls, env };
}
export function runCLI(args, { cwd, env, input = '' }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { stderr += c; });
    child.on('error', reject);
    child.stdin.end(input);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}
export async function ready(f, size = 'L') {
  const result = await f.run(['init', '--title', 'test', '--size', size, '--json']);
  if (result.code) throw new Error(result.stderr);
  const { dir } = f.readState();
  fs.writeFileSync(path.join(dir, 'DESIGN.md'), design);
  return dir;
}
