import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJSON, atomicJSON, nonempty, write, now } from './state.mjs';
import { execute, resolveBin, render } from './process.mjs';

export const skillDir = fileURLToPath(new URL('../../', import.meta.url));
export function loadConfig(cwd, file) {
  const base = readJSON(path.join(skillDir, 'config.json'));
  const override = file ? path.resolve(file) : path.join(cwd, 'oneshot.config.json');
  const extra = fs.existsSync(override) ? readJSON(override) : {};
  if (file && !fs.existsSync(override)) throw new Error(`config 不存在：${override}`);
  const config = { ...base, ...extra, generator: { ...base.generator, ...extra.generator }, host: { ...base.host, ...extra.host } };
  const ids = new Set();
  for (const a of config.agents) {
    if (!/^[a-zA-Z0-9@._-]+$/.test(a.id) || ids.has(a.id)) throw new Error(`非法或重复 agent id：${a.id}`);
    ids.add(a.id);
    if (a.readonly !== true) throw new Error(`${a.id} 必须声明 readonly: true`);
  }
  return config;
}
export const instruction = file => `读取并执行 ${file} 中的指令，把答案输出到 stdout。\n`;
export async function invokeAgent(agent, { cwd, prompt, out, log, timeout }) {
  const bin = resolveBin(agent.bin);
  if (!bin) return { status: 'unavailable', reason: 'binary not found', durationMs: 0 };
  const vars = { cwd, prompt_file: prompt, out_file: out, model: agent.model || '', instruction: instruction(prompt).trim() };
  fs.rmSync(out, { force: true });
  const result = await execute({ bin, args: agent.args.map(a => render(a, vars)), cwd,
    input: agent.stdin ? instruction(prompt) : '', timeout, log, stdoutFile: agent.output === 'file' ? undefined : out });
  delete result.sample;
  if (result.status === 'ok' && !nonempty(out)) Object.assign(result, { status: 'failed', reason: 'empty output' });
  return result;
}
const authFailure = /not logged in|authentication required|missing_credential|please (?:log|sign) in|invalid api key|not authenticated|unauthorized/i;
export async function probeAgents(config, cwd, refresh = false) {
  const cacheFile = path.join(process.env.ONESHOT_CACHE_DIR || path.join(os.homedir(), '.cache/oneshot'), 'agents.json');
  // 配置签名是普通 JSON，只用于隔离缓存，非信任/防篡改机制。
  const signature = JSON.stringify({ agents: config.agents, probeTimeoutSeconds: config.probeTimeoutSeconds });
  if (!refresh && fs.existsSync(cacheFile)) {
    try {
      const cache = readJSON(cacheFile);
      if (cache.signature === signature && Date.now() - Date.parse(cache.at) < config.cacheTTLHours * 3600000) return cache.results;
    } catch {}
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'oneshot-probe-'));
  try {
    const results = await Promise.all(config.agents.map(async agent => {
      const prompt = path.join(temp, `${agent.id}.prompt.md`);
      const out = path.join(temp, `${agent.id}.md`);
      const log = path.join(temp, `${agent.id}.log`);
      write(prompt, '仅回复 PONG，不使用工具，不读取其他文件。\n');
      const result = await invokeAgent(agent, { cwd, prompt, out, log, timeout: config.probeTimeoutSeconds * 1000 });
      const answer = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
      const transcript = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
      let reason = result.reason;
      if (authFailure.test(answer + '\n' + transcript)) reason = 'authentication required / not logged in';
      else if (result.status === 'ok' && !/\bPONG\b/.test(answer)) reason = 'probe response missing PONG';
      return { id: agent.id, model: agent.model || null, available: result.status === 'ok' && !reason,
        reason: reason || 'PONG', durationMs: result.durationMs, at: now() };
    }));
    atomicJSON(cacheFile, { at: now(), signature, results });
    return results;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
