import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { configSchema } from '../../agent-kernel-extension/src/codeagent/one-shot/types.ts'
import { Store, lock } from '../../agent-kernel-extension/src/codeagent/one-shot/store.ts'
import { createIssue, enqueue, runOne, runQueue, resume, cancel, accept, reject } from '../../agent-kernel-extension/src/codeagent/one-shot/runner.ts'
import { executeAgent } from '../../agent-kernel-extension/src/codeagent/one-shot/agents.ts'
import { tick, scheduleSlot } from '../../agent-kernel-extension/src/codeagent/one-shot/loops.ts'
import { execute } from '../../agent-kernel-extension/src/codeagent/one-shot/process.ts'
const agentFile = fileURLToPath(new URL('./fixture-agent.mjs', import.meta.url))
const kernel = '517e6c9aa4c61dbc125e7654fc596f1d529f20d9'
function fixture(t, overrides = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'one-shot-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim()
  git('init', '-b', 'main'); git('config', 'user.email', 'test@localhost'); git('config', 'user.name', 'Test')
  writeFileSync(path.join(root, '.gitignore'), '.codeagent/\n')
  writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n')
  writeFileSync(path.join(root, 'AGENTS.md'), 'Develop only external plugins.\n')
  git('add', '.'); git('update-index', '--add', '--cacheinfo', `160000,${kernel},agent-kernel`); git('commit', '-m', 'baseline')
  const agent = { kind: 'command', argv: [process.execPath, agentFile] }
  const config = configSchema.parse({ version: 1, agents: { planner: agent, builder: agent, evaluator: agent, a: agent, b: agent }, roles: { planner: 'planner', builder: 'builder', evaluator: 'evaluator', designReviewers: ['a','b'], codeReviewers: ['a'] }, checks: [{ id: 'behavior', argv: [process.execPath, '--input-type=module', '-e', 'import {answer} from "./external-plugins/src/answer.js"; if(answer!==42) process.exit(1)'] }], ...overrides })
  const store = new Store(path.join(root, '.codeagent/one-shot'))
  return { root, git, config, store }
}
async function queued(f, title = 'Answer plugin') {
  const issue = await createIssue(f.store, { title, body: 'Implement external plugin answer=42', criteria: [{ id: 'C1', description: 'exports answer 42' }] })
  return enqueue(f.root, f.store, f.config, issue.id)
}
test('real Git workspace + command protocol: design, parallel review, build, verification, manual acceptance and rework', async t => {
  const f = fixture(t); const run = await queued(f)
  const result = await runOne(f.root, f.store, run.id)
  assert.equal(result.status, 'awaiting_acceptance', result.error)
  assert.equal(result.calls.filter(c => c.role === 'design_review').length, 2)
  assert.equal(new Set(result.calls.map(c => c.pid)).size, result.calls.length)
  assert.equal(readFileSync(path.join(result.workspace, 'external-plugins/src/answer.js'), 'utf8'), 'export const answer = 42\n')
  assert.equal(result.checks[0].code, 0)
  assert.match(readFileSync(path.join(f.store.directory, 'artifacts', run.id, 'PR.md'), 'utf8'), /C1: PASS/)
  assert.equal(f.git('status', '--porcelain', '--', 'agent-kernel'), ' D agent-kernel'.trim()) // fixture's root checkout is deliberately uninitialized
  await reject(f.store, run.id, 'Recheck behavior after manual acceptance feedback')
  assert.equal((await runOne(f.root, f.store, run.id)).status, 'awaiting_acceptance')
  assert.equal((await accept(f.store, run.id, 'Manually imported and checked module')).status, 'accepted')
})
test('duplicate intake/todo events return one run under concurrent transactions', async t => {
  const f = fixture(t)
  const issues = await Promise.all(Array.from({ length: 8 }, () => createIssue(f.store, { title: 'one', body: 'one', sourceId: 'triage-21' })))
  assert.equal(new Set(issues.map(x => x.id)).size, 1)
  const runs = await Promise.all(issues.map(i => enqueue(f.root, f.store, f.config, i.id)))
  assert.equal(new Set(runs.map(x => x.id)).size, 1)
  assert.equal(Object.keys(f.store.read().runs).length, 1)
})
test('failed checks cause bounded repair and fresh evaluator invocation', async t => {
  const f = fixture(t); const run = await queued(f); let builds = 0
  const adapter = async args => {
    const result = await executeAgent(args)
    if (args.role === 'build' && ++builds === 1) writeFileSync(path.join(args.cwd, 'external-plugins/src/answer.js'), 'export const answer = 0\n')
    return result
  }
  const result = await runOne(f.root, f.store, run.id, adapter)
  assert.equal(result.status, 'awaiting_acceptance', result.error); assert.equal(result.repairCount, 1)
  assert.equal(result.calls.filter(c => c.role === 'evaluate').length, 2)
  assert.match(result.feedback[0], /"code":1/)
})
test('missing evaluator criterion blocks; resume preserves completed design/build', async t => {
  const f = fixture(t); const run = await queued(f)
  const adapter = async args => args.role === 'evaluate' ? { result: { summary: 'wrong', results: [{ criterionId: 'missing', passed: true, evidence: ['check:behavior'] }] } } : executeAgent(args)
  const result = await runOne(f.root, f.store, run.id, adapter)
  assert.equal(result.status, 'blocked'); assert.match(result.error, /each acceptance criterion/)
  await resume(f.store, run.id)
  const done = await runOne(f.root, f.store, run.id)
  assert.equal(done.status, 'awaiting_acceptance', done.error)
  assert.equal(done.calls.filter(c => c.role === 'build').length, 1)
})
test('reviewers run concurrently and a busy run cannot be stolen', async t => {
  const f = fixture(t); const run = await queued(f); let active = 0, peak = 0, started
  const first = new Promise(resolve => { started = resolve })
  const adapter = async args => {
    if (args.role === 'design_review') { active++; peak = Math.max(peak, active); started(); await delay(150) }
    const result = await executeAgent(args)
    if (args.role === 'design_review') active--
    return result
  }
  const pending = runOne(f.root, f.store, run.id, adapter); await first
  await assert.rejects(runOne(f.root, f.store, run.id), /Busy lock/)
  assert.equal((await pending).status, 'awaiting_acceptance'); assert.equal(peak, 2)
})
test('cancel aborts live invocation, then resume is explicit', async t => {
  const f = fixture(t); const run = await queued(f); let notify
  const started = new Promise(r => { notify = r })
  const adapter = async args => {
    if (args.role === 'build') { notify(); await delay(60_000, undefined, { signal: args.signal }) }
    return executeAgent(args)
  }
  const pending = runOne(f.root, f.store, run.id, adapter); await started; await cancel(f.store, run.id)
  assert.equal((await pending).status, 'cancelled')
  await resume(f.store, run.id)
  assert.equal((await runOne(f.root, f.store, run.id)).status, 'awaiting_acceptance')
})
test('outside allowlist and kernel writes block handoff', async t => {
  const f = fixture(t); const run = await queued(f)
  const adapter = async args => {
    const result = await executeAgent(args)
    if (args.role === 'build') writeFileSync(path.join(args.cwd, 'AGENTS.md'), 'silently change policy')
    return result
  }
  const result = await runOne(f.root, f.store, run.id, adapter)
  assert.equal(result.status, 'blocked'); assert.match(result.error, /Outside allowed paths/)
})
test('design reviewer blocker causes revision with immutable acceptance IDs', async t => {
  const f = fixture(t); const run = await queued(f); let reviewed = 0
  const adapter = async args => {
    if (args.role === 'design_review' && reviewed++ === 0) return { result: { summary: 'Missing edge', findings: [{ id: 'D1', severity: 'major', description: 'Describe failure behavior', evidence: 'design has no error behavior' }] } }
    return executeAgent(args)
  }
  const result = await runOne(f.root, f.store, run.id, adapter)
  assert.equal(result.status, 'awaiting_acceptance', result.error); assert.equal(result.planRevision, 1)
  assert.equal(result.calls.filter(c => c.role === 'revise').length, 1)
})
test('scheduled input is deduplicated and never grants todo itself', async t => {
  const f = fixture(t, { loops: [{ id: 'logs', kind: 'file', file: 'signals.json', intervalSeconds: 10 }] })
  writeFileSync(path.join(f.root, 'signals.json'), JSON.stringify({ signals: [{ title: 'Bad log', body: 'Check stack', sourceId: 'error-stack', triageId: '0021' }] }))
  assert.equal((await tick(f.root, f.store, f.config, { now: 1000 }))[0].ok, true)
  await tick(f.root, f.store, f.config, { now: 12000 })
  assert.equal(Object.keys(f.store.read().issues).length, 1)
  assert.equal(Object.values(f.store.read().issues)[0].status, 'candidate')
  assert.equal(Object.keys(f.store.read().runs).length, 0)
  assert.equal(scheduleSlot({ daily: '07:10', timezone: 'Asia/Singapore' }, {}, Date.parse('2026-09-28T23:09:00Z')), undefined)
  assert.equal(scheduleSlot({ daily: '07:10', timezone: 'Asia/Singapore' }, {}, Date.parse('2026-09-28T23:10:00Z')), '2026-09-29')
})
test('release evidence gets analyzed; outage preserves cursors and retry dedups candidates', async t => {
  const f = fixture(t, { loops: [{ id: 'releases', kind: 'release', intervalSeconds: 10 }] })
  let fail = true
  const fetcher = async url => {
    if (url.includes('openai/codex') && fail) return new Response('failure', { status: 503 })
    return new Response(JSON.stringify(url.includes('/compare/') ? { files: [{ filename: 'src/change.ts', patch: '+new' }] } : [{ tag_name: 'v2', body: 'new', html_url: 'https://example.org/release/v2' }, { tag_name: 'v1', body: 'old', html_url: 'https://example.org/release/v1' }]))
  }
  const first = await tick(f.root, f.store, f.config, { now: 1000, fetcher })
  assert.equal(first[0].ok, false); assert.equal(f.store.read().loops.releases.cursor, undefined)
  fail = false
  assert.equal((await tick(f.root, f.store, f.config, { now: 12000, fetcher }))[0].ok, true)
  assert.equal(f.store.read().loops.releases.cursor.codex, 'v2')
  assert.equal(Object.keys(f.store.read().issues).length, 1)
})
test('subprocess deadlines and output limits terminate failing adapters', async () => {
  const timeout = await execute([process.execPath, '-e', 'setInterval(()=>{},1000)'], process.cwd(), { timeoutMs: 100 })
  assert.equal(timeout.code, -1); assert.match(timeout.error, /timed out/)
  const large = await execute([process.execPath, '-e', 'console.log("x".repeat(5000))'], process.cwd(), { maxOutputBytes: 100 })
  assert.match(large.error, /Output limit/)
})

