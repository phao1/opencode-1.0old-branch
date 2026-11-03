import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fixture, ready, cli } from './helpers.mjs';
import { alive, atomicJSON } from '../../.agents/skills/one-shot/scripts/lib/state.mjs';
import { killGroup } from '../../.agents/skills/one-shot/scripts/lib/process.mjs';

async function until(fn) {
  for (let n = 0; n < 500; n++) {
    if (fn()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('condition timeout');
}
function launch(t, f, args) {
  const child = spawn(process.execPath, [cli, ...args], { cwd: f.cwd, env: f.env, stdio: 'ignore' });
  const closed = new Promise(resolve => child.once('close', resolve));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await closed;
    for (const call of f.calls()) if (alive(call.pid)) killGroup(call.pid);
  });
  return { child, closed };
}
for (const [signal, exitCode] of [['SIGTERM', 143], ['SIGINT', 130]]) {
  test(`真实 impl CLI 收到 ${signal}：中断状态落盘、释放锁、清理进程组，新轮次恢复`, async t => {
    const f = fixture(t);
    const dir = await ready(f);
    f.config.generatorTimeoutSeconds = 30;
    fs.writeFileSync(f.configFile, JSON.stringify(f.config));
    fs.writeFileSync(path.join(f.cwd, 'generator-sleep'), '');
    const { child, closed } = launch(t, f, ['impl']);
    await until(() => fs.existsSync(path.join(f.cwd, 'generator.child.pid')));
    const generator = f.calls()[0];
    const descendant = Number(fs.readFileSync(path.join(f.cwd, 'generator.child.pid')));
    assert.equal(f.readState().state.impl.attempts[0].cliPid, child.pid);
    child.kill(signal);
    assert.equal(await closed, exitCode);
    const state = f.readState().state;
    const attempt = state.impl.attempts[0];
    assert.equal(attempt.status, 'interrupted');
    assert.equal(attempt.reason, `CLI received ${signal}`);
    assert.ok(Date.parse(attempt.finishedAt) >= Date.parse(attempt.startedAt));
    assert.equal(state.nodes.impl.status, 'interrupted');
    assert.ok(state.timeline.some(e => e.action === 'interrupted' && e.detail.includes('impl round 1')));
    assert.ok(!fs.existsSync(path.join(dir, '.lock')));
    await until(() => !alive(generator.pid) && !alive(descendant));
    const snapshot = fs.readFileSync(path.join(dir, 'state.json'), 'utf8');
    const status = JSON.parse((await f.run(['status', '--json'])).stdout);
    const next = JSON.parse((await f.run(['next', '--json'])).stdout);
    assert.equal(status.impl.attempts[0].status, 'interrupted');
    assert.ok(next.interrupted.some(r => r.task === 'impl round 1'));
    assert.equal(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'), snapshot);
    assert.equal((await f.run(['impl', '--round', '1'])).code, 1);
    fs.rmSync(path.join(f.cwd, 'generator-sleep'));
    assert.equal((await f.run(['impl'])).code, 0);
    assert.deepEqual(f.readState().state.impl.attempts.map(a => a.status), ['interrupted', 'ok']);
    assert.equal(f.readState().state.impl.attempts[1].round, 2);
    assert.equal(f.calls().length, 2);
    // Generator 成功后节点等待宿主 done，不能被死亡 CLI 的 reconcile 误判。
    await f.run(['report']);
    assert.equal(f.readState().state.nodes.impl.status, 'running');
  });
}

test('下一条写命令取得陈旧锁后 reconcile 死亡 pid 与旧版记录，保留成功和存活记录', async t => {
  const f = fixture(t);
  const dir = await ready(f);
  const state = f.readState().state;
  const dead = 2147483647;
  assert.ok(!alive(dead));
  state.impl.attempts = [{ round: 1, status: 'running', cliPid: dead }, { round: 2, status: 'running' }, { round: 3, status: 'ok', cliPid: dead }];
  state.nodes.impl = { status: 'running', cliPid: dead };
  state.nodes.brainstorm = { status: 'running' }; // 宿主手动 start，不属于 CLI 长任务。
  state.rounds.improve[1] = { agents: {
    dead: { status: 'running', cliPid: dead },
    live: { status: 'running', cliPid: process.pid },
    ok: { status: 'ok', cliPid: dead }
  } };
  state.verification = { status: 'running', cliPid: dead, ok: false, results: [{ status: 'running', cliPid: dead }] };
  atomicJSON(path.join(dir, 'state.json'), state);
  fs.writeFileSync(path.join(dir, '.lock'), JSON.stringify({ pid: dead }));
  const before = fs.readFileSync(path.join(dir, 'state.json'), 'utf8');
  await f.run(['status']);
  await f.run(['next']);
  assert.equal(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'), before);
  assert.equal((await f.run(['report'])).code, 0);
  const updated = f.readState().state;
  assert.deepEqual(updated.impl.attempts.map(a => a.status), ['interrupted', 'interrupted', 'ok']);
  assert.equal(updated.nodes.impl.status, 'interrupted');
  assert.equal(updated.nodes.brainstorm.status, 'running');
  assert.equal(updated.rounds.improve[1].agents.dead.status, 'interrupted');
  assert.equal(updated.rounds.improve[1].agents.live.status, 'running');
  assert.equal(updated.rounds.improve[1].agents.ok.status, 'ok');
  assert.equal(updated.verification.status, 'interrupted');
  assert.equal(updated.verification.results[0].status, 'interrupted');
  const events = updated.timeline.filter(e => e.action === 'interrupted');
  assert.equal(events.length, 6);
  assert.ok(events.every(e => e.detail.includes('reconcile: CLI pid')));
  assert.ok(updated.impl.attempts[0].finishedAt);
  assert.ok(!fs.existsSync(path.join(dir, '.lock')));
  await f.run(['report']);
  assert.equal(f.readState().state.timeline.filter(e => e.action === 'interrupted').length, 6);
});

test('真实 verify 中断保留进行中检查，恢复时顺序重跑全部检查', async t => {
  const f = fixture(t);
  const dir = await ready(f);
  await f.run(['checks', 'add', 'echo first >> order.txt', '--name', 'first']);
  await f.run(['checks', 'add', 'if test -f continue; then echo passed; else echo $$ > check.pid; sleep 30; fi', '--name', 'sleep']);
  const { child, closed } = launch(t, f, ['verify']);
  await until(() => fs.existsSync(path.join(f.cwd, 'check.pid')));
  const active = f.readState().state.verification;
  assert.equal(active.cliPid, child.pid);
  assert.equal(active.results[1].cliPid, child.pid);
  assert.equal(active.results[1].status, 'running');
  child.kill('SIGTERM');
  assert.equal(await closed, 143);
  const state = f.readState().state;
  assert.equal(state.verification.status, 'interrupted');
  assert.deepEqual(state.verification.results.map(r => r.status), ['ok', 'interrupted']);
  assert.ok(state.verification.finishedAt);
  assert.equal(state.nodes.verify.status, 'interrupted');
  assert.ok(!fs.existsSync(path.join(dir, '.lock')));
  assert.equal((await f.run(['done', 'verify'])).code, 1);
  fs.writeFileSync(path.join(f.cwd, 'continue'), '');
  assert.equal((await f.run(['verify'])).code, 0);
  assert.equal(fs.readFileSync(path.join(f.cwd, 'order.txt'), 'utf8'), 'first\nfirst\n');
  assert.equal(f.readState().state.verification.status, 'ok');
});
