import { execFileSync } from 'node:child_process'
import { existsSync, symlinkSync, lstatSync, unlinkSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'

// Reuse installed dependencies and the exact immutable kernel object database.
// This does not upgrade the submodule or change its tracked sources.
const source = process.env.ONE_SHOT_REFERENCE_ROOT
if (!source || path.resolve(source) === process.cwd()) throw new Error('Set ONE_SHOT_REFERENCE_ROOT to the prepared parent checkout')
execFileSync('git', ['-c', 'protocol.file.allow=always', '-c', `submodule.agent-kernel.url=${path.join(source, 'agent-kernel')}`, 'submodule', 'update', '--init', 'agent-kernel'], { stdio: 'inherit' })
for (const directory of ['node_modules', 'agent-kernel/node_modules']) {
  // Git's node_modules/ ignore pattern matches a directory, not a symlink.
  // Keep the ignored directory real and link only its installed entries.
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) unlinkSync(directory)
  mkdirSync(directory, { recursive: true })
  for (const entry of readdirSync(path.join(source, directory))) {
    const target = path.join(directory, entry)
    if (!existsSync(target)) symlinkSync(path.join(source, directory, entry), target)
  }
}
execFileSync(process.execPath, ['scripts/check-kernel.mjs'], { stdio: 'inherit' })
