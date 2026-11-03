import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCodexCliBridge } from './lib/codex-cli-bridge.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const candidates = [process.env.CODEAGENT_BUNDLE, path.resolve(here, '..'), path.resolve(here, '../codeagent-opencode-darwin-arm64'), path.resolve(here, '../dist/codeagent-opencode-darwin-arm64')].filter(Boolean)
const bundle = candidates.find(dir => existsSync(path.join(dir, 'opencode')))
const argv = process.argv.slice(2)
if (!bundle) throw new Error('没有找到 Mac 运行包，请保留本入口与 codeagent-opencode-darwin-arm64 文件夹的相对位置。')
if (!process.stdin.isTTY || !process.stdout.isTTY) { console.error('请在终端前台执行，或在 Finder 双击“使用Codex模型启动.command”。'); process.exit(2) }
if (argv[0] === '--project' && !argv[1]) { console.error('--project 后需要项目目录。'); process.exit(2) }
const project = path.resolve(argv[0] === '--project' ? argv[1] : argv[0] ?? path.join(bundle, 'workspace'))
if (!existsSync(project) || !statSync(project).isDirectory()) { console.error('项目目录不存在：' + project); process.exit(2) }
const appCli = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
const codexBinary = process.env.CODEX_BINARY ?? (existsSync(appCli) ? appCli : 'codex')
const login = spawnSync(codexBinary, ['login', 'status'], { encoding: 'utf8' })
if (login.error || login.status !== 0) { console.error('Codex CLI 尚未登录或无法启动，请先在 Codex 完成登录。'); process.exit(2) }
const diagnostics = process.env.CODEAGENT_BRIDGE_DIAGNOSTICS ?? path.join(here, '.runtime/last-run.json')
mkdirSync(path.dirname(diagnostics), { recursive: true, mode: 0o700 })
const record = { startedAt: new Date().toISOString(), model: process.env.CODEX_MODEL ?? 'CLI default', project, cliExecutable: codexBinary, accountSource: 'Existing Codex CLI login', promptsRecorded: false }
const save = () => { try { writeFileSync(diagnostics, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 }) } catch {} }
const bridge = await createCodexCliBridge({ codexBinary, model: process.env.CODEX_MODEL, onStats: stats => { record.stats = stats; save() } })
record.endpoint = bridge.baseURL; save()
const config = { model: `local-codex/${bridge.modelID}`, small_model: `local-codex/${bridge.modelID}`,
  provider: { 'local-codex': { npm: '@ai-sdk/openai-compatible', name: '本机 Codex CLI', options: { baseURL: bridge.baseURL, apiKey: bridge.apiKey },
    models: { [bridge.modelID]: { name: 'Codex CLI（已登录账号）', tool_call: true, limit: { context: 128000, output: 8192 } } } } },
  agent: { title: { disable: true }, summary: { disable: true } },
}
const env = { ...process.env, CODEX_BINARY: codexBinary, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
  OPENCODE_CONFIG_CONTENT: JSON.stringify(config) }
console.log('已启用本机 Codex CLI 模型。对话和工具由 OpenCode 管理，退出 TUI 后连接会关闭。')
const child = spawn(path.join(bundle, 'opencode'), [project], { cwd: project, env, stdio: 'inherit' })
let stopPromise
const stop = () => stopPromise ??= (async () => {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  await bridge.close()
})()
for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(name, () => { void stop() })
let exit
try { exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })) }) }
finally { await stop(); record.endedAt = new Date().toISOString(); record.exit = exit; record.stats = structuredClone(bridge.stats); save() }
process.exitCode = exit?.code ?? 1
