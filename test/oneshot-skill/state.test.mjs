import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { atomicJSON, lock, nodeTable, readJSON, initRun, validateDesign } from '../../.agents/skills/one-shot/scripts/lib/state.mjs';
import { fixture, ready, design } from './helpers.mjs';

test('尺寸生成 S/M/L 节点表，非法尺寸拒绝', () => {
  assert.deepEqual(Object.keys(nodeTable('S')), ['brainstorm', 'impl', 'verify', 'deliver']);
  assert.deepEqual(Object.keys(nodeTable('M')), ['brainstorm', 'design', 'improve', 'impl', 'verify', 'deliver']);
  assert.deepEqual(Object.keys(nodeTable('L')), ['brainstorm', 'design', 'improve', 'impl', 'verify', 'review', 'deliver']);
  assert.throws(() => nodeTable('XL'));
});
test('状态原子写：rename 前旧文件完整，rename 失败仍保留旧状态且清理 tmp', t => {
  const f = fixture(t);
  const file = path.join(f.cwd, 'state.json');
  atomicJSON(file, { v: 1 });
  const rename = fs.renameSync;
  let observed = false;
  fs.renameSync = (tmp, target) => {
    assert.equal(readJSON(target).v, 1);
    assert.equal(readJSON(tmp).v, 2);
    observed = true;
    rename(tmp, target);
  };
  try { atomicJSON(file, { v: 2 }); } finally { fs.renameSync = rename; }
  assert.ok(observed);
  assert.equal(readJSON(file).v, 2);
  fs.renameSync = () => { throw new Error('disk error'); };
  try { assert.throws(() => atomicJSON(file, { v: 3 }), /disk error/); } finally { fs.renameSync = rename; }
  assert.equal(readJSON(file).v, 2);
  assert.ok(!fs.readdirSync(f.cwd).some(n => n.endsWith('.tmp')));
});
test('锁包含 pid，拒绝活锁，回收死亡 pid', t => {
  const f = fixture(t);
  const release = lock(f.cwd);
  assert.equal(readJSON(path.join(f.cwd, '.lock')).pid, process.pid);
  assert.throws(() => lock(f.cwd), /锁定/);
  release();
  fs.writeFileSync(path.join(f.cwd, '.lock'), JSON.stringify({ pid: 2147483647 }));
  lock(f.cwd)();
  assert.ok(!fs.existsSync(path.join(f.cwd, '.lock')));
});
test('done 校验产物、设计章节与验收 ID，next 返回操作指导', async t => {
  const f = fixture(t);
  const dir = await ready(f);
  assert.equal((await f.run(['done', 'brainstorm'])).code, 1);
  fs.writeFileSync(path.join(dir, 'BRAINSTORM.md'), '# 分析\n默认假设');
  assert.equal((await f.run(['done', 'brainstorm'])).code, 0);
  fs.writeFileSync(path.join(dir, 'DESIGN.md'), '# design\n');
  assert.match((await f.run(['done', 'design'])).stderr, /缺少章节/);
  fs.writeFileSync(path.join(dir, 'DESIGN.md'), design.replace('A1', 'acceptance'));
  assert.match((await f.run(['done', 'design'])).stderr, /ID/);
  fs.writeFileSync(path.join(dir, 'DESIGN.md'), design);
  assert.equal((await f.run(['done', 'design'])).code, 0);
  const next = JSON.parse((await f.run(['next', '--json'])).stdout);
  assert.equal(next.next, 'improve');
  assert.match(next.instruction, /fanout improve/);
  assert.equal((await f.run(['done', 'impl'])).code, 1);
  assert.equal((await f.run(['done', 'verify'])).code, 1);
  assert.equal((await f.run(['done', 'deliver'])).code, 1);
  assert.equal((await f.run(['skip', 'review'])).code, 1);
  assert.equal((await f.run(['skip', 'review', '--reason', 'explicit test trim'])).code, 0);
});
test('init req stdin、run id、显式尺寸优先，默认尺寸可在 brainstorm 判定', async t => {
  const f = fixture(t);
  let result = await f.run(['init', '--title', 'Hello world', '--req', '-', '--json'], { input: '原始需求\n不要改写' });
  const info = JSON.parse(result.stdout);
  assert.match(info.id, /^\d{8}-\d{4}-hello-world$/);
  assert.equal(fs.readFileSync(path.join(info.dir, 'REQUIREMENT.md'), 'utf8'), '原始需求\n不要改写\n');
  assert.equal((await f.run(['start', 'brainstorm', '--size', 'S'])).code, 0);
  assert.deepEqual(Object.keys(f.readState().state.nodes), Object.keys(nodeTable('S')));
  assert.equal((await f.run(['init', '--title', 'explicit', '--size', 'L'])).code, 0);
  assert.equal((await f.run(['start', 'brainstorm', '--size', 'S'])).code, 1);
});

