import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { write } from './state.mjs';

const active = new Set();
export const track = pid => active.add(pid);
export const untrack = pid => active.delete(pid);
export function killGroup(pid) {
  if (!pid) return;
  try { process.kill(-pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
export function installSignals() {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      for (const pid of active) killGroup(pid);
      // 原子状态已经落盘；留下的锁由下一进程按死 pid 回收。
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  }
}
export function resolveBin(candidates) {
  for (const candidate of [candidates].flat()) {
    if (!candidate) continue;
    const paths = candidate.includes('/') ? [path.resolve(candidate)] : (process.env.PATH || '').split(path.delimiter).map(p => path.join(p, candidate));
    for (const file of paths) {
      try { fs.accessSync(file, fs.constants.X_OK); if (fs.statSync(file).isFile()) return file; } catch {}
    }
  }
  return null;
}
export function render(value, vars) {
  return value.replace(/\{(\w+)\}/g, (all, key) => vars[key] ?? all);
}
export function execute({ bin, args = [], cwd, input = '', timeout = 90000, log, stdoutFile, onStdout }) {
  write(log, '');
  if (stdoutFile) write(stdoutFile, '');
  return new Promise(resolve => {
    const started = Date.now();
    let timedOut = false;
    let failure;
    let sample = '';
    const child = spawn(bin, args, { cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    if (child.pid) active.add(child.pid);
    const collect = (chunk, isStdout) => {
      fs.appendFileSync(log, chunk);
      if (isStdout && stdoutFile) fs.appendFileSync(stdoutFile, chunk);
      if (isStdout) onStdout?.(chunk.toString());
      if (sample.length < 16000) sample += chunk.toString().slice(0, 16000 - sample.length);
    };
    child.stdout.on('data', chunk => collect(chunk, true));
    child.stderr.on('data', chunk => collect(chunk, false));
    child.stdin.on('error', () => {});
    child.on('error', error => { failure = error.message; });
    child.stdin.end(input);
    const timer = setTimeout(() => { timedOut = true; killGroup(child.pid); }, timeout);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      active.delete(child.pid);
      // 主进程退出也要收掉遗留子进程，防止后台后代继续修改或占用管道。
      killGroup(child.pid);
      resolve({ status: timedOut ? 'timeout' : failure || code !== 0 ? 'failed' : 'ok',
        reason: timedOut ? `timeout after ${timeout / 1000}s` : failure || (code !== 0 ? `exit ${code}, signal ${signal || 'none'}` : ''),
        code, signal, pid: child.pid, durationMs: Date.now() - started, sample });
    });
  });
}
export function eventReader(onID) {
  let pending = '';
  return chunk => {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        const id = e.thread_id || e.session_id || e.thread?.id || e.session?.id;
        if (id) onID(id);
      } catch {}
    }
  };
}
