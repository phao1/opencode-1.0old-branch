// Deterministic protocol fixture. This is not a model and is never a production default.
import { mkdirSync, writeFileSync } from 'node:fs'
let input = ''
for await (const chunk of process.stdin) input += chunk
const { role, payload } = JSON.parse(input)
let result
const criteria = payload.issue?.criteria?.length ? payload.issue.criteria : [{ id: 'C1', description: 'exports answer 42' }]
if (role === 'plan' || role === 'revise') result = { summary: 'Implement answer plugin', design: 'Use an external module. Verify export through an actual Node import. Preserve the kernel.', criteria, manualTests: ['Import the module and inspect answer=42.'], skillProposal: 'After repeated success, extract the external-module smoke-check procedure.' }
else if (role === 'build') {
  mkdirSync('external-plugins/src', { recursive: true })
  writeFileSync('external-plugins/src/answer.js', 'export const answer = 42\n')
  result = { summary: 'Added answer module', evidence: ['external-plugins/src/answer.js'] }
} else if (role === 'evaluate') result = { summary: 'Checked actual Node command evidence', results: payload.plan.criteria.map(c => ({ criterionId: c.id, passed: payload.checks.every(x => !x.required || x.code === 0), evidence: ['check:behavior', 'Node imported the module and asserted its public export.'] })) }
else if (role === 'analyze') result = { summary: 'Candidate from observed release', candidates: [{ title: 'Review release capability', body: 'Inspect whether this release capability is useful for external plugins.', sourceId: 'capability-1', evidence: [payload.source.url] }] }
else result = { summary: 'No blocking findings', findings: [] }
process.stdout.write(JSON.stringify({ result }))
