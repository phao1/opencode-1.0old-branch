import path from "node:path"
import { existsSync, lstatSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { checked, execute } from "./process.ts"
import { type Config, type Run } from "./types.ts"
import { Store } from "./store.ts"

const git = (cwd: string, args: string[]) => checked(["git", ...args], cwd)
export async function baseCommit(root: string, config: Config) {
  return git(root, ["rev-parse", "--verify", `${config.baseRef}^{commit}`])
}
export async function prepare(root: string, store: Store, run: Run, signal: AbortSignal) {
  const directory = path.join(store.directory, "workspaces", run.id)
  await store.update(run.id, r => { r.workspace = directory })
  if (!existsSync(path.join(directory, ".git"))) {
    await checked(["git", "worktree", "add", "-b", run.branch, directory, run.baseCommit], root, { signal })
  }
  const branch = await git(directory, ["branch", "--show-current"])
  if (branch !== run.branch) throw new Error(`Workspace branch mismatch: ${branch}`)
  await guard(directory, run)
  return directory
}
export async function changedPaths(cwd: string, base: string) {
  const tracked = await execute(["git", "diff", "--name-only", "-z", base, "--"], cwd)
  const untracked = await execute(["git", "ls-files", "--others", "--exclude-standard", "-z"], cwd)
  if (tracked.code || untracked.code) throw new Error("Unable to enumerate workspace changes")
  return [...new Set((tracked.stdout + untracked.stdout).split("\0").filter(Boolean))]
}
export async function guard(cwd: string, run: Run) {
  await git(cwd, ["merge-base", "--is-ancestor", run.baseCommit, "HEAD"])
  const paths = await changedPaths(cwd, run.baseCommit)
  for (const file of paths) {
    if (file === run.config.kernelPath || file.startsWith(`${run.config.kernelPath}/`)) throw new Error(`Kernel changes forbidden: ${file}`)
    if (!run.config.allowedPaths.some(prefix => prefix.endsWith("/") ? file.startsWith(prefix) : file === prefix)) throw new Error(`Outside allowed paths: ${file}`)
    const parts = file.split("/")
    for (let i = 1; i <= parts.length; i++) {
      const item = path.join(cwd, ...parts.slice(0, i))
      if (existsSync(item) && lstatSync(item).isSymbolicLink()) throw new Error(`Changed symlink path forbidden: ${file}`)
    }
  }
  const tree = await git(cwd, ["ls-tree", "HEAD", "--", run.config.kernelPath])
  if (tree) {
    if (!tree.startsWith(`160000 commit ${run.config.kernelCommit}\t`)) throw new Error("Kernel gitlink does not match the pinned baseline")
    const kernel = path.join(cwd, run.config.kernelPath)
    if (existsSync(path.join(kernel, ".git"))) {
      if (await git(kernel, ["rev-parse", "HEAD"]) !== run.config.kernelCommit) throw new Error("Kernel checkout drift")
      const diff = await git(kernel, ["diff", "HEAD", "--"])
      if (diff) throw new Error("Original kernel tracked source modified")
    }
  }
  return paths
}
export async function fingerprint(cwd: string, run: Run) {
  const hash = createHash("sha256")
  // Hash changed file contents/modes, independent of whether Git has staged or
  // committed them. Publication retries must prove the same verified content.
  for (const file of (await changedPaths(cwd, run.baseCommit)).sort()) {
    hash.update(file + "\0")
    const target = path.join(cwd, file)
    if (!existsSync(target)) { hash.update("deleted\0"); continue }
    const stat = lstatSync(target)
    hash.update(`${stat.mode & 0o111}:`)
    if (stat.isFile()) hash.update(readFileSync(target))
    else hash.update(stat.isSymbolicLink() ? "symlink" : "directory")
    hash.update("\0")
  }
  return hash.digest("hex")
}
export async function publish(store: Store, id: string, signal: AbortSignal) {
  let run = store.run(id)
  const cwd = run.workspace!, policy = run.config.publish
  const paths = await guard(cwd, run)
  if (!paths.length && !run.publication?.commit) throw new Error("No implementation diff to hand off")
  const bodyPath = path.join(store.directory, "artifacts", id, "PR.md")
  if (!policy.enabled) return
  if (!policy.repository) throw new Error("publish.repository is required to publish a PR")
  const status = await git(cwd, ["status", "--porcelain"])
  if (status) {
    await checked(["git", "add", "--", ...paths], cwd, { signal })
    await checked(["git", "-c", "user.name=One-shot", "-c", "user.email=one-shot@localhost", "commit", "-m", `feat: ${store.read().issues[run.issueId].title}`], cwd, { signal })
  }
  const commit = await git(cwd, ["rev-parse", "HEAD"])
  if (commit === run.baseCommit) throw new Error("No committed change")
  await store.update(id, r => { r.publication = { ...r.publication, commit } })
  await checked(["git", "push", policy.remote, `HEAD:refs/heads/${run.branch}`], cwd, { signal })
  const prs = JSON.parse(await checked(["gh", "pr", "list", "--repo", policy.repository, "--head", run.branch, "--state", "all", "--json", "url,state,baseRefName"], cwd, { signal }))
  let url = prs[0]?.url
  if (url && (prs[0].state !== "OPEN" || prs[0].baseRefName !== policy.baseBranch)) throw new Error("Existing PR is closed or has a different base; reconcile before retry")
  if (!url) url = await checked(["gh", "pr", "create", "--draft", "--repo", policy.repository, "--base", policy.baseBranch, "--head", run.branch, "--title", store.read().issues[run.issueId].title, "--body-file", bodyPath], cwd, { signal })
  await store.update(id, r => { r.publication = { commit, url } })
}
