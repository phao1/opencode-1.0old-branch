#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, probeAgents, skillDir } from './lib/agents.mjs';
import { alive, lock, initRun, selectRun, nextNode, save, event, now, nodeTable, readJSON, reconcile, interruptTasks, interruptions } from './lib/state.mjs';
import { installSignals, resolveBin, track, untrack } from './lib/process.mjs';
import { fanout, implement, verify, validateArtifact, report } from './lib/workflow.mjs';

const booleanOptions = new Set(['json', 'refresh', 'bg', 'inline', 'help']);
let lockedRun;
function parse(argv) {
  const opts = {}, args = [];
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) { args.push(argv[i]); continue; }
    const key = argv[i].slice(2);
    if (booleanOptions.has(key)) opts[key] = true;
    else {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`--${key} 需要参数`);
      opts[key] = argv[++i];
    }
  }
  return { args, opts };
}
function display(value, json) {
  if (json) console.log(JSON.stringify(value, null, 2));
  else if (typeof value === 'string') console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}
function agentsTable(results) {
  return ['| Agent | 状态 | 原因 | 耗时 |', '| --- | --- | --- | --- |',
    ...results.map(a => `| ${a.id} | ${a.available ? '可用' : '不可用'} | ${a.reason.replaceAll('|', '/')} | ${a.durationMs}ms |`)].join('\n');
}
function readRequirement(opts, fallback = '') {
  return opts.req === '-' ? fs.readFileSync(0, 'utf8') : opts.req ? fs.readFileSync(path.resolve(opts.req), 'utf8') : fallback;
}
function startHost(ctx, opts, resume) {
  const { cwd, config, dir, state } = ctx;
  if (alive(state.host?.pid)) throw new Error(`宿主仍在运行，pid=${state.host.pid}`);
  const bin = resolveBin(config.host.bin);
  if (!bin) throw new Error('host codex binary not found');
  const model = opts.model ?? config.host.model;
  const args = ['exec', '--dangerously-bypass-approvals-and-sandbox', '-C', cwd,
    ...(model ? ['-m', model] : []), '--json', '-o', path.join(dir, 'host.last.md'), '-'];
  // 后台宿主没有终端依赖；stdio 全部重定向，相当于 nohup，单独进程组可跨 CLI 生命周期。
  const fd = fs.openSync(path.join(dir, 'host.events.jsonl'), 'a');
  const err = fs.openSync(path.join(dir, 'host.log'), 'a');
  let child;
  try { child = spawn(bin, args, { cwd, detached: true, stdio: ['pipe', fd, err] }); }
  finally { fs.closeSync(fd); fs.closeSync(err); }
  if (!child.pid) throw new Error('无法启动宿主');
  const entry = fileURLToPath(import.meta.url);
  const configHint = opts.config ? ` 所有 CLI 命令加 --config ${JSON.stringify(path.resolve(opts.config))}。` : '';
  const prompt = `$one-shot ${resume ? '继续' : '执行'} run ${state.id}，从 state.json 的下一个未完成节点开始。仓库 ${cwd}；run 目录 ${dir}。先读取 ${path.join(skillDir, 'SKILL.md')} 与 references/flow.md。CLI 为 ${entry}，每次加 --run ${state.id}。${configHint}无人值守，不提问，记录默认假设并执行完整流程。\n`;
  state.host = { pid: child.pid, startedAt: now(), background: !!opts.bg, args };
  event(state, resume ? 'resume-host' : 'run-host', `pid=${child.pid}`);
  save(dir, state);
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  if (opts.bg) {
    completion.catch(error => console.error(`宿主启动失败：${error.message}`));
    child.unref(); child.stdin.unref();
  }
  else { track(child.pid); completion.then(() => untrack(child.pid), () => untrack(child.pid)); }
  return { child, completion };
}
function nodeCommand(ctx, command, name, opts) {
  const { state, dir } = ctx;
  if (!state.nodes[name]) throw new Error(`不存在节点 ${name}`);
  if (command === 'start') {
    if (opts.size) {
      if (name !== 'brainstorm') throw new Error('只有 start brainstorm 可以调整 --size');
      if (state.sizeExplicit && opts.size !== state.size) throw new Error('init --size 的显式尺寸不可覆盖');
      if (Object.entries(state.nodes).some(([n, s]) => n !== 'brainstorm' && s.status !== 'pending')) throw new Error('下游已开始，不能更改尺寸');
      state.size = opts.size;
      state.nodes = nodeTable(opts.size);
    }
    state.nodes[name] = { status: 'running', startedAt: now() };
  } else if (command === 'done') {
    if (state.nodes[name].status === 'done') {
      state.nodes[name].note = opts.note ?? state.nodes[name].note ?? '';
      event(state, 'note-update', `${name} ${state.nodes[name].note}`);
      save(dir, state);
      return state.nodes[name];
    }
    validateArtifact(ctx, name);
    Object.assign(state.nodes[name], { status: 'done', finishedAt: now(), note: opts.note || '' });
  } else {
    if (!opts.reason?.trim()) throw new Error('skip 必须 --reason');
    state.nodes[name] = { status: 'skipped', reason: opts.reason, finishedAt: now() };
  }
  event(state, command, `${name} ${opts.note || opts.reason || ''}`);
  save(dir, state);
  return state.nodes[name];
}
async function main() {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('需要 Node >=20');
  const { args, opts } = parse(process.argv.slice(2));
  const [command, sub, ...rest] = args;
  if (!command || opts.help) {
    console.log('one-shot: agents [--refresh] | init --title t [--size S|M|L] [--req file|-] [--slug s] | status | next | start/done/skip node | fanout improve|review [--round N] [--agents a,b] [--timeout s] | impl [--fix file] [--inline] | checks add "cmd" [--name n] | checks list | verify | run "需求" [--model m] [--bg] | resume [--model m] [--bg] | report\n通用：--run id --config file --json；在目标仓库根执行。');
    return;
  }
  const cwd = process.cwd();
  const config = loadConfig(cwd, opts.config);
  const root = path.join(cwd, 'docs/oneshot/runs');
  if (command === 'agents') {
    const results = await probeAgents(config, cwd, opts.refresh);
    display(opts.json ? results : agentsTable(results), opts.json);
    return;
  }
  let run;
  if (command === 'init' || command === 'run') {
    const title = opts.title || (command === 'run' ? [sub, ...rest].filter(Boolean).join(' ') : '');
    if (!title) throw new Error('需要 --title 或需求文本');
    run = initRun(root, title, opts.size || 'M', opts.slug, readRequirement(opts, title), cwd);
    run.state.sizeExplicit = !!opts.size;
    save(run.dir, run.state);
    if (command === 'init') { display({ id: run.state.id, dir: run.dir, size: run.state.size }, opts.json); return; }
  } else run = selectRun(root, opts.run);
  const ctx = { ...run, cwd, config };
  if (command === 'status' || command === 'next') {
    const node = nextNode(run.state);
    const flow = fs.readFileSync(path.join(skillDir, 'references/flow.md'), 'utf8');
    const section = node ? flow.split(`## ${node}\n`)[1]?.split('\n## ')[0].trim() : '全部完成';
    display(command === 'next' ? { id: run.state.id, next: node, instruction: section, interrupted: interruptions(run.state) } : { ...run.state, next: node }, opts.json);
    return;
  }
  const release = lock(run.dir);
  let value, host;
  try {
    // 选择 run 后另一个进程可能已更新；取得锁后重新读取，避免用旧快照覆盖。
    ctx.state = readJSON(path.join(run.dir, 'state.json'));
    run.state = ctx.state;
    lockedRun = { ctx, release };
    if (reconcile(ctx.state)) save(ctx.dir, ctx.state);
    if (['start', 'done', 'skip'].includes(command)) value = nodeCommand(ctx, command, sub, opts);
    else if (command === 'fanout') value = await fanout(ctx, sub, opts);
    else if (command === 'impl') value = await implement(ctx, opts);
    else if (command === 'verify') value = await verify(ctx);
    else if (command === 'checks') {
      if (sub === 'add') {
        const commandText = rest.join(' ');
        if (!commandText.trim()) throw new Error('checks add 需要命令');
        const name = opts.name || `check-${run.state.checks.length + 1}`;
        if (!/^[\w-]+$/.test(name)) throw new Error('检查名称只允许字母数字下划线连字符');
        if (!run.state.checks.some(c => c.command === commandText)) {
          run.state.checks.push({ command: commandText, name });
          run.state.nodes.verify.status = 'pending';
          run.state.verification = null;
        }
        event(run.state, 'checks-add', commandText);
        save(run.dir, run.state);
      } else if (sub !== 'list') throw new Error('checks 只支持 add/list');
      value = run.state.checks;
    } else if (command === 'report') value = report(ctx);
    else if (command === 'run' || command === 'resume') {
      host = startHost(ctx, opts, command === 'resume');
      value = { id: run.state.id, dir: run.dir, host: run.state.host };
    } else throw new Error(`未知命令：${command}`);
  } finally { lockedRun = null; release(); }
  display(value, opts.json);
  // 宿主会调用本 CLI 写状态，等待期间必须释放锁。
  if (host && !opts.bg) {
    const result = await host.completion;
    if (result.code !== 0) process.exitCode = result.code || 1;
  }
  if (command === 'verify' && !value.ok || command === 'impl' && value.status && value.status !== 'ok') process.exitCode = 1;
}
installSignals(signal => {
  if (!lockedRun) return;
  const { ctx, release } = lockedRun;
  try {
    if (interruptTasks(ctx.state, record => record.cliPid === process.pid ? `CLI received ${signal}` : null)) save(ctx.dir, ctx.state);
  } finally { release(); }
});
main().catch(error => { console.error(`one-shot: ${error.message}`); process.exitCode = 1; });
