import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture, ready } from './helpers.mjs';
import { alive, atomicJSON } from '../../.agents/skills/one-shot/scripts/lib/state.mjs';

test('Generator 新会话、JSON thread 持久化，--fix resume 参数与记录正确且保留历史', async t => {
  const f = fixture(t);
  const dir = await ready(f);
  const initial = f.readState().state;
  initial.baseCommit = '517e6c9aa4c61dbc125e7654fc596f1d529f20d9';
  atomicJSON(path.join(dir, 'state.json'), initial);
  let result = await f.run(['impl', '--json']);
  assert.equal(result.code, 0, result.stderr);
  let state = f.readState().state;
  assert.equal(state.impl.threadId, 'test-thread-123');
  assert.equal(state.nodes.impl.status, 'running');
  const prompt = fs.readFileSync(path.join(dir, 'impl/round-1/prompt.md'), 'utf8');
  assert.ok(prompt.includes(`初始化基准 commit：${initial.baseCommit}`));
  assert.doesNotMatch(prompt, /\{base\}/);
  assert.equal(JSON.parse((await f.run(['impl', '--json'])).stdout).reused, true);
  assert.equal(f.calls().length, 1);
  assert.equal((await f.run(['done', 'impl'])).code, 0);
  await f.run(['checks', 'add', 'true']);
  assert.equal((await f.run(['verify'])).code, 0);
  const fix = path.join(dir, 'findings.md');
  fs.writeFileSync(fix, '- [P1] fix this');
  result = await f.run(['impl', '--fix', fix, '--json']);
  assert.equal(result.code, 0, result.stderr);
  state = f.readState().state;
  const attempt = state.impl.attempts[1];
  assert.equal(state.nodes.verify.status, 'pending');
  assert.equal((await f.run(['done', 'verify'])).code, 1);
  assert.equal(attempt.fix, fix);
  assert.equal(attempt.resumedFrom, 'test-thread-123');
  const calls = f.calls();
  assert.deepEqual(calls[0].args.slice(0, 4), ['exec', '--dangerously-bypass-approvals-and-sandbox', '-C', f.cwd]);
  assert.deepEqual(calls[1].args.slice(0, 3), ['exec', 'resume', 'test-thread-123']);
  assert.ok(!calls[1].args.includes('-C'));
  assert.ok(calls[1].args.includes('--json'));
  assert.ok(calls[1].args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.equal(calls[1].cwd, f.cwd);
  assert.equal(calls[1].args.at(-1), '-');
  assert.match(calls[1].input, /读取并执行 .*prompt.md/);
  assert.match(fs.readFileSync(path.join(dir, 'impl/round-2/prompt.md'), 'utf8'), /findings.md/);
  assert.ok(fs.existsSync(path.join(dir, 'impl/round-1/report.md')));
  assert.match(fs.readFileSync(path.join(dir, 'impl/round-2/events.jsonl'), 'utf8'), /thread.started/);
  assert.equal((await f.run(['impl', '--fix', 'missing.md'])).code, 1);
});
test('--fix 无 thread 时新开 Generator，inline 需要宿主报告', async t => {
  const f = fixture(t);
  const dir = await ready(f);
  const fix = path.join(dir, 'findings.md');
  fs.writeFileSync(fix, 'first attempt fixes');
  assert.equal((await f.run(['impl', '--fix', fix])).code, 0);
  assert.match(fs.readFileSync(path.join(dir, 'impl/round-1/prompt.md'), 'utf8'), /初始化基准 commit：null/);
  assert.equal(f.readState().state.impl.attempts[0].resumedFrom, null);
  assert.ok(!f.calls()[0].args.includes('resume'));
  const other = fixture(t);
  const otherDir = await ready(other, 'S');
  assert.equal((await other.run(['impl', '--inline'])).code, 0);
  assert.equal(other.calls().length, 0);
  assert.equal((await other.run(['done', 'impl'])).code, 1);
  fs.mkdirSync(path.join(otherDir, 'impl/round-1'), { recursive: true });
  fs.writeFileSync(path.join(otherDir, 'impl/round-1/report.md'), 'inline implementation');
  assert.equal((await other.run(['done', 'impl'])).code, 0);
});

test('report 为每个 Evaluator 展示模型和耗时，缺失值为 -，零耗时保留', async t => {
  const f = fixture(t);
  const dir = await ready(f);
  const state = f.readState().state;
  state.rounds.improve[1] = { agents: {
    named: { status: 'ok', model: 'test-model', durationMs: 123 },
    running: { status: 'running' },
    missing: { status: 'unavailable', model: null, durationMs: 0 }
  } };
  state.rounds.review[1] = { degraded: true, agents: { timed: { status: 'timeout', model: 'review-model', durationMs: 1500 } } };
  atomicJSON(path.join(dir, 'state.json'), state);
  assert.equal((await f.run(['report'])).code, 0);
  const report = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
  assert.match(report, /named（模型：test-model）: ok.*durationMs: 123ms/);
  assert.match(report, /running（模型：-）: interrupted.*durationMs: -/);
  assert.match(report, /missing（模型：-）: unavailable.*durationMs: 0ms/);
  assert.match(report, /timed（模型：review-model）: timeout.*durationMs: 1500ms/);
  assert.doesNotMatch(report, /undefined|nullms/);
});
test('verify 顺序执行、日志落盘，失败不能 done，修复后可以通过', async t => {
  const f = fixture(t);
  const dir = await ready(f);
  assert.equal((await f.run(['verify'])).code, 1);
  await f.run(['checks', 'add', 'echo first > order.txt', '--name', 'first']);
  await f.run(['checks', 'add', 'cat order.txt && test -f fixed', '--name', 'second']);
  assert.equal(JSON.parse((await f.run(['checks', 'list', '--json'])).stdout).length, 2);
  let result = await f.run(['verify', '--json']);
  assert.equal(result.code, 1);
  assert.equal(f.readState().state.nodes.verify.status, 'failed');
  assert.match(fs.readFileSync(path.join(dir, 'verify/2-second.log'), 'utf8'), /first/);
  assert.equal((await f.run(['done', 'verify'])).code, 1);
  fs.writeFileSync(path.join(f.cwd, 'fixed'), '');
  result = await f.run(['verify', '--json']);
  assert.equal(result.code, 0);
  assert.equal(f.readState().state.nodes.verify.status, 'done');
  const markdown = fs.readFileSync(path.join(dir, 'verify/RESULT.md'), 'utf8');
  assert.match(markdown, /PASS/);
  const links = [...markdown.matchAll(/\[log\]\(([^)]+)\)/g)].map(m => m[1]);
  assert.deepEqual(links, ['1-first.log', '2-second.log']);
  assert.ok(links.every(link => fs.existsSync(path.resolve(dir, 'verify', link))));
  assert.deepEqual(f.readState().state.verification.results.map(r => r.log), ['verify/1-first.log', 'verify/2-second.log']);
  assert.ok(f.readState().state.verification.cliPid > 0);
  await f.run(['report']);
  assert.match(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), /验证结果/);
});
test('run 前台/后台宿主精确参数与 stdin，存活时拒绝 resume，死亡后可恢复', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.cwd, 'host-sleep'), '');
  const started = Date.now();
  let result = await f.run(['run', 'a requirement', '--bg', '--json']);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(Date.now() - started < 700);
  const { dir, state } = f.readState();
  assert.ok(alive(state.host.pid));
  assert.equal(state.host.background, true);
  assert.equal((await f.run(['resume', '--bg'])).code, 1);
  for (let n = 0; n < 100 && alive(state.host.pid); n++) await new Promise(r => setTimeout(r, 30));
  assert.ok(!alive(state.host.pid));
  fs.rmSync(path.join(f.cwd, 'host-sleep'));
  result = await f.run(['resume', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const calls = f.calls();
  assert.deepEqual(calls[0].args, ['exec', '--dangerously-bypass-approvals-and-sandbox', '-C', f.cwd, '--json', '-o', path.join(dir, 'host.last.md'), '-']);
  assert.match(calls[0].input, /^\$one-shot 执行 run /);
  assert.match(calls[1].input, /^\$one-shot 继续 run /);
  assert.ok(fs.existsSync(path.join(dir, 'host.events.jsonl')));
  assert.ok(fs.existsSync(path.join(dir, 'host.last.md')));
});
test('install.sh 可安装、幂等，拒绝覆盖别的目录；SKILL 通过行数与 frontmatter 检查', t => {
  const f = fixture(t);
  const skill = path.resolve(import.meta.dirname || path.dirname(new URL(import.meta.url).pathname), '../../.agents/skills/one-shot');
  const env = { ...process.env, ONESHOT_INSTALL_DIR: path.join(f.cwd, 'skills') };
  assert.equal(spawnSync('sh', [path.join(skill, 'scripts/install.sh')], { env }).status, 0);
  assert.equal(fs.realpathSync(path.join(env.ONESHOT_INSTALL_DIR, 'one-shot')), skill);
  assert.equal(spawnSync('sh', [path.join(skill, 'scripts/install.sh')], { env }).status, 0);
  fs.unlinkSync(path.join(env.ONESHOT_INSTALL_DIR, 'one-shot'));
  fs.mkdirSync(path.join(env.ONESHOT_INSTALL_DIR, 'one-shot'));
  assert.equal(spawnSync('sh', [path.join(skill, 'scripts/install.sh')], { env }).status, 1);
  const content = fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8');
  assert.ok(content.split('\n').length <= 250);
  assert.match(content, /^---\nname: one-shot\ndescription: .+\n---/);
});