test('中文需求生成的 run id 可显式选择，路径穿越被拒绝', async t => {
  const f = fixture(t);
  const result = await f.run(['init', '--title', '一键开发', '--json']);
  const info = JSON.parse(result.stdout);
  assert.equal((await f.run(['status', '--run', info.id])).code, 0);
  assert.equal((await f.run(['status', '--run', '../other'])).code, 1);
});

test('init 记录目标仓库 HEAD，非 Git 或尚无提交时 baseCommit 为 null', async t => {
  const f = fixture(t);
  await ready(f);
  assert.equal(f.readState().state.baseCommit, null);
  const repo = new URL('../../', import.meta.url);
  const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: repo, encoding: 'utf8' }).trim();
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  // 只读现有仓库 HEAD，不创建提交、不改变仓库引用或工作区。
  const result = await f.run(['init', '--title', 'git-head', '--json'], {
    env: { ...f.env, GIT_DIR: gitDir, GIT_WORK_TREE: f.cwd }
  });
  assert.equal(result.code, 0, result.stderr);
  const { dir } = JSON.parse(result.stdout);
  assert.equal(readJSON(path.join(dir, 'state.json')).baseCommit, head);
  const unborn = fixture(t);
  execFileSync('git', ['init', '--quiet'], { cwd: unborn.cwd });
  await ready(unborn);
  assert.equal(unborn.readState().state.baseCommit, null);
});

test('run id 使用本地年月日时分，state ISO 时间仍为 UTC', t => {
  const f = fixture(t);
  const originalTZ = process.env.TZ;
  t.after(() => { if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ; });
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-03T15:10:00Z') });
  const root = path.join(f.cwd, 'runs');
  for (const [tz, expected] of [['Pacific/Auckland', '20261104-0410-local'], ['Pacific/Honolulu', '20261103-0510-local']]) {
    process.env.TZ = tz;
    const { state } = initRun(root, 'local', 'M', null, '需求', f.cwd);
    assert.equal(state.id, expected);
    assert.equal(state.createdAt, '2026-11-03T15:10:00.000Z');
  }
});

test('设计章节允许编号、空白和括号后缀，版本号可在前 10 行任意位置', t => {
  const f = fixture(t);
  const content = design.replace('版本：v1.0', '设计修订 v2.3.4').replace(/^## (.+)$/gm, '##  2.  $1（A1–A8）');
  for (const separator of ['.', '、']) {
    fs.writeFileSync(path.join(f.cwd, 'DESIGN.md'), content.replaceAll('2.', `2${separator}`));
    assert.doesNotThrow(() => validateDesign(f.cwd));
  }
  const unversioned = design.replace('版本：v1.0', '设计说明');
  fs.writeFileSync(path.join(f.cwd, 'DESIGN.md'), Array(9).fill('说明').join('\n') + '\nv3\n' + unversioned);
  assert.doesNotThrow(() => validateDesign(f.cwd));
  fs.writeFileSync(path.join(f.cwd, 'DESIGN.md'), Array(10).fill('说明').join('\n') + '\nv3\n' + unversioned);
  assert.throws(() => validateDesign(f.cwd), /前 10 行需要版本号/);
  fs.writeFileSync(path.join(f.cwd, 'DESIGN.md'), content.replace('验收标准', '非验收标准'));
  assert.throws(() => validateDesign(f.cwd), /缺少章节：验收标准/);
});
