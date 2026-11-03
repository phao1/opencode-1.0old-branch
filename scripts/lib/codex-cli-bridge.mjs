import { spawn } from 'node:child_process'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

const responseSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['tool', 'text'] },
    text: { type: ['string', 'null'] },
    tool_name: { type: ['string', 'null'] },
    arguments: { type: ['string', 'null'] },
  }, required: ['kind', 'text', 'tool_name', 'arguments'],
}
const aborted = () => Object.assign(new Error('Codex request cancelled'), { name: 'AbortError' })

export async function invokeCodexCli(body, { codexBinary, model, signal, timeoutMs = 120000, temporaryRoot = tmpdir(), onEvidence = async () => {} }) {
  if (signal?.aborted) throw aborted()
  const directory = await mkdtemp(path.join(temporaryRoot, 'opencode-codex-request-'))
  const schemaFile = path.join(directory, 'schema.json'), resultFile = path.join(directory, 'result.json')
  let proc, timer, hardStop, stopped = false, timedOut = false
  const stop = () => {
    if (stopped) return
    stopped = true
    if (!proc?.pid || proc.exitCode !== null || proc.signalCode !== null) return
    const kill = signalName => { try { process.kill(process.platform === 'win32' ? proc.pid : -proc.pid, signalName) } catch {} }
    kill('SIGTERM')
    hardStop = setTimeout(() => kill('SIGKILL'), 1500)
    hardStop.unref()
  }
  try {
    await writeFile(schemaFile, JSON.stringify(responseSchema), { mode: 0o600 })
    const prompt = [
      'Act only as the language-model provider for the supplied OpenCode conversation.',
      'Use solely its messages and available tool definitions to choose the next assistant response.',
      'Do not execute any tools yourself, inspect files, browse, or discuss the relay. OpenCode executes the chosen tool.',
      'Return one JSON object matching the required schema.',
      'For a tool call use kind="tool", an available tool_name, JSON arguments string and text=null.',
      'For a final answer use kind="text", the answer in text, tool_name=null and arguments=null.',
      'Respect tool_choice: none means text; required means a tool; a named function requires that exact function.',
      JSON.stringify({ messages: body.messages, tools: body.tools ?? [], ...(body.tool_choice !== undefined ? { tool_choice: body.tool_choice } : {}) }),
    ].join('\n')
    const argv = ['-a', 'never', 'exec', '--ignore-user-config', '--ephemeral', '--sandbox', 'read-only',
      '-c', 'model_reasoning_effort="low"', '--cd', directory, '--skip-git-repo-check', '--color', 'never', '--json',
      '--output-schema', schemaFile, '--output-last-message', resultFile, ...(model ? ['--model', model] : []), '-']
    proc = spawn(codexBinary, argv, { cwd: directory, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
    proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8')
    let stdout = '', stderr = '', oversized = false
    proc.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 16 * 1024 * 1024) { oversized = true; stop() } })
    proc.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16384) })
    proc.stdin.on('error', () => {})
    signal?.addEventListener('abort', stop, { once: true })
    if (signal?.aborted) stop()
    timer = setTimeout(() => { timedOut = true; stop() }, timeoutMs)
    proc.stdin.end(prompt)
    const exit = await new Promise((resolve, reject) => {
      proc.once('error', reject)
      proc.once('close', (code, signal) => resolve({ code, signal }))
    })
    if (signal?.aborted || (stopped && !timedOut && !oversized)) throw aborted()
    if (timedOut) throw new Error('Codex CLI 模型请求超时，请重试或检查账号用量。')
    if (oversized) throw new Error('Codex CLI 响应超出本地桥接上限。')
    if (exit.code !== 0) throw new Error(`Codex CLI 退出码 ${exit.code}；请检查登录、所选模型和账号用量。`)
    const events = stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
    if (events.some(event => ['command_execution', 'mcp_tool_call', 'web_search'].includes(event.item?.type))) {
      throw new Error('Codex CLI 尝试独立执行工具，响应已拒绝；工具应由 OpenCode 执行。')
    }
    const decision = JSON.parse(await readFile(resultFile, 'utf8'))
    if (decision.kind === 'tool') {
      assertToolDecision(body, decision)
    } else if (decision.kind !== 'text' || typeof decision.text !== 'string') throw new Error('Codex CLI 返回格式无效。')
    if (body.tool_choice === 'none' && decision.kind !== 'text') throw new Error('Codex CLI 未遵守 tool_choice=none。')
    if (body.tool_choice === 'required' && decision.kind !== 'tool') throw new Error('Codex CLI 未选择必需工具。')
    const required = body.tool_choice?.function?.name
    if (required && (decision.kind !== 'tool' || decision.tool_name !== required)) throw new Error('Codex CLI 未选择指定工具。')
    const usage = {}
    for (const event of events) for (const [key, value] of Object.entries(event.usage ?? {})) {
      if (typeof value === 'number') usage[key] = (usage[key] ?? 0) + value
    }
    await onEvidence({ jsonl: stdout, decision, usage })
    return { decision, usage }
  } finally {
    clearTimeout(timer); clearTimeout(hardStop)
    signal?.removeEventListener('abort', stop)
    if (proc?.pid && proc.exitCode === null && proc.signalCode === null) {
      try { process.kill(process.platform === 'win32' ? proc.pid : -proc.pid, 'SIGKILL') } catch {}
      await new Promise(resolve => proc.once('close', resolve))
    }
    // Requests and results live only in a private temporary directory.
    await rm(directory, { recursive: true, force: true })
  }
}

