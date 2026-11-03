import fs from 'node:fs';
import path from 'node:path';
import { skillDir, invokeAgent, probeAgents } from './agents.mjs';
import { now, save, event, nonempty, write, validateDesign } from './state.mjs';
import { execute, resolveBin, render, eventReader } from './process.mjs';

export function template(name, vars) {
  return render(fs.readFileSync(path.join(skillDir, 'templates', `${name}.md`), 'utf8'), vars);
}
export function roundNumber(value, fallback = 1) {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < 1) throw new Error('round 必须是正整数');
  return n;
}
export function seconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error('timeout 必须大于 0');
  return n * 1000;
}
export async function fanout(ctx, kind, opts) {
  const { cwd, config, dir, state } = ctx;
  if (!['improve', 'review'].includes(kind) || !state.nodes[kind]) throw new Error('该尺寸没有此评审节点');
  validateDesign(dir);
  const round = roundNumber(opts.round);
  const max = config[kind === 'improve' ? 'maxImproveRounds' : 'maxReviewRounds'];
  if (round > max) throw new Error(`${kind} 最多 ${max} 轮`);
  const selectedIDs = opts.agents?.split(',');
  const selected = selectedIDs ? selectedIDs.map(id => {
    const agent = config.agents.find(a => a.id === id);
    if (!agent) throw new Error(`未知 agent：${id}`);
    return agent;
  }) : config.agents;
  const timeout = seconds(opts.timeout ?? config.agentTimeoutSeconds);
  state.nodes[kind] = { status: 'running', cliPid: process.pid, round, startedAt: now() };
  save(dir, state);
  const probes = await probeAgents(config, cwd);
  const folder = path.join(dir, kind, `round-${round}`);
  const summary = path.join(dir, kind, `round-${round - 1}`, 'SUMMARY.md');
  fs.mkdirSync(folder, { recursive: true });
  const record = state.rounds[kind][round] ||= { agents: {}, startedAt: now() };
  await Promise.all(selected.map(async agent => {
    const out = path.join(folder, `${agent.id}.md`);
    const previous = record.agents[agent.id];
    if (previous?.status === 'ok' && nonempty(out)) return;
    const probe = probes.find(p => p.id === agent.id);
    if (!probe?.available) {
      record.agents[agent.id] = { status: 'unavailable', cliPid: process.pid, reason: probe?.reason || 'not probed', durationMs: 0, at: now(), model: agent.model || null };
      save(dir, state);
      return;
    }
    const prompt = path.join(folder, `${agent.id}.prompt.md`);
    write(prompt, template(`${kind}.prompt`, { cwd, run_dir: dir, design: path.join(dir, 'DESIGN.md'), round,
      base: state.baseCommit ?? 'null', requirement: path.join(dir, 'REQUIREMENT.md'),
      brainstorm: path.join(dir, 'BRAINSTORM.md'), summary: fs.existsSync(summary) ? summary : '无（上一轮汇总不存在）' }));
    record.agents[agent.id] = { status: 'running', cliPid: process.pid, at: now(), model: agent.model || null };
    save(dir, state);
    const result = await invokeAgent(agent, { cwd, prompt, out, log: path.join(folder, `${agent.id}.log`), timeout });
    record.agents[agent.id] = { ...result, cliPid: process.pid, at: now(), finishedAt: now(), model: agent.model || null };
    save(dir, state);
  }));
  record.degraded = !Object.entries(record.agents).some(([id, a]) => a.status === 'ok' && nonempty(path.join(folder, `${id}.md`)));
  record.finishedAt = now();
  if (record.degraded) {
    write(path.join(folder, 'DEGRADED.md'), `DEGRADED ${now()}\n无成功 Evaluator；宿主必须自评并在 SUMMARY.md 写出证据与局限。\n`);
  } else fs.rmSync(path.join(folder, 'DEGRADED.md'), { force: true });
  if (!nonempty(path.join(folder, 'SUMMARY.md'))) {
    write(path.join(folder, 'SUMMARY.md'), template('summary', { kind, round, status: record.degraded ? 'DEGRADED' : '待宿主汇总' }));
  }
  event(state, 'fanout', `${kind} round ${round}${record.degraded ? ' DEGRADED' : ''}`);
  delete state.nodes[kind].cliPid;
  save(dir, state);
  return record;
}
export async function implement(ctx, opts) {
  const { cwd, config, dir, state } = ctx;
  const node = state.nodes.impl;
  const invalidateVerification = () => { state.nodes.verify.status = 'pending'; state.verification = null; };
  if (opts.inline) {
    if (opts.fix) throw new Error('--inline 不能和 --fix 同用');
    node.status = 'running';
    delete node.cliPid;
    delete node.reason;
    delete node.finishedAt;
    invalidateVerification();
    state.impl.inline = true;
    event(state, 'impl', 'inline: 宿主自己实现；完成后写 impl/round-1/report.md，再 done impl');
    save(dir, state);
    return { inline: true, report: path.join(dir, 'impl/round-1/report.md') };
  }
  validateDesign(dir);
  const fix = opts.fix ? path.resolve(cwd, opts.fix) : null;
  if (fix && !nonempty(fix)) throw new Error('--fix 需要非空 findings 文件');
  const previous = state.impl.attempts.at(-1);
  if (!fix && !opts.round && previous?.status === 'ok' && nonempty(path.join(dir, 'impl', `round-${previous.round}`, 'report.md'))) {
    return { ...previous, reused: true };
  }
  const round = roundNumber(opts.round, state.impl.attempts.length + 1);
  const folder = path.join(dir, 'impl', `round-${round}`);
  if (fs.existsSync(folder)) throw new Error('impl round 已存在，请使用新轮次保留证据');
  const bin = resolveBin(config.generator.bin);
  if (!bin) throw new Error('Generator codex binary not found');
  const out = path.join(folder, 'report.md');
  const prompt = path.join(folder, 'prompt.md');
  write(prompt, template('impl.prompt', { cwd, run_dir: dir, design: path.join(dir, 'DESIGN.md'),
    base: state.baseCommit ?? 'null', findings: fix || '无；首次实现' }));
  const resumed = fix ? state.impl.threadId : null;
  const args = resumed ? ['exec', 'resume', resumed, '--dangerously-bypass-approvals-and-sandbox', '-m', config.generator.model, '--json', '-o', out, '-']
    : ['exec', '--dangerously-bypass-approvals-and-sandbox', '-C', cwd, '-m', config.generator.model, '--json', '-o', out, '-'];
  const attempt = { round, cliPid: process.pid, startedAt: now(), fix, resumedFrom: resumed || null, status: 'running', args };
  state.impl.attempts.push(attempt);
  state.impl.inline = false;
  invalidateVerification();
  node.status = 'running';
  node.cliPid = process.pid;
  node.startedAt = now();
  delete node.reason;
  delete node.finishedAt;
  save(dir, state);
  const readEvents = eventReader(id => { state.impl.threadId = id; attempt.threadId = id; save(dir, state); });
  const result = await execute({ bin, args, cwd, input: `读取并执行 ${prompt} 中的指令。\n`,
    timeout: seconds(config.generatorTimeoutSeconds), log: path.join(folder, 'generator.log'), stdoutFile: path.join(folder, 'events.jsonl'), onStdout: readEvents });
  delete result.sample;
  if (result.status === 'ok' && !nonempty(out)) Object.assign(result, { status: 'failed', reason: 'empty output' });
  Object.assign(attempt, result, { finishedAt: now() });
  node.status = result.status === 'ok' ? 'running' : 'failed';
  delete node.cliPid;
  event(state, 'impl', `round ${round}: ${result.status}${resumed ? ' resumed' : ''}`);
  save(dir, state);
  return attempt;
}
export async function verify(ctx) {
  const { cwd, dir, state, config } = ctx;
  if (!state.checks.length) throw new Error('没有验证命令，请 checks add');
  const results = [];
  state.nodes.verify = { status: 'running', cliPid: process.pid, startedAt: now() };
  state.verification = { status: 'running', cliPid: process.pid, startedAt: now(), results, ok: false };
  save(dir, state);
  for (const [index, check] of state.checks.entries()) {
    const log = path.join(dir, 'verify', `${index + 1}-${check.name}.log`);
    const record = { ...check, status: 'running', cliPid: process.pid, log: path.relative(dir, log), startedAt: now() };
    results.push(record);
    save(dir, state);
    const result = await execute({ bin: '/bin/sh', args: ['-c', check.command], cwd,
      timeout: seconds(config.checkTimeoutSeconds || 600), log });
    delete result.sample;
    Object.assign(record, result, { at: now(), finishedAt: now() });
    save(dir, state);
  }
  const ok = results.every(r => r.status === 'ok');
  Object.assign(state.verification, { status: ok ? 'ok' : 'failed', ok, at: now(), finishedAt: now() });
  state.nodes.verify = { status: ok ? 'done' : 'failed', finishedAt: now() };
  write(path.join(dir, 'verify/RESULT.md'), `# 验证 ${now()}\n\n${ok ? 'PASS' : 'FAIL'}\n\n| 命令 | 结果 | 日志 |\n| --- | --- | --- |\n${results.map(r => `| ${r.command.replaceAll('|', '\\|')} | ${r.status} ${r.reason} | [log](${path.relative('verify', r.log)}) |`).join('\n')}\n`);
  event(state, 'verify', ok ? 'PASS' : 'FAIL');
  save(dir, state);
  return state.verification;
}
export function validateArtifact(ctx, node) {
  const { dir, state } = ctx;
  const need = file => { if (!nonempty(path.join(dir, file))) throw new Error(`缺少非空产物 ${file}`); };
  if (node === 'brainstorm') need('BRAINSTORM.md');
  if (node === 'design') validateDesign(dir);
  if (node === 'improve' || node === 'review') {
    const rounds = Object.entries(state.rounds[node]);
    if (!rounds.length) throw new Error(`先 fanout ${node}`);
    for (const [n, record] of rounds) {
      if (!record.finishedAt) throw new Error(`round ${n} 未完成`);
      need(`${node}/round-${n}/SUMMARY.md`);
      const summary = fs.readFileSync(path.join(dir, node, `round-${n}/SUMMARY.md`), 'utf8');
      if (summary.includes('<!-- HOST_TODO -->')) throw new Error('SUMMARY.md 需要宿主完成分诊并移除 HOST_TODO');
      if (record.degraded && !summary.includes('DEGRADED')) throw new Error('SUMMARY.md 必须注明 DEGRADED 自评');
    }
  }
  if (node === 'impl') {
    const last = state.impl.attempts.at(-1);
    if (!state.impl.inline && last?.status !== 'ok') throw new Error('Generator 尚未成功');
    need(`impl/round-${state.impl.inline ? 1 : last.round}/report.md`);
  }
  if (node === 'verify' && !state.verification?.ok) throw new Error('verify 尚未全部通过');
  if (node === 'deliver') {
    for (const [name, value] of Object.entries(state.nodes)) {
      if (name !== 'deliver' && !['done', 'skipped'].includes(value.status)) throw new Error(`${name} 未完成`);
    }
    need('README.md');
  }
}
export function report(ctx) {
  const { dir, state } = ctx;
  const rows = Object.entries(state.nodes).map(([name, n]) => `| ${name} | ${n.status} | ${n.note || n.reason || ''} |`).join('\n');
  const agents = ['improve', 'review'].flatMap(kind => Object.entries(state.rounds[kind]).flatMap(([n, r]) => [
    `- [${kind} round ${n}](${kind}/round-${n}/SUMMARY.md)${r.degraded ? ' **DEGRADED**' : ''}`,
    ...Object.entries(r.agents).map(([id, a]) => `  - ${id}（模型：${a.model ?? '-'}）: ${a.status} ${a.reason || ''}；durationMs: ${a.durationMs == null ? '-' : `${a.durationMs}ms`}`)]));
  const timeline = state.timeline.map(e => `- ${e.at} ${e.action}: ${e.detail}`).join('\n');
  write(path.join(dir, 'README.md'), `# ${state.title}\n\nRun: ${state.id} · ${state.size} · ${state.createdAt}\n\n| 节点 | 状态 | 备注 |\n| --- | --- | --- |\n${rows}\n\n## 需求与关键决策\n\n[需求](REQUIREMENT.md) · [Brainstorm](BRAINSTORM.md)${state.size === 'S' ? '' : ' · [Design](DESIGN.md)'}\n\n关键决策与取舍见 Brainstorm、Design 与各轮 SUMMARY。Codex 多模型是同一 agent、不同模型，不能作为不同厂商计数。\n\n## Evaluator 与降级\n\n${agents.join('\n') || '未运行评审'}\n\n## 实现与验证\n\n${state.impl.inline ? '- [inline report](impl/round-1/report.md)' : state.impl.attempts.map(a => `- [Generator round ${a.round}](impl/round-${a.round}/report.md) · [events](impl/round-${a.round}/events.jsonl) · ${a.status}`).join('\n')}\n${state.verification ? '- [验证结果](verify/RESULT.md)' : ''}\n\n## 时间线\n\n${timeline}\n`);
  return path.join(dir, 'README.md');
}
