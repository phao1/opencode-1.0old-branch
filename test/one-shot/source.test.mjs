import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { collectSource } from '../../agent-kernel-extension/src/codeagent/one-shot/source.ts'
import { tick } from '../../agent-kernel-extension/src/codeagent/one-shot/loops.ts'
import { configSchema } from '../../agent-kernel-extension/src/codeagent/one-shot/types.ts'
import { Store } from '../../agent-kernel-extension/src/codeagent/one-shot/store.ts'

test('real Git source evidence captures exact commits/content; bounds omissions and repeats no work', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'one-shot-source-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const upstream = path.join(root, 'upstream'); mkdirSync(upstream)
  const git = (...args) => execFileSync('git', args, { cwd: upstream, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-b', 'main'); git('config', 'user.email', 'test@localhost'); git('config', 'user.name', 'Test')
  writeFileSync(path.join(upstream, 'feature.ts'), 'export const value = 1\n')
  writeFileSync(path.join(upstream, 'removed.ts'), 'old\n')
  git('add', '.'); git('commit', '-m', 'baseline'); const base = git('rev-parse', 'HEAD')
  writeFileSync(path.join(upstream, 'feature.ts'), 'export const value = 2\n')
  writeFileSync(path.join(upstream, 'large.ts'), 'x'.repeat(1500))
  rmSync(path.join(upstream, 'removed.ts')); git('add', '.'); git('commit', '-m', 'new feature'); const head = git('rev-parse', 'HEAD')
  const options = { repository: 'openai/codex', ref: 'main', cacheDirectory: path.join(root, 'cache'), timeoutMs: 10000, maxSourceFiles: 30, maxSourceFileBytes: 1024, maxSourceBytes: 2000 }
  const fetcher = async cache => { execFileSync('git', ['-C', cache, 'fetch', '--no-tags', upstream, 'main'], { stdio: 'ignore' }) }
  const evidence = await collectSource(options, fetcher)
  assert.equal(evidence.base, base); assert.equal(evidence.head, head)
  assert.equal(evidence.files.find(f => f.path === 'feature.ts').content, 'export const value = 2\n')
  assert.match(evidence.files.find(f => f.path === 'large.ts').omission, /budget/)
  assert.equal(evidence.files.find(f => f.path === 'removed.ts').status, 'D')
  assert.match(evidence.files.find(f => f.path === 'feature.ts').url, new RegExp(head))
  assert.equal(evidence.historyRewritten, false)
  assert.equal(await collectSource({ ...options, previous: head }, fetcher), undefined)
  const limited = await collectSource({ ...options, maxSourceFiles: 1 }, fetcher)
  assert.equal(limited.omittedFiles, 2); assert.match(limited.limitations.join(' '), /not claim exhaustive/)
  await assert.rejects(collectSource({ ...options, previous: 'a'.repeat(40) }, fetcher), /failed/)
  // A rewritten branch remains an explicitly marked tree comparison.
  git('checkout', '--orphan', 'rewritten'); git('add', '.'); git('commit', '-m', 'rewritten history'); git('branch', '-M', 'main')
  const rewritten = await collectSource({ ...options, previous: head }, fetcher)
  assert.equal(rewritten.historyRewritten, true)
})

test('source loop preserves cursor after analysis failure, persists usable evidence and only creates candidates', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'one-shot-source-loop-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const config = configSchema.parse({ version: 1, agents: { planner: { kind: 'command', argv: ['noop'] }, builder: { kind: 'command', argv: ['noop'] }, evaluator: { kind: 'command', argv: ['noop'] } }, roles: { planner: 'planner', builder: 'builder', evaluator: 'evaluator', designReviewers: ['planner'] }, checks: [{ id: 'tests', argv: ['noop'] }], loops: [{ id: 'pi', kind: 'source', repository: 'earendil-works/pi', ref: 'main' }] })
  const store = new Store(path.join(root, '.codeagent/one-shot'))
  const key = 'earendil-works/pi@main', head = 'b'.repeat(40)
  const source = { repo: 'earendil-works/pi', head, url: `https://github.com/earendil-works/pi/commit/${head}`, files: [{ path: 'src/tool.ts', content: 'actual source' }], limitations: ['bounded evidence'] }
  let fail = true, seen
  const executor = async args => { seen = args.payload.source; if (fail) throw new Error('model outage'); return { result: { summary: 'implementation analyzed', candidates: [{ title: 'Plugin tool', body: 'Adapt src/tool.ts via public API', sourceId: 'tool-feature' }] } } }
  const sourceCollector = async options => options.previous === head ? undefined : source
  assert.equal((await tick(root, store, config, { force: true, sourceCollector, executor }))[0].ok, false)
  assert.equal(store.read().loops.pi.cursor, undefined)
  assert.deepEqual(seen, source)
  fail = false
  assert.equal((await tick(root, store, config, { force: true, sourceCollector, executor }))[0].ok, true)
  assert.equal(store.read().loops.pi.cursor[key], head)
  const issue = Object.values(store.read().issues)[0]
  assert.equal(issue.status, 'candidate'); assert.equal(Object.keys(store.read().runs).length, 0)
  assert.deepEqual(JSON.parse(readFileSync(issue.evidence.at(-1), 'utf8')).source, source)
  await tick(root, store, config, { force: true, sourceCollector, executor })
  assert.equal(Object.keys(store.read().issues).length, 1)
  assert.equal(configSchema.safeParse({ ...config, loops: [{ id: 'bad', kind: 'source', repository: 'openai/codex', ref: '--upload-pack=evil' }] }).success, false)
})