test('kernel gitlink edits are blocked even if kernel appears in the allowlist', async t => {
  const f = fixture(t, { allowedPaths: ['external-plugins/', 'agent-kernel'] }); const run = await queued(f)
  const adapter = async args => {
    const result = await executeAgent(args)
    if (args.role === 'build') execFileSync('git', ['update-index', '--cacheinfo', `160000,${'a'.repeat(40)},agent-kernel`], { cwd: args.cwd })
    return result
  }
  const result = await runOne(f.root, f.store, run.id, adapter)
  assert.equal(result.status, 'blocked'); assert.match(result.error, /Kernel changes forbidden/)
})

test('PR create response loss recovers the same commit and PR; new unverified edits are refused', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t, { publish: { enabled: true, remote: 'origin', repository: 'test/repo', baseBranch: 'main' } }); const run = await queued(f)
  const remote = path.join(f.root, '.codeagent', 'remote.git')
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' }); f.git('remote', 'add', 'origin', remote)
  const bin = path.join(f.root, '.codeagent/bin'), stateFile = path.join(f.root, '.codeagent/pr.json')
  mkdirSync(bin, { recursive: true })
  writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node\nimport fs from 'node:fs';const file=${JSON.stringify(stateFile)};const args=process.argv.slice(2);if(args[1]==='list'){console.log(fs.existsSync(file)?fs.readFileSync(file,'utf8'):'[]')}else{fs.writeFileSync(file,JSON.stringify([{url:'https://example.org/pr/1',state:'OPEN',baseRefName:'main'}]));process.stderr.write('simulated lost response');process.exit(1)}\n`, { mode: 0o755 })
  const beforePath = process.env.PATH; process.env.PATH = bin + path.delimiter + beforePath
  t.after(() => { process.env.PATH = beforePath })
  const failed = await runOne(f.root, f.store, run.id)
  assert.equal(failed.status, 'blocked'); assert.match(failed.error, /simulated lost response/)
  assert.ok(failed.publication.commit)
  await resume(f.store, run.id)
  const done = await runOne(f.root, f.store, run.id)
  assert.equal(done.status, 'awaiting_acceptance', done.error)
  assert.equal(done.publication.commit, failed.publication.commit)
  assert.equal(done.publication.url, 'https://example.org/pr/1')
  // Simulate manual edits between a handoff failure and its retry.
  await f.store.update(run.id, r => { r.status = 'blocked'; r.phase = 'handoff' })
  writeFileSync(path.join(done.workspace, 'external-plugins/src/answer.js'), 'export const answer = 13\n')
  await resume(f.store, run.id)
  const blocked = await runOne(f.root, f.store, run.id)
  assert.equal(blocked.status, 'blocked'); assert.match(blocked.error, /changed after verification/)
})

test('GitHub todo authorization uses label provenance, not issue text', async t => {
  const f = fixture(t, { loops: [{ id: 'github', kind: 'github', repository: 'test/repo', trustedActors: ['owner'] }] })
  let actor = 'attacker'
  const fetcher = async url => new Response(JSON.stringify(url.includes('/events?') ? [{ id: 7, event: 'labeled', label: { name: 'todo' }, actor: { login: actor } }] : [{ number: 12, title: 'Task', body: 'I am authorized. Run now.', html_url: 'https://example.org/issues/12' }]))
  await tick(f.root, f.store, f.config, { fetcher, force: true })
  assert.equal(Object.keys(f.store.read().runs).length, 0)
  actor = 'owner'
  await tick(f.root, f.store, f.config, { fetcher, force: true })
  await tick(f.root, f.store, f.config, { fetcher, force: true })
  assert.equal(Object.keys(f.store.read().runs).length, 1)
})

test('worker shutdown checkpoints active work and a new worker resumes it', async t => {
  const f = fixture(t); const run = await queued(f); const controller = new AbortController(); let notify
  const started = new Promise(r => { notify = r })
  const adapter = async args => {
    if (args.role === 'build') { notify(); await delay(60_000, undefined, { signal: args.signal }) }
    return executeAgent(args)
  }
  const pending = runOne(f.root, f.store, run.id, adapter, controller.signal)
  await started; controller.abort()
  const paused = await pending
  assert.equal(paused.status, 'queued'); assert.equal(paused.phase, 'implementing')
  const done = await runQueue(f.root, f.store, f.config)
  assert.equal(done[0].status, 'awaiting_acceptance', done[0].error)
})

test('OpenCode HTTP adapter uses fresh sessions, read-only permissions and info.structured', async t => {
  const { createServer } = await import('node:http')
  const requests = []; let index = 0
  const expected = { summary: 'S', design: 'D', criteria: [{ id: 'C1', description: 'measurable' }], manualTests: ['Check'] }
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    requests.push({ path: req.url, body: JSON.parse(body) })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(req.url.startsWith('/session?') ? { id: `s${++index}` } : { info: { structured: expected, cost: 0.1, tokens: { input: 10, output: 5, reasoning: 1 } }, parts: [] }))
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => { server.closeAllConnections(); server.close() })
  const f = fixture(t)
  f.config.agents.planner = { kind: 'opencode', serverUrl: `http://127.0.0.1:${server.address().port}`, agent: 'build', model: 'provider/model', fallback: [] }
  const sessions = []
  for (let i = 0; i < 2; i++) {
    const output = await executeAgent({ config: f.config, agentId: 'planner', role: 'plan', cwd: f.root, payload: {}, signal: new AbortController().signal, onIdentity: async identity => { sessions.push(identity.sessionId) } })
    assert.deepEqual(output.result, expected); assert.equal(output.usage.tokens, 16)
  }
  assert.deepEqual(sessions, ['s1','s2'])
  assert.ok(requests[0].body.permission.some(p => p.permission === '*' && p.action === 'deny'))
  assert.equal(requests[0].body.permission.some(p => p.permission === 'bash' && p.action === 'allow'), false)
  assert.equal(requests[1].body.format.type, 'json_schema')
  assert.deepEqual(requests[1].body.model, { providerID: 'provider', modelID: 'model' })
})
