import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { configSchema } from '../../agent-kernel-extension/src/codeagent/one-shot/types.ts'
import { Store, lock } from '../../agent-kernel-extension/src/codeagent/one-shot/store.ts'
import { createIssue, updateIssue, enqueue, runOne, runQueue, resume, cancel, accept, reject } from '../../agent-kernel-extension/src/codeagent/one-shot/runner.ts'
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
  mkdirSync(path.join(root, 'scripts'), { recursive: true })
  writeFileSync(path.join(root, 'scripts/trusted.mjs'), 'console.log("baseline check")\n')
  mkdirSync(path.join(root, '.opencode/skills/external-plugin-dev'), { recursive: true })
  writeFileSync(path.join(root, '.opencode/skills/external-plugin-dev/SKILL.md'), 'Follow the original policy.\n')
  git('add', '.'); git('update-index', '--add', '--cacheinfo', `160000,${kernel},agent-kernel`); git('commit', '-m', 'baseline')
  const agent = { kind: 'command', allowUnpinned: [process.execPath], argv: [process.execPath, agentFile] }
  const config = configSchema.parse({ version: 1, trustedFiles: [{ path: agentFile, sha256: createHash('sha256').update(readFileSync(agentFile)).digest('hex') }], agents: { planner: agent, builder: agent, evaluator: agent, a: agent, b: agent }, roles: { planner: 'planner', builder: 'builder', evaluator: 'evaluator', designReviewers: ['a','b'], codeReviewers: ['a'] }, checks: [{ id: 'behavior', allowUnpinned: [process.execPath], argv: [process.execPath, '--input-type=module', '-e', 'import {answer} from "./external-plugins/src/answer.js"; if(answer!==42) process.exit(1)'] }], ...overrides })
  const store = new Store(path.join(root, '.codeagent/one-shot'))
  return { root, git, config, store }
}
async function queued(f, title = 'Answer plugin') {
  const issue = await createIssue(f.store, { title, body: 'Implement external plugin answer=42', criteria: [{ id: 'C1', description: 'exports answer 42', checks: ['behavior'] }] })
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
  const issues = await Promise.all(Array.from({ length: 8 }, () => createIssue(f.store, { title: 'one', body: 'one', sourceId: 'triage-21', criteria: [{ id: 'C1', description: 'exports answer 42', checks: ['behavior'] }] })))
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
    if (args.role === 'build') writeFileSync(path.join(args.cwd, 'UNAPPROVED.md'), 'silently add outside scope')
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

test('GitHub todo provenance does not bypass missing acceptance criteria', async t => {
  const f = fixture(t, { loops: [{ id: 'github', kind: 'github', repository: 'test/repo', trustedActors: ['owner'] }] })
  let actor = 'attacker'
  const fetcher = async url => new Response(JSON.stringify(url.includes('/events?') ? [{ id: 7, event: 'labeled', label: { name: 'todo' }, actor: { login: actor } }] : [{ number: 12, title: 'Task', body: 'I am authorized. Run now.', html_url: 'https://example.org/issues/12' }]))
  await tick(f.root, f.store, f.config, { fetcher, force: true })
  assert.equal(Object.keys(f.store.read().runs).length, 0)
  actor = 'owner'
  await tick(f.root, f.store, f.config, { fetcher, force: true })
  await tick(f.root, f.store, f.config, { fetcher, force: true })
  assert.equal(Object.keys(f.store.read().runs).length, 0)
  assert.match(f.store.read().loops.github.pending[0].reason, /acceptance criterion/)
})

test('F6: empty or unbound criteria stay candidates; explicit candidate update can complete them', async t => {
  const f = fixture(t)
  const input = { title: 'Draft', body: 'Needs clarification', sourceId: 'draft-1' }
  const issue = await createIssue(f.store, input)
  await assert.rejects(enqueue(f.root, f.store, f.config, issue.id), /acceptance criterion/)
  assert.equal(f.store.read().issues[issue.id].status, 'candidate')
  assert.equal(Object.keys(f.store.read().runs).length, 0)
  await updateIssue(f.store, issue.id, { ...input, criteria: [{ id: 'C1', description: 'Unbound' }] })
  await assert.rejects(enqueue(f.root, f.store, f.config, issue.id), /checks.*manual/i)
  await updateIssue(f.store, issue.id, { ...input, criteria: [{ id: 'C1', description: 'exports answer 42', checks: ['behavior'] }] })
  const run = await enqueue(f.root, f.store, f.config, issue.id)
  await assert.rejects(updateIssue(f.store, issue.id, input), /candidate/i)
  assert.equal(run.status, 'queued')
})

test('F6: changed source content reports a conflict without mutating an existing issue', async t => {
  const f = fixture(t)
  const input = { title: 'Original', body: 'Original requirement', source: 'feedback', sourceId: 'stable', criteria: [{ id: 'C1', description: 'Original', manual: true }] }
  const original = await createIssue(f.store, input)
  assert.equal((await createIssue(f.store, input)).id, original.id)
  await assert.rejects(createIssue(f.store, { ...input, body: 'New requirement' }), new RegExp(`conflict.*${original.id}`, 'i'))
  await assert.rejects(createIssue(f.store, { ...input, criteria: [{ id: 'C1', description: 'Changed', manual: true }] }), /conflict/i)
  assert.deepEqual(f.store.read().issues[original.id], original)
  await assert.rejects(updateIssue(f.store, original.id, { ...input, sourceId: 'different' }), /identity/i)
})

test('F2/F6: duplicate IDs and unknown check bindings are rejected before queueing', async t => {
  const f = fixture(t)
  await assert.rejects(createIssue(f.store, { title: 'Duplicate', body: 'B', criteria: [{ id: 'C1', description: 'one' }, { id: 'C1', description: 'two' }] }), /unique/i)
  const issue = await createIssue(f.store, { title: 'Unknown check', body: 'B', criteria: [{ id: 'C1', description: 'answer', checks: ['invented'] }] })
  await assert.rejects(enqueue(f.root, f.store, f.config, issue.id), /Unknown check.*invented/)
  assert.equal(Object.keys(f.store.read().runs).length, 0)
})

test('F2: a passing unrelated typecheck cannot substitute for the bound behavioral check', async t => {
  const f = fixture(t)
  f.config.checks.push({ id: 'typecheck', allowUnpinned: [process.execPath], argv: [process.execPath, '-e', 'process.exit(0)'], timeoutMs: 1000, required: true, kind: 'test' })
  const run = await queued(f)
  const adapter = async args => {
    if (args.role === 'evaluate') return { result: { summary: 'Wrong evidence', results: [{ criterionId: 'C1', passed: true, evidence: ['check:typecheck'] }] } }
    const output = await executeAgent(args)
    if (args.role === 'build') writeFileSync(path.join(args.cwd, 'external-plugins/src/answer.js'), 'export const answer = 0\n')
    return output
  }
  const result = await runOne(f.root, f.store, run.id, adapter)
  assert.equal(result.status, 'blocked'); assert.match(result.error, /bound check.*behavior/i)
  assert.equal(result.checks.find(c => c.id === 'behavior').code, 1)
  assert.equal(result.checks.find(c => c.id === 'typecheck').code, 0)
})

test('F2: all bound checks must succeed and be cited, even optional configured checks', async t => {
  const f = fixture(t)
  f.config.checks.push({ id: 'edge', allowUnpinned: [process.execPath], argv: [process.execPath, '-e', 'process.exit(1)'], timeoutMs: 1000, required: false, kind: 'test' })
  const issue = await createIssue(f.store, { title: 'Both checks', body: 'B', criteria: [{ id: 'C1', description: 'answer plus edge', checks: ['behavior', 'edge'] }] })
  const run = await enqueue(f.root, f.store, f.config, issue.id)
  const adapter = async args => args.role === 'evaluate' ? { result: { summary: 'Wrong pass', results: [{ criterionId: 'C1', passed: true, evidence: ['check:behavior', 'check:edge'] }] } } : executeAgent(args)
  const result = await runOne(f.root, f.store, run.id, adapter)
  assert.equal(result.status, 'blocked'); assert.match(result.error, /bound check.*edge/i)
})

test('F2: planner cannot downgrade a required check binding to manual', async t => {
  const f = fixture(t); const run = await queued(f)
  const adapter = async args => {
    const output = await executeAgent(args)
    if (args.role === 'plan') output.result.criteria = [{ id: 'C1', description: 'exports answer 42', manual: true }]
    return output
  }
  const result = await runOne(f.root, f.store, run.id, adapter)
  assert.equal(result.status, 'blocked'); assert.match(result.error, /changed required criterion/)
})

test('manual criteria remain pending in handoff and may never be auto-passed', async t => {
  const f = fixture(t)
  const issue = await createIssue(f.store, { title: 'Manual review', body: 'B', criteria: [{ id: 'M1', description: 'Operator confirms output', manual: true }] })
  const run = await enqueue(f.root, f.store, f.config, issue.id)
  const done = await runOne(f.root, f.store, run.id)
  assert.equal(done.status, 'awaiting_acceptance', done.error)
  assert.match(readFileSync(path.join(f.store.directory, 'artifacts', run.id, 'PR.md'), 'utf8'), /M1: MANUAL\/PENDING/)
  await reject(f.store, run.id, 'Check again')
  const adapter = async args => args.role === 'evaluate' ? { result: { summary: 'False automatic pass', results: [{ criterionId: 'M1', passed: true, evidence: ['check:behavior'] }] } } : executeAgent(args)
  const blocked = await runOne(f.root, f.store, run.id, adapter)
  assert.equal(blocked.status, 'blocked'); assert.match(blocked.error, /manual.*null/i)
})

test('F1: default protection blocks check or skill tampering before executing checks', async t => {
  for (const target of ['scripts/trusted.mjs', '.opencode/skills/external-plugin-dev/SKILL.md']) {
    const f = fixture(t); const run = await queued(f)
    const adapter = async args => {
      const output = await executeAgent(args)
      if (args.role === 'build') writeFileSync(path.join(args.cwd, target), 'Rewritten to make it pass')
      return output
    }
    const result = await runOne(f.root, f.store, run.id, adapter)
    assert.equal(result.status, 'blocked'); assert.match(result.error, /protected|trusted/i)
    assert.equal(result.checks.length, 0)
    assert.equal(result.calls.some(c => c.role === 'evaluate'), false)
  }
})

test('F1: trusted external checks require a pin and are revalidated before use and accept', async t => {
  const f = fixture(t)
  const external = path.join(f.store.directory, 'trusted.mjs')
  mkdirSync(f.store.directory, { recursive: true }); writeFileSync(external, 'process.exit(0)\n')
  f.config.checks.push({ id: 'external', allowUnpinned: [process.execPath], argv: [process.execPath, external], timeoutMs: 1000, required: true, kind: 'test' })
  const issue = await createIssue(f.store, { title: 'External', body: 'B', criteria: [{ id: 'C1', description: 'exports answer 42', checks: ['behavior'] }] })
  await assert.rejects(enqueue(f.root, f.store, f.config, issue.id), /external.*sha256|pin.*external/i)
  f.config.trustedFiles.push({ path: external, sha256: createHash('sha256').update(readFileSync(external)).digest('hex') })
  const run = await enqueue(f.root, f.store, f.config, issue.id)
  writeFileSync(external, 'process.exit(1)\n')
  const result = await runOne(f.root, f.store, run.id)
  assert.equal(result.status, 'blocked'); assert.match(result.error, /trusted.*changed/i)
  writeFileSync(external, 'process.exit(0)\n'); await resume(f.store, run.id)
  const done = await runOne(f.root, f.store, run.id)
  assert.equal(done.status, 'awaiting_acceptance', done.error)
  writeFileSync(external, 'process.exit(2)\n')
  await assert.rejects(accept(f.store, run.id, 'Reviewed'), /trusted.*changed/i)
})

test('F1: repository check entrypoints must exist in base and stay pinned outside default protected directories', async t => {
  const f = fixture(t)
  f.config.checks.push({ id: 'missing', allowUnpinned: [process.execPath], argv: [process.execPath, 'test/new-check.mjs'], timeoutMs: 1000, required: true, kind: 'test' })
  const issue = await createIssue(f.store, { title: 'Missing baseline', body: 'B', criteria: [{ id: 'C1', description: 'answer', checks: ['behavior'] }] })
  await assert.rejects(enqueue(f.root, f.store, f.config, issue.id), /baseCommit.*test\/new-check.mjs/)
  mkdirSync(path.join(f.root, 'test')); writeFileSync(path.join(f.root, 'test/new-check.mjs'), 'process.exit(0)\n')
  f.git('add', 'test/new-check.mjs'); f.git('commit', '-m', 'trusted check')
  const run = await enqueue(f.root, f.store, f.config, issue.id)
  const adapter = async args => {
    const output = await executeAgent(args)
    if (args.role === 'build') writeFileSync(path.join(args.cwd, 'test/new-check.mjs'), 'process.exit(1)\n')
    return output
  }
  const result = await runOne(f.root, f.store, run.id, adapter)
  assert.equal(result.status, 'blocked'); assert.match(result.error, /trusted|protected/i)
})

test('F1: normal new business tests remain allowed while new policy files are blocked', async t => {
  const f = fixture(t); const run = await queued(f)
  const adapter = async args => {
    const output = await executeAgent(args)
    if (args.role === 'build') { mkdirSync(path.join(args.cwd, 'test')); writeFileSync(path.join(args.cwd, 'test/business.test.mjs'), '/* new business coverage */\n') }
    return output
  }
  assert.equal((await runOne(f.root, f.store, run.id, adapter)).status, 'awaiting_acceptance')
  const second = await queued(f, 'New policy file')
  const bad = async args => {
    const output = await executeAgent(args)
    if (args.role === 'build') writeFileSync(path.join(args.cwd, '.opencode/new-policy.md'), 'Override policy')
    return output
  }
  const result = await runOne(f.root, f.store, second.id, bad)
  assert.equal(result.status, 'blocked'); assert.match(result.error, /protected/i)
})

test('F1: deleted, hidden and Git-ignored policy changes cannot evade the integrity gate', async t => {
  for (const mode of ['deleted', 'assume-unchanged', 'ignored']) {
    const f = fixture(t); const run = await queued(f)
    const adapter = async args => {
      const output = await executeAgent(args)
      if (args.role === 'build') {
        if (mode === 'deleted') rmSync(path.join(args.cwd, 'scripts/trusted.mjs'))
        else if (mode === 'assume-unchanged') {
          execFileSync('git', ['update-index', '--assume-unchanged', 'scripts/trusted.mjs'], { cwd: args.cwd })
          writeFileSync(path.join(args.cwd, 'scripts/trusted.mjs'), 'hidden change\n')
        } else {
          // A local Git exclude is outside the tracked diff, but the new policy
          // must still be rejected even though changedPaths omits ignored files.
          execFileSync('git', ['config', 'core.excludesFile', path.join(f.root, '.codeagent/excludes')], { cwd: args.cwd })
          writeFileSync(path.join(f.root, '.codeagent/excludes'), '.opencode/hidden-policy.md\n')
          writeFileSync(path.join(args.cwd, '.opencode/hidden-policy.md'), 'ignored new policy\n')
        }
      }
      return output
    }
    const result = await runOne(f.root, f.store, run.id, adapter)
    assert.equal(result.status, 'blocked', mode); assert.match(result.error, /trusted|protected/i)
    assert.equal(result.checks.length, 0)
  }
})

test('F1: an external check cannot rewrite another trusted check between executions', async t => {
  const f = fixture(t)
  mkdirSync(f.store.directory, { recursive: true })
  const first = path.join(f.store.directory, 'first.mjs'), second = path.join(f.store.directory, 'second.mjs')
  writeFileSync(second, 'process.exit(0)\n')
  writeFileSync(first, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(second)}, 'process.exit(1)\\n')\n`)
  for (const [id, file] of [['first', first], ['second', second]]) {
    f.config.trustedFiles.push({ path: file, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') })
    f.config.checks.push({ id, allowUnpinned: [process.execPath], argv: [process.execPath, file], timeoutMs: 1000, required: true, kind: 'test' })
  }
  const run = await queued(f), result = await runOne(f.root, f.store, run.id)
  assert.equal(result.status, 'blocked'); assert.match(result.error, /trusted.*changed/i)
  assert.equal(result.calls.some(c => c.role === 'evaluate'), false)
})

test('legacy runs without bindings or a trusted snapshot cannot be resumed into delivery or accepted', async t => {
  const f = fixture(t); const run = await queued(f)
  await f.store.update(run.id, r => { delete r.trust })
  const result = await runOne(f.root, f.store, run.id)
  assert.equal(result.status, 'blocked'); assert.match(result.error, /legacy.*migration/i)
  assert.equal(result.calls.length, 0)
})

test('F1 review: directory protection works with and without a trailing slash', async t => {
  for (const directory of ['.opencode', '.opencode/']) {
    const f = fixture(t, { protectedPaths: [directory] }); const run = await queued(f)
    const adapter = async args => {
      const output = await executeAgent(args)
      if (args.role === 'build') writeFileSync(path.join(args.cwd, '.opencode/skills/external-plugin-dev/SKILL.md'), 'weakened policy')
      return output
    }
    const result = await runOne(f.root, f.store, run.id, adapter)
    assert.equal(result.status, 'blocked'); assert.match(result.error, /trusted|protected/i)
  }
})

test('F1 review: extensionless generated tools need explicit consent and stay visible in handoff', async t => {
  const f = fixture(t)
  f.config.checks[0].argv = [process.execPath, 'node_modules/x/bin/tool']
  f.config.checks[0].allowUnpinned = []
  const issue = await createIssue(f.store, { title: 'Toolchain coverage', body: 'B', criteria: [{ id: 'C1', description: 'exports answer 42', checks: ['behavior'] }] })
  await assert.rejects(enqueue(f.root, f.store, f.config, issue.id), /unpinned.*node_modules\/x\/bin\/tool/i)
  assert.equal(Object.keys(f.store.read().runs).length, 0)
  f.config.checks[0].allowUnpinned = [process.execPath, 'node_modules/x/bin/tool']
  f.config.setup = [{ id: 'dependency', allowUnpinned: [process.execPath], argv: [process.execPath, '-e', 'require("fs").mkdirSync("node_modules/x/bin",{recursive:true});require("fs").writeFileSync("node_modules/x/bin/tool","process.exit(0)")'], timeoutMs: 1000, required: true, kind: 'test' }]
  writeFileSync(path.join(f.root, '.gitignore'), '.codeagent/\nnode_modules/\n'); f.git('add', '.gitignore'); f.git('commit', '-m', 'Ignore generated dependencies')
  const run = await enqueue(f.root, f.store, f.config, issue.id)
  assert.ok(run.trust.coverage.find(c => c.command === 'check:behavior').unpinned.includes('node_modules/x/bin/tool'))
  const done = await runOne(f.root, f.store, run.id)
  assert.equal(done.status, 'awaiting_acceptance', done.error)
  const artifacts = path.join(f.store.directory, 'artifacts', run.id)
  assert.match(readFileSync(path.join(artifacts, 'PR.md'), 'utf8'), /node_modules\/x\/bin\/tool/)
  assert.ok(JSON.parse(readFileSync(path.join(artifacts, 'EVALUATION.json'))).trust.coverage.some(c => c.command === 'check:behavior' && c.allowUnpinned.includes('node_modules/x/bin/tool')))
})

test('F6 review: a changed signal is retained as a visible conflict without starving the next signal', async t => {
  const f = fixture(t, { loops: [{ id: 'logs', kind: 'file', file: 'signals.json', intervalSeconds: 10 }] })
  const first = { title: 'Original', body: 'Original body', sourceId: 'same' }
  writeFileSync(path.join(f.root, 'signals.json'), JSON.stringify({ signals: [first] }))
  assert.equal((await tick(f.root, f.store, f.config, { now: 1000 }))[0].ok, true)
  const original = Object.values(f.store.read().issues)[0]
  writeFileSync(path.join(f.root, 'signals.json'), JSON.stringify({ signals: [{ ...first, body: 'Changed body' }, { title: 'New', body: 'New body', sourceId: 'new' }] }))
  assert.equal((await tick(f.root, f.store, f.config, { now: 12000 }))[0].ok, true)
  const db = f.store.read(), loop = db.loops.logs
  assert.deepEqual(db.issues[original.id], original)
  assert.equal(Object.keys(db.issues).length, 2)
  assert.equal(loop.lastRunAt, new Date(12000).toISOString())
  assert.equal(loop.conflicts.length, 1)
  assert.equal(loop.conflicts[0].issueId, original.id)
  assert.equal(JSON.parse(readFileSync(loop.conflicts[0].artifact)).incoming.body, 'Changed body')
  await tick(f.root, f.store, f.config, { now: 23000 })
  assert.equal(f.store.read().reports.length, db.reports.length, 'Repeated conflicts reuse their durable report')
})

test('F1 follow-up: exact exceptions cannot hide newly added paths or compiler -p arguments', async t => {
  const f = fixture(t)
  f.config.checks[0].argv = ['tsc', '-p', 'external-plugins/x/tsconfig.json']
  f.config.checks[0].allowUnpinned = ['tsc']
  const issue = await createIssue(f.store, { title: 'Compiler paths', body: 'B', criteria: [{ id: 'C1', description: 'answer', checks: ['behavior'] }] })
  await assert.rejects(enqueue(f.root, f.store, f.config, issue.id), /unpinned.*external-plugins\/x\/tsconfig.json/)
  f.config.checks[0].allowUnpinned = ['*']
  await assert.rejects(enqueue(f.root, f.store, f.config, issue.id), /unpinned/)
  f.config.checks[0].allowUnpinned = ['tsc', 'external-plugins/x/tsconfig.json']
  const run = await enqueue(f.root, f.store, f.config, issue.id)
  assert.deepEqual(run.trust.coverage.find(c => c.command === 'check:behavior').unpinned, ['tsc', 'external-plugins/x/tsconfig.json'])
})

test('F1 follow-up: option=value module loaders are fixed from base before build', async t => {
  const f = fixture(t)
  mkdirSync(path.join(f.root, 'test')); writeFileSync(path.join(f.root, 'test/hook.mjs'), '// trusted loader\n')
  f.git('add', 'test/hook.mjs'); f.git('commit', '-m', 'pin loader')
  f.config.checks[0].argv.splice(1, 0, '--import=./test/hook.mjs')
  const run = await queued(f)
  assert.ok(run.trust.files.some(f => f.path === 'test/hook.mjs'))
  const adapter = async args => {
    const output = await executeAgent(args)
    if (args.role === 'build') writeFileSync(path.join(args.cwd, 'test/hook.mjs'), 'process.exit(0)\n')
    return output
  }
  const result = await runOne(f.root, f.store, run.id, adapter)
  assert.equal(result.status, 'blocked'); assert.match(result.error, /trusted.*test\/hook.mjs/i)
})

test('F6 follow-up: GitHub batches retain incomplete candidates and queue completed unchanged tasks', async t => {
  const f = fixture(t, { loops: [{ id: 'github', kind: 'github', repository: 'test/repo', trustedActors: ['owner'] }] })
  let changed = false
  const raw = number => ({ title: `Task ${number}`, body: changed && number === 12 ? 'Changed upstream requirement' : `Body ${number}`, source: `https://example.org/issues/${number}`, sourceId: `test/repo#${number}`, evidence: [`https://example.org/issues/${number}`, 'todo-label-event:7; actor:owner'] })
  const ready = await createIssue(f.store, { ...raw(13), criteria: [{ id: 'C1', description: 'answer', checks: ['behavior'] }] })
  const fetcher = async url => new Response(JSON.stringify(url.includes('/events?') ? [{ id: 7, event: 'labeled', label: { name: 'todo' }, actor: { login: 'owner' } }] : [12,13].map(number => ({ number, title: raw(number).title, body: raw(number).body, html_url: raw(number).source }))))
  assert.equal((await tick(f.root, f.store, f.config, { fetcher, force: true }))[0].ok, true)
  assert.equal(Object.keys(f.store.read().runs).length, 1)
  assert.ok(f.store.read().issues[ready.id].runId)
  const pending = f.store.read().loops.github.pending
  assert.equal(pending.length, 1)
  const unfinished = f.store.read().issues[pending[0].issueId]
  await updateIssue(f.store, unfinished.id, { ...raw(12), criteria: [{ id: 'C1', description: 'answer', checks: ['behavior'] }] })
  await tick(f.root, f.store, f.config, { fetcher, force: true })
  assert.equal(Object.keys(f.store.read().runs).length, 2)
  assert.equal(f.store.read().loops.github.pending.length, 0)
  changed = true
  await tick(f.root, f.store, f.config, { fetcher, force: true })
  assert.equal(Object.keys(f.store.read().runs).length, 2, 'Changed upstream text must not authorize a third run')
  assert.equal(f.store.read().loops.github.conflicts[0].issueId, unfinished.id)
  assert.equal(f.store.read().issues[unfinished.id].body, 'Body 12')
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