test('run/resume 精确宿主 argv：host.model 配置、--model 优先覆盖、后台恢复', async t => {
  for (const command of ['run', 'resume']) {
    for (const override of [false, true]) {
      const f = fixture(t);
      f.config.host.model = 'configured-host-model';
      fs.writeFileSync(f.configFile, JSON.stringify(f.config));
      if (command === 'resume') await ready(f);
      const args = command === 'run' ? ['run', 'model requirement'] : ['resume'];
      if (override) args.push('--model', 'replacement-model');
      const background = command === 'resume' && override;
      if (background) args.push('--bg');
      const result = await f.run([...args, '--json']);
      assert.equal(result.code, 0, result.stderr);
      const { dir, state } = f.readState();
      for (let n = 0; n < 100 && alive(state.host.pid); n++) await new Promise(resolve => setTimeout(resolve, 30));
      assert.ok(!alive(state.host.pid));
      const expected = ['exec', '--dangerously-bypass-approvals-and-sandbox', '-C', f.cwd,
        '-m', override ? 'replacement-model' : 'configured-host-model', '--json', '-o', path.join(dir, 'host.last.md'), '-'];
      assert.deepEqual(f.calls()[0].args, expected);
      assert.deepEqual(state.host.args, expected);
      assert.equal(state.host.background, background);
      assert.equal(f.config.generator.model, 'fake');
    }
  }
});
