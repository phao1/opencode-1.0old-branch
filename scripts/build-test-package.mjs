import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, cpSync, existsSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const kernelCommit = '517e6c9aa4c61dbc125e7654fc596f1d529f20d9'
const bun = process.env.BUN_BINARY ?? 'bun'
const bunVersion = execFileSync(bun, ['--version'], { encoding: 'utf8' }).trim()
const [bunMajor, bunMinor, bunPatch] = bunVersion.split('.').map(Number)
if (bunMajor !== 1 || bunMinor < 4 || (bunMinor === 4 && bunPatch < 2)) throw new Error('Use Bun 1.4.2+ (1.x) to read the committed v2 lockfiles')
const run = (cmd, args, cwd, env = process.env) => {
  const result = spawnSync(cmd, args, { cwd, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${result.status}`)
}
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const sha = git('rev-parse', 'HEAD')
// Config.installDependencies resolves @opencode-ai/plugin at the binary version.
// Keep the published baseline version; identify custom builds by wrapper SHA in BUILD.json.
const version = '1.3.17'
const platform = process.platform === 'win32' ? 'windows' : process.platform
const name = `codeagent-opencode-${platform}-${process.arch}`
const output = path.join(root, 'dist', name)
const temporary = mkdtempSync(path.join(os.tmpdir(), 'codeagent-build-'))
try {
  // Native build.ts writes models-snapshot and dependencies; confine these to a disposable clone.
  const kernel = path.join(temporary, 'agent-kernel')
  run('git', ['clone', '--local', '--no-hardlinks', '--no-checkout', path.join(root, 'agent-kernel'), kernel], root)
  run('git', ['checkout', '--detach', kernelCommit], kernel)
  const env = { ...process.env, OPENCODE_VERSION: version, OPENCODE_CHANNEL: 'codeagent-test', OPENCODE_RELEASE: '' }
  // CLI uses the published parser WASM/native packages, not grammar node-gyp bindings
  // or Electron. Skip lifecycle builds for this CLI-only package.
  run(bun, ['install', '--frozen-lockfile', '--ignore-scripts'], kernel, env)
  for (const grammar of ['bash', 'powershell']) {
    const resolved = execFileSync(bun, ['-e', `console.log(require.resolve("tree-sitter-${grammar}/tree-sitter-${grammar}.wasm"))`], { cwd: path.join(kernel, 'packages/opencode'), encoding: 'utf8' }).trim()
    if (!existsSync(resolved)) throw new Error(`Missing prebuilt ${grammar} grammar WASM`)
  }
  run(bun, ['run', 'script/build.ts', '--single', '--skip-install', '--skip-embed-web-ui'], path.join(kernel, 'packages/opencode'), env)
  const binaryDir = path.join(kernel, 'packages/opencode/dist', `opencode-${platform}-${process.arch}`, 'bin')
  const binary = readdirSync(binaryDir).find(file => file === 'opencode.exe' || file === 'opencode')
  if (!binary) throw new Error('Kernel build did not produce opencode binary')
  rmSync(output, { recursive: true, force: true }); mkdirSync(output, { recursive: true })
  cpSync(path.join(binaryDir, binary), path.join(output, binary))
  mkdirSync(path.join(output, '.opencode/plugins'), { recursive: true })
  // Bundle runtime dependencies as well, so the portable plugin needs no package installation.
  run(bun, ['build', 'external-plugins/src/index.ts', '--target=bun', '--outfile', path.join(output, '.opencode/plugins/codeagent.js')], root)
  run(bun, ['build', 'scripts/one-shot.ts', '--target=node', '--outfile', path.join(output, 'one-shot.mjs')], root)
  for (const directory of ['command', 'skills']) cpSync(path.join(root, '.opencode', directory), path.join(output, '.opencode', directory), { recursive: true })
  writeFileSync(path.join(output, '.opencode/opencode.json'), JSON.stringify({ plugin: ['./plugins/codeagent.js'] }, null, 2))
  for (const file of ['one-shot.config.example.json', 'docs/test-package.md']) cpSync(path.join(root, file), path.join(output, path.basename(file)))
  for (const file of ['start-opencode.ps1', 'start-worker.ps1']) cpSync(path.join(root, 'scripts', file), path.join(output, file))
  cpSync(path.join(kernel, 'LICENSE'), path.join(output, 'OPENCODE-LICENSE'))
  const notices = ['This test package includes the pinned OpenCode binary and its upstream dependencies. See OPENCODE-LICENSE and the pinned upstream repository for dependency licensing.']
  for (const dependency of ['zod', '@opencode-ai/plugin']) {
    const directory = path.join(root, 'node_modules', dependency)
    const pkg = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
    notices.push(`${dependency}@${pkg.version}: ${pkg.license ?? 'See upstream package'}`)
    for (const file of readdirSync(directory).filter(file => /^licen[sc]e/i.test(file))) {
      if (existsSync(path.join(directory, file))) cpSync(path.join(directory, file), path.join(output, `${dependency.replaceAll('/', '-')}-${file}`))
    }
  }
  writeFileSync(path.join(output, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n') + '\n')
  cpSync(path.join(kernel, 'bun.lock'), path.join(output, 'KERNEL-BUILD.bun.lock'))
  writeFileSync(path.join(output, 'BUILD.json'), JSON.stringify({ version, wrapperCommit: sha, kernelCommit, platform, arch: process.arch, bunVersion, kernelBuildLockSHA256: createHash('sha256').update(readFileSync(path.join(kernel, 'bun.lock'))).digest('hex'), dependencyResolution: 'Frozen upstream lock, no lifecycle scripts; see KERNEL-BUILD.bun.lock', builtAt: new Date().toISOString(), dirty: Boolean(git('status', '--porcelain', '--untracked-files=no', '--ignore-submodules=all')), embeddedWebUI: false, releasePublished: false }, null, 2))
  const files = []
  const walk = dir => { for (const item of readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, item.name); if (item.isDirectory()) walk(file); else files.push(file) } }
  walk(output)
  writeFileSync(path.join(output, 'SHA256SUMS'), files.sort().map(file => `${createHash('sha256').update(readFileSync(file)).digest('hex')}  ${path.relative(output, file).replaceAll('\\', '/')}`).join('\n') + '\n')
  run(process.execPath, [path.join(output, 'one-shot.mjs'), '--help'], root)
  console.log(`Portable test package: ${output}`)
} finally { rmSync(temporary, { recursive: true, force: true }) }
