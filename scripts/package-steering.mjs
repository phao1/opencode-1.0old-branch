import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = path.join(root, 'external-plugins/steering')
const output = path.join(root, 'dist')
mkdirSync(output, { recursive: true })
mkdirSync(path.join(root, '.codeagent'), { recursive: true })
const fixture = mkdtempSync(path.join(root, '.codeagent/steering-package-'))
const build = execFileSync(process.env.BUN_BINARY ?? 'bun', ['build', path.join(root, 'external-plugins/src/steering.ts'), '--target=bun', '--outfile', path.join(pkg, 'dist/index.js')], { encoding: 'utf8' })
writeFileSync(path.join(fixture, 'build.log'), build)
const npm = process.env.NPM_BINARY ?? 'npm'
const packed = JSON.parse(execFileSync(npm, ['pack', pkg, '--pack-destination', output, '--ignore-scripts', '--json'], { encoding: 'utf8' }))[0]
writeFileSync(path.join(fixture, 'pack.json'), JSON.stringify(packed, null, 2))
assert.deepEqual(packed.files.map(x => x.path).sort(), ['README.md', 'dist/index.js', 'package.json'])
const artifact = path.join(output, packed.filename)
const sha256 = createHash('sha256').update(readFileSync(artifact)).digest('hex')
const install = path.join(fixture, 'install')
mkdirSync(install)
writeFileSync(path.join(install, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
const installation = execFileSync(npm, ['install', '--prefix', install, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact], { encoding: 'utf8' })
writeFileSync(path.join(fixture, 'install.log'), installation)
const installed = path.join(install, 'node_modules/@oneshot/opencode-steering')
const manifest = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'))
assert.equal(manifest.version, JSON.parse(readFileSync(path.join(root, 'external-plugins/steering/package.json'), 'utf8')).version, 'Installed version must match the source package')
assert.equal(manifest.dependencies, undefined, 'The standalone artifact bundles its public runtime dependencies')
const installedPluginPath = path.join(installed, 'dist/index.js')
const bundle = readFileSync(installedPluginPath, 'utf8')
assert.deepEqual(execFileSync('tar', ['-xOf', artifact, 'package/dist/index.js']), readFileSync(installedPluginPath), 'Installed bytes must exactly match the archived entry')
const installedBundleSHA256 = createHash('sha256').update(bundle).digest('hex')
assert.ok(!bundle.includes(root), 'Bundle must not embed the development workspace path')
assert.ok(!/(?:from\s*|import\s*\(|require\s*\()\s*['"][^'"]*(?:agent-kernel|one-shot|codeagent-extension|@\/)/.test(bundle), 'Bundle must not import private kernel or worker modules')
const exported = await import(pathToFileURL(installedPluginPath))
assert.deepEqual(Object.keys(exported), ['SteeringPlugin'], 'Legacy loader must see exactly one plugin function')
assert.equal(typeof exported.SteeringPlugin, 'function')
const report = { package: manifest.name, version: manifest.version, artifact, sha256, integrity: packed.integrity,
  fixture, installedPluginPath, installedBundleSHA256, files: packed.files.map(file => file.path),
  offlineInstallation: 'passed', importedEntry: 'passed', kernelEndToEnd: 'not checked by packaging; run verify-steering', passed: true }
writeFileSync(path.join(fixture, 'report.json'), JSON.stringify(report, null, 2))
writeFileSync(path.join(output, 'steering-package-report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
