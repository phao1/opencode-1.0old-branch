import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

// Adapt the worker's one-shot/v1 protocol to real, independent Codex sessions.
let raw = ''
for await (const chunk of process.stdin) raw += chunk
const request = JSON.parse(raw)
if (request.protocol !== 'one-shot/v1' || !request.schema || !request.prompt) throw new Error('Invalid one-shot request')
const directory = path.join(request.cwd, '.codeagent/agent-calls', randomUUID())
await mkdir(directory, { recursive: true })
const schemaFile = path.join(directory, 'schema.json')
const resultFile = path.join(directory, 'result.json')
await writeFile(schemaFile, JSON.stringify(strict(request.schema)))
await writeFile(path.join(directory, 'request.json'), JSON.stringify(request, null, 2))
const events = createWriteStream(path.join(directory, 'events.jsonl'))
const errors = createWriteStream(path.join(directory, 'stderr.log'))
const args = ['-a', 'never', 'exec', '--ignore-user-config', '--ephemeral', '--sandbox', request.role === 'build' ? 'workspace-write' : 'read-only',
  '-c', 'model_reasoning_effort="high"', '--cd', request.cwd, '--color', 'never', '--json', '--output-schema', schemaFile, '--output-last-message', resultFile, '-']
const child = spawn(process.env.CODEX_BINARY ?? 'codex', args, { cwd: request.cwd, stdio: ['pipe', 'pipe', 'pipe'] })
child.stdout.pipe(events); child.stderr.pipe(errors)
child.stdin.on('error', () => {})
child.stdin.end(request.prompt + '\nReturn null for optional output fields only when absent. Do not fabricate success.\n')
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
await Promise.all([new Promise(resolve => events.end(resolve)), new Promise(resolve => errors.end(resolve))])
if (code !== 0) throw new Error(`Codex exited ${code}; evidence: ${directory}; ${(await readFile(path.join(directory, 'stderr.log'), 'utf8')).slice(-2000)}`)
const result = restore(JSON.parse(await readFile(resultFile, 'utf8')), request.schema)
const lines = (await readFile(path.join(directory, 'events.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => { try { return JSON.parse(line) } catch { return {} } })
const usage = lines.findLast(event => event.type === 'turn.completed')?.usage
console.log(JSON.stringify({ result, ...(usage ? { usage: { tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) } } : {}) }))

// Strict structured outputs require all properties. Optional fields are nullable
// on the wire and restored to omissions for the original Zod stage schema.
function strict(schema) {
  if (!schema || typeof schema !== 'object') return schema
  if (Array.isArray(schema)) return schema.map(strict)
  const result = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$schema').map(([key, value]) => [key, strict(value)]))
  if (schema.type === 'object' && schema.properties) {
    const required = new Set(schema.required ?? [])
    result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, required.has(key) ? strict(value) : { anyOf: [strict(value), { type: 'null' }] }]))
    result.required = Object.keys(result.properties)
    result.additionalProperties = false
  }
  return result
}
function restore(value, schema) {
  if (Array.isArray(value)) return value.map(item => restore(item, schema?.items))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => !(item === null && schema?.properties?.[key] && !schema.required?.includes(key)))
    .map(([key, item]) => [key, restore(item, schema?.properties?.[key])]))
  return value
}
