import path from "node:path"
import { randomUUID, createHash } from "node:crypto"
import { Store, lock, event, alive } from "./store.ts"
import { configSchema, criterionSchema, issueInputSchema, planSchema, reviewSchema, evaluationSchema, type Config, type Criterion, type IssueInput, type Run, type Stage, type CheckResult, type Evaluation, type Plan } from "./types.ts"
import { callAgent, executeAgent, type AgentExecutor } from "./agents.ts"
import { baseCommit, prepare, guard, fingerprint, publish } from "./workspace.ts"
import { execute } from "./process.ts"
import { captureTrust } from "./trust.ts"

const sourceKey = (data: ReturnType<typeof issueInputSchema.parse>) => createHash("sha256").update(`${data.source}\0${data.sourceId ?? `${data.title}\0${data.body}`}`).digest("hex")
const criterionKey = (c: Criterion) => JSON.stringify({ id: c.id, description: c.description, checks: c.checks ? [...c.checks].sort() : undefined, manual: c.manual })
const contentKey = (data: ReturnType<typeof issueInputSchema.parse>) => JSON.stringify({ ...data, criteria: data.criteria.map(criterionKey).sort(), evidence: [...data.evidence].sort() })
function validateCriteria(criteria: Criterion[], config: Config) {
  if (!criteria.length) throw new Error("At least one acceptance criterion is required before enqueue")
  if (new Set(criteria.map(c => c.id)).size !== criteria.length) throw new Error("Criterion IDs must be unique")
  for (const value of criteria) {
    const c = criterionSchema.parse(value)
    if (!c.checks && !c.manual) throw new Error(`Criterion ${c.id} must specify checks or manual:true before enqueue`)
    for (const check of c.checks ?? []) if (!config.checks.some(cmd => cmd.id === check)) throw new Error(`Unknown check ${check} for criterion ${c.id}`)
  }
}
function validateEvaluation(plan: Plan, checks: CheckResult[], value: unknown): Evaluation {
  const evaluation = evaluationSchema.parse(value), ids = evaluation.results.map(r => r.criterionId)
  if (new Set(ids).size !== ids.length || ids.length !== plan.criteria.length || plan.criteria.some(c => !ids.includes(c.id))) throw new Error("Evaluator must cover each acceptance criterion exactly once")
  for (const result of evaluation.results) {
    const criterion = plan.criteria.find(c => c.id === result.criterionId)!
    if (criterion.manual) {
      if (result.passed !== null) throw new Error(`Manual criterion ${criterion.id} must report passed=null, pending operator acceptance`)
    } else {
      if (result.passed === null) throw new Error(`Automatic criterion ${criterion.id} must report true or false`)
      if (result.passed) for (const id of criterion.checks!) {
        if (!result.evidence.includes(`check:${id}`) || !checks.some(c => c.id === id && c.code === 0)) throw new Error(`Passing criterion ${criterion.id} lacks successful bound check ${id} and check:${id} evidence`)
      }
    }
  }
  return evaluation
}

