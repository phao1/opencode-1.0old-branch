import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import http from 'node:http'
import { createCodexCliBridge, invokeCodexCli } from '../../scripts/lib/codex-cli-bridge.mjs'

test('Codex bridge protocol: authorization, text/tools, usage and invalid input (component backend only)', async () => {
  const bridge = await createCodexCliBridge({ backend: async body => ({ decision: body.tools?.length
    ? { kind: 'tool', tool_name: 'example', arguments: '{"value":"ok"}', text: null }
    : { kind: 'text', text: 'component-response', tool_name: null, arguments: null }, usage: { input_tokens: 10, output_tokens: 2 } }) })
  try {
    assert.equal(new URL(bridge.baseURL).hostname, '127.0.0.1')
    assert.equal((await fetch(bridge.baseURL + '/models')).status, 401)
    const headers = { authorization: 'Bearer ' + bridge.apiKey, 'content-type': 'application/json' }
    assert.equal((await fetch(bridge.baseURL + '/models', { headers })).status, 200)
    const plain = await fetch(bridge.baseURL + '/chat/completions', { method: 'POST', headers, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], stream: false }) })
    const json = await plain.json(); assert.equal(json.choices[0].message.content, 'component-response'); assert.equal(json.usage.total_tokens, 12)
    const tool = await fetch(bridge.baseURL + '/chat/completions', { method: 'POST', headers, body: JSON.stringify({ messages: [{ role: 'user', content: 'do it' }], tools: [{ type: 'function', function: { name: 'example' } }] }) })
    const events = await tool.text(); assert.match(events, /"tool_calls"/); assert.match(events, /"finish_reason":"tool_calls"/); assert.match(events, /\[DONE\]/)
    assert.equal((await fetch(bridge.baseURL + '/chat/completions', { method: 'POST', headers, body: '{' })).status, 400)
    assert.equal((await fetch(bridge.baseURL + '/chat/completions', { method: 'POST', headers, body: JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'unused' } }] }] }) })).status, 400)
    assert.equal(bridge.stats.completed, 2)
  } finally { await bridge.close() }
})

test('Codex bridge aborts backend work when the OpenCode HTTP request is cancelled (component backend only)', async () => {
  let started = false, cancelled = false
  const bridge = await createCodexCliBridge({ backend: (_body, { signal }) => new Promise((_resolve, reject) => {
    started = true; signal.addEventListener('abort', () => { cancelled = true; reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })) }, { once: true })
  }) })
  try {
    const abort = new AbortController()
    const response = fetch(bridge.baseURL + '/chat/completions', { method: 'POST', signal: abort.signal,
      headers: { authorization: 'Bearer ' + bridge.apiKey, 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'wait' }] }) }).catch(() => undefined)
    for (let i = 0; i < 100 && !started; i++) await delay(10)
    assert.ok(started); abort.abort(); await response
    for (let i = 0; i < 100 && !cancelled; i++) await delay(10)
    assert.ok(cancelled)
    for (let i = 0; i < 100 && bridge.stats.active; i++) await delay(10)
    assert.equal(bridge.stats.cancelled, 1); assert.equal(bridge.stats.active, 0)
  } finally { await bridge.close() }
})

test('CLI timeout kills a non-responsive process and removes temporary request files', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'codex-bridge-test-'))
  try {
    const fake = path.join(dir, 'stall-cli')
    await writeFile(fake, '#!/bin/sh\ntrap "" TERM\ncat >/dev/null\nsleep 60\n', { mode: 0o755 })
    await assert.rejects(invokeCodexCli({ messages: [{ role: 'user', content: 'fixture' }] }, { codexBinary: fake, timeoutMs: 40, temporaryRoot: dir }), /超时/)
    assert.deepEqual((await readdir(dir)).sort(), ['stall-cli'])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('Codex bridge preserves Chinese text split across UTF-8 network chunks (component backend only)', async () => {
  const text = '请用中文解释插话功能。'
  const bridge = await createCodexCliBridge({ backend: async body => {
    assert.equal(body.messages[0].content, text)
    return { decision: { kind: 'text', text: '中文正确', tool_name: null, arguments: null }, usage: {} }
  } })
  try {
    const received = await new Promise((resolve, reject) => {
      const req = http.request(bridge.baseURL + '/chat/completions', { method: 'POST', headers: { authorization: 'Bearer ' + bridge.apiKey, 'content-type': 'application/json' } }, res => {
        let data = ''; res.setEncoding('utf8'); res.on('data', chunk => data += chunk); res.on('end', () => resolve(JSON.parse(data)))
      })
      req.on('error', reject)
      const body = Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: text }], stream: false }))
      for (let i = 0; i < body.length; i++) req.write(body.subarray(i, i + 1))
      req.end()
    })
    assert.equal(received.choices[0].message.content, '中文正确')
  } finally { await bridge.close() }
})
