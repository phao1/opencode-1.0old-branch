import { z } from "zod"

export const PROMPT_VERSION = "one-shot/1"
const text = z.string().trim().min(1).max(100_000)
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/)
const argv = z.array(text).min(1).max(100)
const command = z.object({ id, argv, timeoutMs: z.number().int().positive().max(3_600_000).default(300_000), required: z.boolean().default(true), kind: z.enum(["cli", "ui", "api", "db", "test"]).default("test") })
export const criterionSchema = z.object({ id, description: text })
export const issueInputSchema = z.object({ title: text.max(300), body: text, criteria: z.array(criterionSchema).max(100).default([]), source: text.max(2000).default("manual"), sourceId: text.max(2000).optional(), evidence: z.array(text).max(100).default([]), triageId: id.optional() })
export type IssueInput = z.input<typeof issueInputSchema>
export type Issue = z.output<typeof issueInputSchema> & { id: string; dedupKey: string; status: "candidate" | "todo" | "running" | "awaiting_acceptance" | "accepted" | "blocked"; runId?: string; createdAt: string }
const agentSchema = z.object({
  kind: z.enum(["opencode", "command"]), argv: argv.optional(), serverUrl: z.string().url().optional(),
  model: z.string().optional(), agent: z.string().default("build"), fallback: z.array(id).default([]),
}).superRefine((a, ctx) => {
  if (a.kind === "command" && !a.argv) ctx.addIssue({ code: "custom", message: "command agent requires argv" })
  if (a.kind === "opencode" && !a.serverUrl) ctx.addIssue({ code: "custom", message: "opencode agent requires serverUrl" })
})
const loopSchema = z.object({
  id, kind: z.enum(["release", "source", "file", "command", "github"]), enabled: z.boolean().default(true),
  intervalSeconds: z.number().int().min(10).default(3600), daily: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), timezone: z.string().default("Asia/Singapore"),
  file: text.optional(), argv: argv.optional(), repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/).optional(),
  label: text.default("todo"), trustedActors: z.array(text).default([]), maxPages: z.number().int().min(1).max(100).default(10), maxAnalyses: z.number().int().min(1).max(100).default(10),
  ref: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,199}$/).default("main"),
  maxSourceFiles: z.number().int().min(1).max(200).default(30),
  maxSourceFileBytes: z.number().int().min(1024).max(1_000_000).default(32_000),
  maxSourceBytes: z.number().int().min(1024).max(5_000_000).default(256_000),
})
export const configSchema = z.object({
  version: z.literal(1), stateDir: text.default(".codeagent/one-shot"), baseRef: text.default("HEAD"),
  concurrency: z.number().int().min(1).max(20).default(5),
  kernelPath: text.default("agent-kernel"), kernelCommit: z.string().regex(/^[0-9a-f]{40}$/).default("517e6c9aa4c61dbc125e7654fc596f1d529f20d9"),
  allowedPaths: z.array(text).min(1).default(["agent-kernel-extension/", "external-plugins/", "docs/", "test/", "agents/", "scripts/", ".opencode/"]),
  agents: z.record(id, agentSchema),
  roles: z.object({ planner: id, builder: id, evaluator: id, analyst: id.optional(), designReviewers: z.array(id).min(1).max(8), codeReviewers: z.array(id).max(8).default([]) }),
  checks: z.array(command).min(1), setup: z.array(command).default([]),
  limits: z.object({ timeoutMs: z.number().int().positive().max(3_600_000).default(900_000), maxCalls: z.number().int().min(5).max(500).default(60), maxRepairs: z.number().int().min(0).max(10).default(3), maxDesignRevisions: z.number().int().min(0).max(10).default(2), maxOutputBytes: z.number().int().min(1024).max(20_000_000).default(2_000_000) }).default({ timeoutMs: 900_000, maxCalls: 60, maxRepairs: 3, maxDesignRevisions: 2, maxOutputBytes: 2_000_000 }),
  publish: z.object({ enabled: z.boolean().default(false), remote: id.default("origin"), repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/).optional(), baseBranch: text.default("dev") }).default({ enabled: false, remote: "origin", baseBranch: "dev" }),
  loops: z.array(loopSchema).default([]),
}).superRefine((c, ctx) => {
  const selected = [c.roles.planner, c.roles.builder, c.roles.evaluator, c.roles.analyst, ...c.roles.designReviewers, ...c.roles.codeReviewers].filter(Boolean) as string[]
  for (const name of selected) if (!c.agents[name]) ctx.addIssue({ code: "custom", message: `Unknown agent ${name}` })
  for (const [name, agent] of Object.entries(c.agents)) for (const fallback of agent.fallback) if (!c.agents[fallback] || fallback === name) ctx.addIssue({ code: "custom", message: `Invalid fallback ${fallback}` })
  for (const names of [c.roles.designReviewers, c.roles.codeReviewers]) if (new Set(names).size !== names.length) ctx.addIssue({ code: "custom", message: "Reviewer IDs must be unique" })
  if (new Set(c.checks.map(x => x.id)).size !== c.checks.length || new Set(c.loops.map(x => x.id)).size !== c.loops.length) ctx.addIssue({ code: "custom", message: "Check/loop IDs must be unique" })
  if (!c.checks.some(x => x.required)) ctx.addIssue({ code: "custom", message: "At least one required real check is required" })
  for (const loop of c.loops) {
    if ((loop.kind === "file" && !loop.file) || (loop.kind === "command" && !loop.argv) || (loop.kind === "source" && !loop.repository) || (loop.kind === "github" && (!loop.repository || !loop.trustedActors.length))) ctx.addIssue({ code: "custom", message: `Missing source configuration for ${loop.id}` })
    try { new Intl.DateTimeFormat("en", { timeZone: loop.timezone }) } catch { ctx.addIssue({ code: "custom", message: `Invalid timezone ${loop.timezone}` }) }
  }
  for (const p of c.allowedPaths) if (p.startsWith("/") || p.includes("..") || p.includes("\\") || p === ".") ctx.addIssue({ code: "custom", message: "allowedPaths must be explicit repository-relative paths" })
})
export type Config = z.output<typeof configSchema>
export type Role = "analyze" | "plan" | "design_review" | "revise" | "build" | "evaluate" | "code_review"
export const planSchema = z.object({ summary: text, design: text, criteria: z.array(criterionSchema).min(1).max(100), manualTests: z.array(text).min(1), skillProposal: text.optional() }).refine(p => new Set(p.criteria.map(x => x.id)).size === p.criteria.length, "Criterion IDs must be unique")
const findingSchema = z.object({ id, severity: z.enum(["blocker", "major", "minor"]), description: text, evidence: text })
export const reviewSchema = z.object({ summary: text, findings: z.array(findingSchema).max(100) })
export const buildSchema = z.object({ summary: text, evidence: z.array(text).min(1) })
export const evaluationSchema = z.object({ summary: text, results: z.array(z.object({ criterionId: id, passed: z.boolean(), evidence: z.array(text).min(1) })).min(1) })
export const analysisSchema = z.object({ summary: text, candidates: z.array(issueInputSchema).max(30) })
export const schemas = { analyze: analysisSchema, plan: planSchema, revise: planSchema, design_review: reviewSchema, code_review: reviewSchema, build: buildSchema, evaluate: evaluationSchema }
export type Plan = z.infer<typeof planSchema>
export type Review = z.infer<typeof reviewSchema>
export type Evaluation = z.infer<typeof evaluationSchema>
export type Stage = "designing" | "design_review" | "implementing" | "verifying" | "code_review" | "handoff"
export type RunStatus = "queued" | Stage | "blocked" | "cancelled" | "awaiting_acceptance" | "accepted"
export type CheckResult = { id: string; kind: string; required: boolean; code: number; stdout: string; stderr: string; durationMs: number; error?: string }
export type Invocation = { id: string; role: Role; agent: string; startedAt: string; finishedAt?: string; status: "running" | "done" | "failed"; sessionId?: string; pid?: number; error?: string; usage?: { tokens?: number; cost?: number }; result?: unknown }
export type Run = {
  id: string; issueId: string; config: Config; status: RunStatus; phase: Stage; baseCommit: string; branch: string;
  createdAt: string; updatedAt: string; workspace?: string; plan?: Plan; planRevision: number;
  reviews: Record<string, Review>; checks: CheckResult[]; evaluation?: Evaluation; repairCount: number;
  calls: Invocation[]; activeCommand?: { pid: number; id: string }; error?: string; verifiedFingerprint?: string; cancelled: boolean; feedback: string[]; publication?: { commit?: string; url?: string };
  history: Array<{ at: string; event: string; detail?: string }>;
}
export type LoopState = { lastSlot?: string; nextAt?: number; cursor?: Record<string, string>; error?: string; lastRunAt?: string }
export type Database = { version: 1; issues: Record<string, Issue>; runs: Record<string, Run>; loops: Record<string, LoopState>; reports: Array<{ id: string; source: string; at: string; report: unknown }> }