export async function createIssue(store: Store, input: IssueInput) {
  const data = issueInputSchema.parse(input)
  const dedupKey = sourceKey(data)
  return store.transact(db => {
    const existing = Object.values(db.issues).find(x => x.dedupKey === dedupKey)
    if (existing) {
      if (contentKey(issueInputSchema.parse(existing)) !== contentKey(data)) throw new Error(`Source content conflict with ${existing.id}; inspect it and explicitly update an unqueued candidate or choose a new source identity`)
      return existing
    }
    const id = `issue-${randomUUID()}`
    return db.issues[id] = { ...data, id, dedupKey, status: "candidate", createdAt: new Date().toISOString() }
  })
}
export async function updateIssue(store: Store, id: string, input: IssueInput) {
  const data = issueInputSchema.parse(input)
  return store.transact(db => {
    const issue = db.issues[id]; if (!issue) throw new Error(`Unknown issue ${id}`)
    if (issue.status !== "candidate" || issue.runId) throw new Error("Only an unqueued candidate can be explicitly updated")
    if (sourceKey(data) !== issue.dedupKey) throw new Error("Candidate source identity cannot change; create a new issue instead")
    return db.issues[id] = { ...data, id: issue.id, dedupKey: issue.dedupKey, status: "candidate", createdAt: issue.createdAt }
  })
}
export async function enqueue(root: string, store: Store, config: Config, issueId: string) {
  config = configSchema.parse(config)
  const initial = store.read().issues[issueId]; if (!initial) throw new Error(`Unknown issue ${issueId}`)
  if (initial.runId) return store.run(initial.runId)
  validateCriteria(initial.criteria, config)
  const base = await baseCommit(root, config)
  const trust = await captureTrust(root, base, config)
  return store.transact(db => {
    const issue = db.issues[issueId]; if (!issue) throw new Error(`Unknown issue ${issueId}`)
    if (issue.runId) return db.runs[issue.runId]
    if (contentKey(issueInputSchema.parse(issue)) !== contentKey(issueInputSchema.parse(initial))) throw new Error("Candidate changed during enqueue; inspect and retry")
    const id = `run-${randomUUID()}`, now = new Date().toISOString()
    const run: Run = { id, issueId, config: structuredClone(config), trust, status: "queued", phase: "designing", baseCommit: base, branch: `one-shot/${id}`, createdAt: now, updatedAt: now, planRevision: 0, reviews: {}, checks: [], repairCount: 0, calls: [], cancelled: false, feedback: [], history: [] }
    issue.status = "todo"; issue.runId = id; db.runs[id] = run; event(run, "queued")
    return run
  })
}
export async function cancel(store: Store, id: string) { return store.update(id, r => { if (r.status === "accepted") throw new Error("Accepted run cannot be cancelled"); r.cancelled = true; r.status = "cancelled"; event(r, "cancel-requested") }) }
async function idleUpdate(store: Store, id: string, update: Parameters<Store["update"]>[1]) {
  store.run(id)
  const release = await lock(path.join(store.directory, `${id}.lock`), 0)
  try { return await store.update(id, update) } finally { release() }
}
export async function resume(store: Store, id: string) { return idleUpdate(store, id, r => {
  if (!["blocked", "cancelled"].includes(r.status)) throw new Error("Only blocked or cancelled runs can resume")
  r.status = "queued"; r.cancelled = false; r.error = undefined; event(r, "resume-requested")
}) }
export async function accept(store: Store, id: string, note: string) {
  const run = store.run(id)
  if (run.status !== "awaiting_acceptance" || !note.trim()) throw new Error("Acceptance requires awaiting_acceptance state and an operator note")
  validatePlan(run, run.plan, store.read().issues[run.issueId].criteria)
  validateEvaluation(run.plan!, run.checks, run.evaluation)
  await guard(run.workspace!, run)
  if (await fingerprint(run.workspace!, run) !== run.verifiedFingerprint) throw new Error("Workspace changed since verification; reject and re-verify")
  return idleUpdate(store, id, (r, db) => {
    if (r.status !== "awaiting_acceptance") throw new Error("Run state changed")
    r.status = "accepted"; db.issues[r.issueId].status = "accepted"; event(r, "human-accepted", note)
  })
}
export async function reject(store: Store, id: string, note: string) { return idleUpdate(store, id, (r, db) => {
  if (r.status !== "awaiting_acceptance" || !note.trim()) throw new Error("Rejection requires awaiting_acceptance state and feedback")
  r.feedback.push(note); r.status = "queued"; r.phase = "implementing"; r.reviews = {}; r.repairCount = 0; db.issues[r.issueId].status = "todo"; event(r, "human-rejected", note)
}) }
function validatePlan(run: Run, value: unknown, criteria: Criterion[]) {
  const plan = planSchema.parse(value)
  validateCriteria(criteria, run.config)
  validateCriteria(plan.criteria, run.config)
  for (const original of criteria) if (!plan.criteria.some(c => criterionKey(c) === criterionKey(original))) throw new Error(`Plan dropped or changed required criterion ${original.id}`)
  return plan
}
async function next(store: Store, id: string, phase: Stage) { await store.update(id, r => { if (r.cancelled) throw new Error("Cancelled"); r.phase = phase; r.status = phase; event(r, `phase:${phase}`) }) }
function blockers(reviews: Run["reviews"]) {
  const items = Object.values(reviews).flatMap(r => r.findings).filter(f => f.severity !== "minor")
  return [...new Map(items.map(f => [`${f.description}\0${f.evidence}`, f])).values()]
}
export async function runOne(root: string, store: Store, id: string, executor: AgentExecutor = executeAgent, stopSignal?: AbortSignal) {
  store.run(id)
  const release = await lock(path.join(store.directory, `${id}.lock`), 0)
  const controller = new AbortController()
  const stop = () => controller.abort(new Error("Worker stopping"))
  stopSignal?.addEventListener("abort", stop, { once: true })
  if (stopSignal?.aborted) stop()
  const poll = setInterval(() => { if (store.run(id).cancelled) controller.abort(new Error("Cancelled")) }, 250)
  let phase: Stage = store.run(id).phase
  try {
    let run = store.run(id)
    if (["accepted", "awaiting_acceptance", "cancelled", "blocked"].includes(run.status)) return run
    validateCriteria(store.read().issues[run.issueId].criteria, run.config)
    if (run.plan) validatePlan(run, run.plan, store.read().issues[run.issueId].criteria)
    if (run.activeCommand) {
      if (alive(run.activeCommand.pid)) throw new Error(`Interrupted command ${run.activeCommand.id} process ${run.activeCommand.pid} still lives; stop it before resuming`)
      await store.update(id, r => { delete r.activeCommand })
    }
    // A crashed worker may leave a live command child. Refuse duplicate execution.
    for (const call of run.calls.filter(c => c.status === "running")) {
      if (call.pid && alive(call.pid)) throw new Error(`Interrupted agent process ${call.pid} still lives; stop it before resuming`)
      if (call.sessionId) {
        const agent = run.config.agents[call.agent]
        if (agent.kind === "opencode") {
          const password = process.env.OPENCODE_SERVER_PASSWORD
          const res = await fetch(`${agent.serverUrl!.replace(/\/$/, "")}/session/${call.sessionId}/abort?directory=${encodeURIComponent(run.workspace!)}`, { method: "POST", headers: password ? { Authorization: `Basic ${Buffer.from(`${process.env.OPENCODE_SERVER_USERNAME ?? "opencode"}:${password}`).toString("base64")}` } : {}, signal: AbortSignal.timeout(5000) })
          if (!res.ok && res.status !== 404) throw new Error("Cannot reconcile interrupted OpenCode session")
        }
      }
      await store.update(id, r => Object.assign(r.calls.find(c => c.id === call.id)!, { status: "failed", error: "Interrupted; reconciled before retry" }))
    }
    const cwd = await prepare(root, store, run, controller.signal)
    await store.update(id, (r, db) => { r.status = r.phase; db.issues[r.issueId].status = "running" })
    const setupDone = store.run(id).history.some(e => e.event === "setup-complete")
    if (!setupDone) {
      for (const cmd of run.config.setup) {
        if (store.run(id).history.some(e => e.event === `setup:${cmd.id}:complete`)) continue
        await guard(cwd, run)
        const result = await execute(cmd.argv, cwd, { signal: controller.signal, timeoutMs: cmd.timeoutMs, maxOutputBytes: run.config.limits.maxOutputBytes, onStart: async pid => { await store.update(id, r => { r.activeCommand = { pid, id: cmd.id } }) } })
        await store.update(id, r => { delete r.activeCommand })
        store.artifact(id, `setup-${cmd.id}.json`, JSON.stringify(result, null, 2))
        await guard(cwd, run)
        if (result.code !== 0) throw new Error(`Setup ${cmd.id} failed: ${result.error ?? result.stderr}`)
        await store.update(id, r => event(r, `setup:${cmd.id}:complete`))
      }
      await store.update(id, r => event(r, "setup-complete"))
    }
    while (true) {
      run = store.run(id); controller.signal.throwIfAborted(); if (run.cancelled) throw new Error("Cancelled")
      phase = run.phase
      const call = (agent: string, role: Parameters<typeof callAgent>[3], payload: unknown) => callAgent(store, id, agent, role, payload, controller.signal, executor)
      const readonly = async <T>(fn: () => Promise<T>) => {
        const before = await fingerprint(cwd, store.run(id))
        try { return await fn() } finally {
          await guard(cwd, store.run(id))
          if (await fingerprint(cwd, store.run(id)) !== before) throw new Error("Read-only agent phase modified the workspace")
        }
      }
      if (phase === "designing") {
        const value = await readonly(() => call(run.config.roles.planner, "plan", { request: store.read().issues[run.issueId] }))
        const plan = validatePlan(run, value, store.read().issues[run.issueId].criteria)
        await store.update(id, r => { r.plan = plan })
        store.artifact(id, "DESIGN.md", plan.design)
        await next(store, id, "design_review")
      } else if (phase === "design_review" || phase === "code_review") {
        const reviewRole = phase === "design_review" ? "design_review" : "code_review"
        const agents = phase === "design_review" ? run.config.roles.designReviewers : run.config.roles.codeReviewers
        const results = await readonly(() => Promise.allSettled(agents.map(async agent => {
          const key = `${phase}:${run.planRevision}:${run.repairCount}:${agent}`
          if (store.run(id).reviews[key]) return
          const value = reviewSchema.parse(await call(agent, reviewRole, { plan: run.plan, baseCommit: run.baseCommit, checks: run.checks, evaluation: run.evaluation }))
          await store.update(id, r => { r.reviews[key] = value })
        })))
        const failures = results.filter(x => x.status === "rejected") as PromiseRejectedResult[]
        if (failures.length) throw new Error(failures.map(x => String(x.reason)).join("; "))
        const reviews = Object.fromEntries(Object.entries(store.run(id).reviews).filter(([key]) => key.startsWith(`${phase}:${run.planRevision}:${run.repairCount}:`)))
        const findings = blockers(reviews)
        if (findings.length && phase === "design_review") {
          if (run.planRevision >= run.config.limits.maxDesignRevisions) throw new Error("Design review budget exhausted; reconsider architecture")
          const value = await readonly(() => call(run.config.roles.planner, "revise", { plan: run.plan, findings }))
          const plan = validatePlan(run, value, run.plan!.criteria)
          await store.update(id, r => { r.plan = plan; r.planRevision++ })
          store.artifact(id, "DESIGN.md", plan.design)
        } else if (findings.length) {
          await repair(store, id, JSON.stringify(findings)); await next(store, id, "implementing")
        } else await next(store, id, phase === "design_review" ? "implementing" : "handoff")
      } else if (phase === "implementing") {
        await call(run.config.roles.builder, "build", { plan: run.plan, checks: run.checks, evaluation: run.evaluation, feedback: run.feedback })
        await guard(cwd, run)
        await next(store, id, "verifying")
      } else if (phase === "verifying") {
        const checks: CheckResult[] = []
        for (const cmd of run.config.checks) {
          await guard(cwd, run)
          const result = await execute(cmd.argv, cwd, { signal: controller.signal, timeoutMs: cmd.timeoutMs, maxOutputBytes: run.config.limits.maxOutputBytes, onStart: async pid => { await store.update(id, r => { r.activeCommand = { pid, id: cmd.id } }) } })
          await store.update(id, r => { delete r.activeCommand })
          checks.push({ ...result, id: cmd.id, kind: cmd.kind, required: cmd.required })
          store.artifact(id, `check-${run.repairCount}-${cmd.id}.json`, JSON.stringify(result, null, 2))
          await guard(cwd, run)
        }
        await store.update(id, r => { r.checks = checks })
        await guard(cwd, run)
        const evaluation = validateEvaluation(run.plan!, checks, await readonly(() => call(run.config.roles.evaluator, "evaluate", { plan: run.plan, checks, baseCommit: run.baseCommit })))
        await store.update(id, r => { r.evaluation = evaluation })
        const failed = checks.filter(c => c.required && c.code !== 0)
        if (failed.length || evaluation.results.some(r => r.passed === false)) {
          await repair(store, id, JSON.stringify({ checks: failed, evaluation })); await next(store, id, "implementing")
        } else {
          const verifiedFingerprint = await fingerprint(cwd, run)
          await store.update(id, r => { r.verifiedFingerprint = verifiedFingerprint })
          await next(store, id, run.config.roles.codeReviewers.length ? "code_review" : "handoff")
        }
      } else {
        validateEvaluation(run.plan!, run.checks, run.evaluation)
        await guard(cwd, run)
        if (await fingerprint(cwd, run) !== run.verifiedFingerprint) throw new Error("Workspace changed after verification; re-verify before handoff")
        const issue = store.read().issues[run.issueId]
        const manual = `# Manual acceptance\n\n${run.plan!.manualTests.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\n## Criteria\n\n${run.plan!.criteria.map(c => `- ${c.id}: ${c.description}`).join("\n")}\n`
        store.artifact(id, "TEST-MANUAL.md", manual)
        store.artifact(id, "EVALUATION.json", JSON.stringify({ trust: run.trust, checks: run.checks, evaluation: run.evaluation, reviews: run.reviews, calls: run.calls.map(({ result, ...c }) => c) }, null, 2))
        store.artifact(id, "SKILL-PROPOSAL.md", run.plan!.skillProposal ?? "No reusable skill proposed. Review repeated successful runs before extracting a skill.\n")
        store.artifact(id, "PR.md", `# ${issue.title}\n\n${run.plan!.summary}\n\n## Design\n\n${run.plan!.design}\n\n## Automated checks\n\n${run.checks.map(c => `- ${c.id}: exit ${c.code} (${c.durationMs}ms)`).join("\n")}\n\n## Independent evaluation\n\n${run.evaluation!.results.map(r => `- ${r.criterionId}: ${r.passed === null ? "MANUAL/PENDING" : r.passed ? "PASS" : "FAIL"}; ${r.evidence.join("; ")}`).join("\n")}\n\n${manual}\n\nSource: ${issue.source}\nRun: ${id}\nArtifacts: ${path.join(store.directory, "artifacts", id)}\n`)
        await publish(store, id, controller.signal)
        await store.update(id, (r, db) => { if (r.cancelled) throw new Error("Cancelled"); r.status = "awaiting_acceptance"; db.issues[r.issueId].status = "awaiting_acceptance"; event(r, "handoff-complete", r.publication?.url) })
        return store.run(id)
      }
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await store.update(id, (r, db) => { r.status = r.cancelled ? "cancelled" : stopSignal?.aborted ? "queued" : "blocked"; r.error = error; db.issues[r.issueId].status = r.status === "queued" ? "todo" : "blocked"; event(r, r.status, error) })
    return store.run(id)
  } finally { clearInterval(poll); stopSignal?.removeEventListener("abort", stop); release() }
}
async function repair(store: Store, id: string, feedback: string) {
  await store.update(id, r => {
    if (r.repairCount >= r.config.limits.maxRepairs) throw new Error("Repair budget exhausted; inspect logs and reconsider architecture")
    r.repairCount++; r.feedback.push(feedback); event(r, "repair", feedback)
  })
}
export async function runQueue(root: string, store: Store, config: Config, executor: AgentExecutor = executeAgent, stopSignal?: AbortSignal) {
  const release = await lock(path.join(store.directory, "worker.lock"), 0)
  try {
    const queue = Object.values(store.read().runs).filter(r => !["accepted", "awaiting_acceptance", "cancelled", "blocked"].includes(r.status))
    const results: Run[] = []
    const workers = await Promise.allSettled(Array.from({ length: Math.min(config.concurrency, queue.length) }, async () => {
      while (queue.length && !stopSignal?.aborted) { const run = queue.shift()!; results.push(await runOne(root, store, run.id, executor, stopSignal)) }
    }))
    const failed = workers.find(w => w.status === "rejected") as PromiseRejectedResult | undefined
    if (failed) throw failed.reason
    return results
  } finally { release() }
}