function assertToolDecision(body, decision) {
  if (!(body.tools ?? []).some(tool => tool.function?.name === decision.tool_name)) throw new Error('Codex CLI 选择了不可用工具。')
  if (typeof decision.arguments !== 'string') throw new Error('Codex CLI 工具参数格式无效。')
  JSON.parse(decision.arguments)
}

function wire(res, { decision, usage = {} }, model) {
  const id = `codex-cli-${randomUUID()}`, created = Math.floor(Date.now() / 1000)
  const message = decision.kind === 'tool'
    ? { role: 'assistant', content: null, tool_calls: [{ id: `call_${randomUUID()}`, type: 'function', function: { name: decision.tool_name, arguments: decision.arguments } }] }
    : { role: 'assistant', content: decision.text }
  const tokens = { prompt_tokens: usage.input_tokens ?? 0, completion_tokens: usage.output_tokens ?? 0,
    total_tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
    prompt_tokens_details: { cached_tokens: usage.cached_input_tokens ?? 0 },
    completion_tokens_details: { reasoning_tokens: usage.reasoning_output_tokens ?? 0 } }
  const finish_reason = decision.kind === 'tool' ? 'tool_calls' : 'stop'
  return { id, created, model, message, finish_reason, tokens }
}

export async function createCodexCliBridge({ codexBinary, model, timeoutMs, backend = invokeCodexCli, onStats = () => {} }) {
  const apiKey = randomBytes(32).toString('hex'), modelID = 'codex-cli-default'
  const active = new Set(), stats = { requests: 0, completed: 0, failed: 0, cancelled: 0, active: 0, usage: {} }
  let closing = false
  const update = () => { stats.active = active.size; onStats(structuredClone(stats)) }
  const json = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)) }
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') return json(res, 200, { healthy: !closing, model: modelID })
    const supplied = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from('Bearer ' + apiKey)
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return json(res, 401, { error: { message: 'Unauthorized local bridge request' } })
    if (req.method === 'GET' && req.url === '/v1/models') return json(res, 200, { object: 'list', data: [{ id: modelID, object: 'model', owned_by: 'local-codex-cli' }] })
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return json(res, 404, { error: { message: 'Not found' } })
    if (closing) return json(res, 503, { error: { message: 'Bridge is closing' } })
    if (active.size >= 2) { res.setHeader('retry-after', '1'); return json(res, 429, { error: { message: 'Local Codex bridge is busy' } }) }
    const controller = new AbortController()
    res.once('close', () => { if (!res.writableEnded) controller.abort() })
    active.add(controller); stats.requests++; update()
    try {
      let raw = ''
      req.setEncoding('utf8')
      for await (const part of req) { raw += part; if (Buffer.byteLength(raw) > 8 * 1024 * 1024) throw Object.assign(new Error('Request too large'), { status: 413 }) }
      let body
      try { body = JSON.parse(raw) } catch { throw Object.assign(new Error('Invalid JSON request'), { status: 400 }) }
      if (!Array.isArray(body.messages) || body.messages.length === 0) throw Object.assign(new Error('messages must be a nonempty array'), { status: 400 })
      if (body.messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type !== 'text'))) {
        throw Object.assign(new Error('此 Codex CLI 桥接目前仅支持文字和文本工具结果。'), { status: 400 })
      }
      const result = await backend(body, { codexBinary, model, signal: controller.signal, timeoutMs })
      if (controller.signal.aborted) throw aborted()
      const response = wire(res, result, modelID)
      if (body.stream === false) json(res, 200, { id: response.id, object: 'chat.completion', created: response.created, model: modelID,
        choices: [{ index: 0, message: response.message, finish_reason: response.finish_reason }], usage: response.tokens })
      else {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        const delta = result.decision.kind === 'tool'
          ? { role: 'assistant', tool_calls: [{ index: 0, ...response.message.tool_calls[0] }] }
          : { role: 'assistant', content: result.decision.text }
        const chunk = (delta, finish_reason, usage) => ({ id: response.id, object: 'chat.completion.chunk', created: response.created, model: modelID,
          choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })
        res.write('data: ' + JSON.stringify(chunk(delta, null)) + '\n\n')
        res.write('data: ' + JSON.stringify(chunk({}, response.finish_reason, response.tokens)) + '\n\n')
        res.end('data: [DONE]\n\n')
      }
      stats.completed++
      for (const [key, value] of Object.entries(result.usage ?? {})) stats.usage[key] = (stats.usage[key] ?? 0) + value
    } catch (error) {
      if (controller.signal.aborted || error.name === 'AbortError') stats.cancelled++
      else { stats.failed++; if (!res.destroyed && !res.headersSent) json(res, error.status ?? 502, { error: { message: error.message } }) }
    } finally { active.delete(controller); update() }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey, modelID, stats,
    async close() {
      closing = true
      for (const controller of active) controller.abort()
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
      while (active.size) await new Promise(resolve => setTimeout(resolve, 20))
    },
  }
}
