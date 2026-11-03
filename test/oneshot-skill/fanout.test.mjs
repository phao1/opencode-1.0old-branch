import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fixture, ready, cli } from './helpers.mjs';
import { alive, atomicJSON } from '../../.agents/skills/one-shot/scripts/lib/state.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
  for (let n = 0; n < 100; n++) { if (fn()) return; await pause(30); }
  throw new Error('condition timeout');
}
test('fanout 真并发：三个各 2s，预热探测后总耗时 <4s；完成需宿主汇总', async t => {
  const f = fixture(t, [['a', 'ok', 2000], ['b', 'ok', 2000], ['c', 'ok', 2000]]);
  const dir = await ready(f);
  await f.run(['agents']);
  const started = Date.now();
  const result = await f.run(['fanout', 'improve', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 4000, `took ${elapsed}ms`);
  t.diagnostic(`3 x 2s fanout elapsed: ${elapsed}ms (<4000ms)`);
  const record = JSON.parse(result.stdout);
  assert.ok(Object.values(record.agents).every(a => a.status === 'ok'), JSON.stringify(record));
  const calls = f.calls();
  assert.ok(Math.max(...calls.map(c => c.at)) - Math.min(...calls.map(c => c.at)) < 1000);
  assert.equal((await f.run(['done', 'improve'])).code, 1);
  fs.writeFileSync(path.join(dir, 'improve/round-1/SUMMARY.md'), '| 建议 | 来源 agent | 采纳/部分/拒绝 | 理由 |\n无建议，已核对设计。');
  assert.equal((await f.run(['done', 'improve'])).code, 0);
  assert.ok(fs.readFileSync(path.join(dir, 'improve/round-1/a.log'), 'utf8').includes('suggestion a'));
});
test('独立超时 kill 整个进程组，另一个 agent 成功', async t => {
  const f = fixture(t, [['hang', 'hang'], ['ok', 'ok', 50]]);
  await ready(f);
  const result = await f.run(['fanout', 'review', '--timeout', '0.5', '--json']);
  const record = JSON.parse(result.stdout);
  assert.equal(record.agents.hang.status, 'timeout');
  assert.match(record.agents.hang.reason, /timeout/);
  assert.equal(record.agents.ok.status, 'ok');
  const childPID = Number(fs.readFileSync(path.join(f.cwd, 'hang.child.pid')));
  await until(() => !alive(childPID));
  assert.ok(!record.degraded);
});
test('退出非零、空输出、全部失败记录 DEGRADED；无可用 agent 同样降级', async t => {
  const f = fixture(t, [['bad', 'fail'], ['blank', 'empty'], ['auth', 'auth']]);
  const dir = await ready(f);
  const record = JSON.parse((await f.run(['fanout', 'improve', '--json'])).stdout);
  assert.equal(record.agents.bad.status, 'failed');
  assert.match(record.agents.bad.reason, /exit 7/);
  assert.equal(record.agents.blank.reason, 'empty output');
  assert.equal(record.agents.auth.status, 'unavailable');
  assert.equal(record.degraded, true);
  assert.equal(f.readState().state.rounds.improve[1].degraded, true);
  assert.match(fs.readFileSync(path.join(dir, 'improve/round-1/DEGRADED.md'), 'utf8'), /DEGRADED/);
  const allUnavailable = JSON.parse((await f.run(['fanout', 'review', '--agents', 'auth', '--json'])).stdout);
  assert.equal(allUnavailable.degraded, true);
  fs.writeFileSync(path.join(dir, 'review/round-1/SUMMARY.md'), '宿主自评');
  assert.equal((await f.run(['done', 'review'])).code, 1);
  fs.writeFileSync(path.join(dir, 'review/round-1/SUMMARY.md'), 'DEGRADED 宿主自评：检查设计与代码，未发现问题；非独立评审。');
  assert.equal((await f.run(['done', 'review'])).code, 0);
});
test('中断 fanout 后复用已成功结果，回收锁，只重跑未完成 agent', async t => {
  const f = fixture(t, [['fast', 'ok', 30], ['slow', 'ok', 1500]]);
  const dir = await ready(f);
  await f.run(['agents']);
  const child = spawn(process.execPath, [cli, 'fanout', 'improve'], { cwd: f.cwd, env: f.env, stdio: 'ignore' });
  const closed = new Promise(resolve => child.on('close', resolve));
  await until(() => f.readState().state.rounds.improve[1]?.agents.fast?.status === 'ok');
  await until(() => f.calls().some(c => c.id === 'slow'));
  const slowPID = f.calls().find(c => c.id === 'slow').pid;
  child.kill('SIGTERM');
  assert.equal(await closed, 143);
  const interrupted = f.readState().state;
  const slow = interrupted.rounds.improve[1].agents.slow;
  assert.equal(slow.cliPid, child.pid);
  assert.equal(slow.status, 'interrupted');
  assert.match(slow.reason, /SIGTERM/);
  assert.ok(slow.finishedAt);
  assert.equal(interrupted.rounds.improve[1].agents.fast.status, 'ok');
  assert.equal(interrupted.nodes.improve.status, 'interrupted');
  assert.ok(!fs.existsSync(path.join(dir, '.lock')));
  const next = JSON.parse((await f.run(['next', '--json'])).stdout);
  assert.ok(next.interrupted.some(r => r.task.includes('slow')));
  await until(() => !alive(slowPID));
  assert.equal((await f.run(['fanout', 'improve'])).code, 0);
  assert.equal(f.calls().filter(c => c.id === 'fast').length, 1);
  assert.equal(f.calls().filter(c => c.id === 'slow').length, 2);
  assert.ok(Object.values(f.readState().state.rounds.improve[1].agents).every(a => a.status === 'ok'));
});
test('PONG 探测校验认证信息、非 PONG、缺失二进制，缓存可刷新', async t => {
  const f = fixture(t, [['yes', 'ok'], ['auth', 'auth'], ['no', 'nopong']]);
  f.config.agents.push({ id: 'missing', bin: ['/no/such/agent'], args: [], readonly: true });
  fs.writeFileSync(f.configFile, JSON.stringify(f.config));
  const rows = JSON.parse((await f.run(['agents', '--refresh', '--json'])).stdout);
  assert.equal(rows[0].available, true);
  assert.equal(rows[1].available, false);
  assert.match(rows[1].reason, /authentication/);
  assert.equal(rows[2].available, false);
  assert.match(rows[2].reason, /PONG/);
  assert.match(rows[3].reason, /binary not found/);
  fs.rmSync(f.fake);
  assert.equal(JSON.parse((await f.run(['agents', '--json'])).stdout)[0].available, true);
  assert.equal(JSON.parse((await f.run(['agents', '--refresh', '--json'])).stdout)[0].available, false);
});

test('默认 Codex 只读 argv、stdin 文件指令与 -o 输出路径（替换为假二进制）', async t => {
  const f = fixture(t);
  const defaults = JSON.parse(fs.readFileSync(new URL('../../.agents/skills/one-shot/config.json', import.meta.url)));
  assert.equal(defaults.agentTimeoutSeconds, 1500);
  assert.equal(defaults.generatorTimeoutSeconds, 3600);
  const agent = { ...defaults.agents[0], bin: [f.fake] };
  f.config.agents = [agent];
  fs.writeFileSync(f.configFile, JSON.stringify(f.config));
  const dir = await ready(f);
  const result = await f.run(['fanout', 'improve', '--json']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).agents[agent.id].status, 'ok');
  const call = f.calls().at(-1);
  const out = path.join(dir, 'improve/round-1', `${agent.id}.md`);
  assert.deepEqual(call.args, ['exec', '--skip-git-repo-check', '-s', 'read-only', '-C', f.cwd, '-m', agent.model,
    '-c', 'model_reasoning_effort="high"', '-o', out, '-']);
  assert.match(call.input, /读取并执行 .*\.prompt\.md/);
  assert.match(fs.readFileSync(out, 'utf8'), /Generator report/);
  assert.match(fs.readFileSync(path.join(dir, 'improve/round-1', `${agent.id}.log`), 'utf8'), /thread.started/);
});

