import assert from 'node:assert/strict'
import { startKernel } from './lib/kernel-lab.mjs'
const lab = await startKernel()
try {
  const tools = await lab.request('/experimental/tool/ids')
  for (const name of ['one_shot_issue','one_shot_start','one_shot_status','one_shot_cancel','steering_status']) assert.ok(tools.includes(name), `Missing ${name}`)
  const data = await lab.request('/session', { title: 'one-shot integration smoke', permission: [{ permission: '*', pattern: '*', action: 'deny' }] })
  assert.ok(data.id)
  // noReply verifies real hook loading and persistence without model credentials.
  // Busy-session model consumption still needs the manual/provider test.
  for (const text of ['ordinary idle input', 'steer: Keep context. !`echo literal` @not-a-file']) {
    const saved = await lab.request('/session/' + data.id + '/message', { noReply: true, model: { providerID: 'smoke', modelID: 'not-invoked' }, parts: [{ type: 'text', text }] })
    assert.equal(saved.info.sessionID, data.id)
    const value = saved.parts.find(part => part.type === 'text')?.text
    assert.equal(value, text, 'Steering must preserve the exact literal input')
    const persisted = await lab.request('/session/' + data.id + '/message/' + saved.info.id)
    assert.equal(persisted.parts.find(part => part.type === 'text')?.text, value)
  }
  await lab.request('/session/' + data.id, undefined, 'DELETE')
  console.log(JSON.stringify({ kernel: '1.3.17', tools: tools.filter(x => x.startsWith('one_shot_')), steering: 'v0.2 literal persistence + status tool loaded; no model invoked', realModel: false, fixture: lab.fixture }, null, 2))
} finally { await lab.stop() }
