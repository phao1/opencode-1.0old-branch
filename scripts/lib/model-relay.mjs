import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const schema = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['tool', 'text'] },
    text: { type: ['string', 'null'] },
    tool_name: { type: ['string', 'null'] },
    arguments: { type: ['string', 'null'] },
  }, required: ['kind', 'text', 'tool_name', 'arguments'],
}

// The model sees no harness assertions, expected values, package source, or test
// scenario state. The only task content supplied is the actual provider payload.
export async function callRealModel(body, evidence, { timeout = 90000 } = {}) {
  await mkdir(evidence, { recursive: true })
  await writeFile(path.join(evidence, 'request.json'), JSON.stringify(body, null, 2))
  const schemaFile = path.join(evidence, 'schema.json')
  const resultFile = path.join(evidence, 'result.json')
  await writeFile(schemaFile, JSON.stringify(schema, null, 2))
  const prompt = [
    'Act as the language-model provider for the supplied conversation. Choose the next assistant response based solely on its messages and available tools.',
    'Do not execute tools yourself, inspect local files, browse, or discuss this relay. Return exactly one response in the required JSON schema.',
    'For a tool call: kind="tool", tool_name is an available tool, arguments is valid JSON matching its parameters, text=null.',
    'For a final response: kind="text", text contains your answer, tool_name=null and arguments=null.',
    'Respect the supplied tool_choice protocol: required means select an available tool; none means return text; a named function requires that function.',
    'The following JSON is the actual conversation and tool definitions received from the requesting application:',
    JSON.stringify({ messages: body.messages, tools: body.tools ?? [], ...(body.tool_choice !== undefined ? { tool_choice: body.tool_choice } : {}) }),
  ].join('\n')
  await writeFile(path.join(evidence, 'prompt.txt'), prompt)
  const configured = process.env.STEERING_PROVIDER_COMMAND
  let command, args, input
  if (configured) {
    const argv = JSON.parse(configured)
    if (!Array.isArray(argv) || !argv.length || argv.some(value => typeof value !== 'string')) throw new Error('STEERING_PROVIDER_COMMAND must be a nonempty JSON string array')
    ;[command, ...args] = argv
    input = JSON.stringify({ messages: body.messages, tools: body.tools ?? [], ...(body.tool_choice !== undefined ? { tool_choice: body.tool_choice } : {}) })
  } else {
    command = process.env.CODEX_BINARY ?? 'codex'
    args = ['-a', 'never', 'exec', '--ignore-user-config', '--ephemeral', '--sandbox', 'read-only',
      '-c', 'model_reasoning_effort="low"', '--cd', tmpdir(), '--skip-git-repo-check', '--color', 'never', '--json',
      '--output-schema', schemaFile, '--output-last-message', resultFile, '-']
    input = prompt
  }
  const started = Date.now()
  const proc = spawn(command, args, { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = '', stderr = '', timedOut = false
  const timer = setTimeout(() => { timedOut = true; proc.kill('SIGKILL') }, timeout)
  proc.stdout.on('data', data => stdout += data)
  proc.stderr.on('data', data => stderr += data)
  proc.stdin.on('error', () => {})
  proc.stdin.end(input)
  let completion
  try {
    completion = await new Promise((resolve, reject) => { proc.once('error', reject); proc.once('close', (code, signal) => resolve({ code, signal })) })
  } finally {
    clearTimeout(timer)
    await writeFile(path.join(evidence, 'events.jsonl'), stdout)
    await writeFile(path.join(evidence, 'stderr.log'), stderr)
    await writeFile(path.join(evidence, 'status.json'), JSON.stringify({ ...completion, timedOut, elapsedMs: Date.now() - started, command, args }, null, 2))
  }
  if (completion.code !== 0 || timedOut) throw new Error(`Real model failed (${timedOut ? 'timeout' : completion.code}); evidence: ${evidence}`)
  const result = JSON.parse(configured ? stdout : await readFile(resultFile, 'utf8'))
  if (configured) await writeFile(resultFile, JSON.stringify(result, null, 2))
  if (body.tool_choice === 'required' && result.kind !== 'tool') throw new Error('Model did not honor the actual required tool_choice protocol')
  if (body.tool_choice === 'none' && result.kind !== 'text') throw new Error('Model chose a tool despite the actual none tool_choice protocol')
  if (result.kind === 'tool') {
    const tool = (body.tools ?? []).find(tool => tool.function?.name === result.tool_name)
    if (!tool) throw new Error(`Model chose an unavailable tool: ${result.tool_name}`)
    if (typeof result.arguments !== 'string') throw new Error('Tool arguments must be a JSON string')
    JSON.parse(result.arguments)
  } else if (result.kind !== 'text' || typeof result.text !== 'string') throw new Error('Invalid model response')
  const events = stdout.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
  if (events.some(event => event.item?.type === 'command_execution' || event.item?.type === 'mcp_tool_call' || event.item?.type === 'web_search')) throw new Error('Provider relay attempted external tool execution; do not treat this run as isolated evidence')
  return result
}

export function sendModelResponse(response, decision, requestNumber) {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const chunk = delta => ({ id: `steering-real-${requestNumber}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'codex-relay', choices: [{ index: 0, delta, finish_reason: null }] })
  const delta = decision.kind === 'tool' ? { role: 'assistant', tool_calls: [{ index: 0, id: `call_real_${requestNumber}`, type: 'function', function: { name: decision.tool_name, arguments: decision.arguments } }] } : { role: 'assistant', content: decision.text }
  response.write(`data: ${JSON.stringify(chunk(delta))}\n\n`)
  const final = chunk({}); final.choices[0].finish_reason = decision.kind === 'tool' ? 'tool_calls' : 'stop'
  response.end(`data: ${JSON.stringify(final)}\n\ndata: [DONE]\n\n`)
}