test('improve/review prompt 包含需求、分析、上一轮汇总，review 渲染固定 diff 基准', async t => {
  const f = fixture(t);
  const dir = await ready(f);
  const base = '517e6c9aa4c61dbc125e7654fc596f1d529f20d9';
  for (const kind of ['improve', 'review']) {
    assert.equal((await f.run(['fanout', kind])).code, 0);
    let prompt = fs.readFileSync(path.join(dir, kind, 'round-1/one.prompt.md'), 'utf8');
    assert.ok(prompt.includes(path.join(dir, 'REQUIREMENT.md')));
    assert.ok(prompt.includes(path.join(dir, 'BRAINSTORM.md')));
    assert.match(prompt, /无（上一轮汇总不存在）/);
    assert.match(prompt, /对照需求.*满足.*越界/);
    if (kind === 'review') assert.match(prompt, /初始化基准 commit：null/);
    const state = f.readState().state;
    state.baseCommit = base;
    atomicJSON(path.join(dir, 'state.json'), state);
    const summary = path.join(dir, kind, 'round-1/SUMMARY.md');
    fs.writeFileSync(summary, '上一轮的取舍与证据');
    assert.equal((await f.run(['fanout', kind, '--round', '2'])).code, 0);
    prompt = fs.readFileSync(path.join(dir, kind, 'round-2/one.prompt.md'), 'utf8');
    assert.ok(prompt.includes(summary));
    if (kind === 'review') {
      assert.ok(prompt.includes(`git diff ${base}`));
      assert.match(prompt, /已提交与未提交/);
      assert.match(prompt, /git status --short --untracked-files=all/);
      assert.match(prompt, /未跟踪新文件.*逐个读取/);
    }
    assert.doesNotMatch(prompt, /\{(?:cwd|run_dir|design|round|base|requirement|brainstorm|summary)\}/);
    // 下一种评审的首轮覆盖无基准渲染路径。
    const updated = f.readState().state;
    updated.baseCommit = null;
    atomicJSON(path.join(dir, 'state.json'), updated);
  }
});
