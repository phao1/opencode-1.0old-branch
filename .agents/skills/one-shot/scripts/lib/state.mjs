import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const now = () => new Date().toISOString();
export const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const nonempty = file => fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim().length > 0;
export function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}
export function atomicJSON(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    write(tmp, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}
export function lock(dir) {
  const file = path.join(dir, '.lock');
  fs.mkdirSync(dir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: now() }));
      fs.closeSync(fd);
      return () => fs.rmSync(file, { force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = readJSON(file); } catch { throw new Error(`锁内容不可读：${file}`); }
      if (alive(owner.pid)) throw new Error(`run 已锁定，pid=${owner.pid}`);
      fs.rmSync(file, { force: true });
    }
  }
  throw new Error(`无法取得锁：${file}`);
}
export function nodeTable(size) {
  if (!['S', 'M', 'L'].includes(size)) throw new Error('size 必须是 S、M 或 L');
  const names = size === 'S' ? ['brainstorm', 'impl', 'verify', 'deliver']
    : ['brainstorm', 'design', 'improve', 'impl', 'verify', ...(size === 'L' ? ['review'] : []), 'deliver'];
  return Object.fromEntries(names.map(name => [name, { status: 'pending' }]));
}
export function save(dir, state) {
  state.updatedAt = now();
  atomicJSON(path.join(dir, 'state.json'), state);
}
export function event(state, action, detail) {
  state.timeline.push({ at: now(), action, detail });
}
export function nextNode(state) {
  return Object.entries(state.nodes).find(([, n]) => !['done', 'skipped'].includes(n.status))?.[0] ?? null;
}
export function selectRun(root, id) {
  if (id && !/^[a-zA-Z0-9_\u4e00-\u9fff-]+$/.test(id)) throw new Error('非法 run id');
  if (id) {
    const dir = path.join(root, id);
    return { dir, state: readJSON(path.join(dir, 'state.json')) };
  }
  const runs = fs.existsSync(root) ? fs.readdirSync(root).filter(n => fs.existsSync(path.join(root, n, 'state.json')))
    .map(n => ({ dir: path.join(root, n), state: readJSON(path.join(root, n, 'state.json')) })) : [];
  runs.sort((a, b) => b.state.createdAt.localeCompare(a.state.createdAt));
  const selected = runs.find(r => nextNode(r.state));
  if (!selected) throw new Error('没有未完成 run；请 init 或显式指定 --run <id>');
  return selected;
}
export function initRun(root, title, size, slug, requirement, cwd) {
  const date = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  let baseCommit = null;
  try { baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch {}
  slug = (slug || title).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'task';
  const id = `${stamp}-${slug}`;
  const nodes = nodeTable(size);
  const dir = path.join(root, id);
  fs.mkdirSync(root, { recursive: true });
  // 不覆盖同一分钟的同名 run，避免需求和历史被静默替换。
  fs.mkdirSync(dir);
  const state = { version: 2, id, title, size, sizeExplicit: false, baseCommit, createdAt: now(), updatedAt: now(), nodes, checks: [], rounds: { improve: {}, review: {} }, impl: { attempts: [] }, timeline: [] };
  write(path.join(dir, 'REQUIREMENT.md'), `${requirement || title}\n`);
  event(state, 'init', size);
  save(dir, state);
  return { dir, state };
}
export const designSections = ['目标与范围', '验收标准', '关键决策', '实施计划', '验证命令', '变更记录'];
export function validateDesign(dir) {
  const file = path.join(dir, 'DESIGN.md');
  if (!nonempty(file)) throw new Error('缺少非空 DESIGN.md');
  const content = fs.readFileSync(file, 'utf8');
  const headings = [...content.matchAll(/^#{1,6}\s+(.+)$/gm)].map(m => m[1].trim().replace(/^\d+[.、]\s*/, ''));
  const missing = designSections.filter(s => !headings.some(h => h.startsWith(s)));
  if (missing.length) throw new Error(`DESIGN.md 缺少章节：${missing.join('、')}`);
  if (!/\bA\d+\b/.test(content)) throw new Error('验收标准需要 A1 等 ID');
  if (!/v\d+(\.\d+)*/i.test(content.split('\n').slice(0, 10).join('\n'))) throw new Error('DESIGN.md 前 10 行需要版本号');
}
