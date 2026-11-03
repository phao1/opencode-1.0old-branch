// Steering v2 deterministic installed-artifact verification. Real-model demos
// are deliberately separate so CI needs no model credentials.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
execFileSync(process.execPath, ['scripts/package-steering.mjs'], { cwd: root, stdio: 'inherit' })
const report = JSON.parse(readFileSync(path.join(root, 'dist/steering-package-report.json'), 'utf8'))
execFileSync(process.execPath, ['--test', 'external-plugins/steering/test/state.test.mjs', 'external-plugins/steering/test/kernel.test.mjs'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, STEERING_INSTALLED_PLUGIN: report.installedPluginPath },
})
