import type { PluginInput, PluginOptions } from "@opencode-ai/plugin"
import { createHash, randomUUID } from "node:crypto"

// Structural records accommodate runtime v1.3.17 fields absent from SDK v1.
export type Part = { id?: string; type: string; [key: string]: unknown }
export type Message = { info: { id: string; sessionID: string; role: string; parentID?: string;
  time?: { created?: number; completed?: number }; finish?: string; summary?: unknown; error?: unknown;
  [key: string]: unknown }; parts: Part[] }
type Guide = { id: string; expected: string; saved?: string; prepared?: string; eligible: boolean; steering?: boolean; empty?: boolean; replayedAs?: string; mediaStripped?: boolean; attempted?: string; compacted?: string; summaryID?: string;
  info: Message["info"]; parts: Map<string, string>; infoSaved: boolean; dirty: boolean; verify?: boolean; removed?: boolean; partRemoved?: boolean }
type Permit = { key: string; epoch: number; version: string; assistant: string; status: string; controlID?: string }
type Replay = { originalID: string; version: string; content: string; meta: string; triggerID: string; summaryID?: string; mediaStripped: boolean }
type State = { id: string; epoch: number; active: boolean; stopped: boolean; failed: boolean; running: Set<string>; runningOverflow?: boolean; summaryHint?: string; replay?: Replay;
  compaction?: { awaitingTransform: boolean; coverage: Map<string, string>; summaryID?: string; hint?: boolean }; terminal?: Message["info"];
  guides: Map<string, Guide>; snapshots: Map<string, Map<string, string>>; calls: Map<string, string>;
  native: Set<string>; fallback: boolean; revision: number; query?: Promise<Message[]>;
  timer?: ReturnType<typeof setTimeout>; permit?: Permit; attempts: Permit[]; diagnostics: string[]; toastAt: number }
const start = "<system-reminder>\nThe user sent the following message:\n"
const end = "\n\nPlease address this message and continue with your tasks.\n</system-reminder>"
const unwrap = (text: string) => text.startsWith(start) && text.endsWith(end) ? text.slice(start.length, -end.length) : text
const effective = (parts: Part[]) => parts.filter(p => !p.ignored && !p.synthetic &&
  (p.type === "text" && typeof p.text === "string" && !!unwrap(p.text).trim() || p.type === "file" && !!p.url))
const stable = (value: unknown) => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)
const hash = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex")
const partVersion = (p: Part) => !effective([p]).length ? undefined : hash(p.type === "text"
  ? { type: p.type, text: unwrap(String(p.text)) }
  : { type: p.type, url: p.url, mime: p.mime, filename: p.filename, source: p.source })
const versions = (parts: Part[]) => new Map(parts.flatMap((p, i) => {
  const version = partVersion(p)
  return version ? [[p.id ?? String(i), version] as [string, string]] : []
}))
const contentVersion = (parts: Map<string, string>) => hash([...parts].sort(([a], [b]) => a.localeCompare(b)))
const signature = (parts: Part[]) => contentVersion(versions(parts))
// Compare the exact native replay payload without its newly allocated IDs.
// The pinned overflow path replaces image/PDF files with these text placeholders.
const replayContent = (parts: Part[], convert = false) => hash(parts.filter(p => p.type !== "compaction").map(p => {
  if (convert && p.type === "file" && typeof p.mime === "string" && (p.mime.startsWith("image/") || p.mime === "application/pdf"))
    return { type: "text", text: `[Attached ${p.mime}: ${p.filename ?? "file"}]` }
  const { id, sessionID, messageID, time, ...content } = p
  if (typeof content.text === "string") content.text = unwrap(content.text)
  return content
}))
const replayMeta = (info: Message["info"]) => hash(Object.fromEntries(
  ["agent", "model", "system", "variant", "format", "tools"].map(key => [key, info[key]])))
const reminder = "[Steering reminder] Latest user guidance takes priority. Preserve completed results. Skip obsolete actions and report which actions were skipped and why. Re-read the original guidance before further tools."
const marker = "codeagentSteering"

export class SteeringState {
  private sessions = new Map<string, State>()
  private suppressions = new Set<string>()
  private input: PluginInput
  private options: PluginOptions
  constructor(input: PluginInput, options: PluginOptions) { this.input = input; this.options = options }
  private state(id: string) {
    let s = this.sessions.get(id)
    if (s) return s
    if (this.sessions.size >= 128) {
      const old = [...this.sessions.values()].find(v => !v.active && !v.permit && !v.running.size && !v.runningOverflow && !v.guides.size)
      if (!old) throw new Error("STEERING_CAPACITY: 128 sessions retain pending evidence; restart or finish them")
      this.sessions.delete(old.id)
    }
    s = { id, epoch: 0, active: false, stopped: false, failed: false, running: new Set(), guides: new Map(), snapshots: new Map(),
      calls: new Map(), native: new Set(), fallback: false, revision: 0, attempts: [], diagnostics: [], toastAt: 0 }
    this.sessions.set(id, s)
    return s
  }
  private diagnostic(s: State, text: string) { s.diagnostics.push(text); if (s.diagnostics.length > 32) s.diagnostics.shift() }
  private invalidate(s: State, stop = false) {
    s.epoch++; s.revision++
    clearTimeout(s.timer); s.timer = undefined
    if (s.permit) { s.permit.status = "suppressed"; s.permit = undefined }
    if (stop) { s.replay = undefined; s.stopped = true; for (const g of s.guides.values()) g.eligible = false }
  }
  private toast(s: State, message: string) {
    if (Date.now() - s.toastAt < 500) return
    s.toastAt = Date.now()
    void this.input.client.tui.showToast({ body: { title: "Steering", message, variant: "info", duration: 2500 }, signal: AbortSignal.timeout(1500) }).catch(() => undefined)
  }
  private ordered(s: State) { return [...s.guides.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) }
  private pending(s: State) { return this.ordered(s).filter(g => g.eligible && !g.empty && g.saved && !g.dirty && g.saved !== g.prepared && g.saved !== g.compacted) }
  private version(s: State) { return stable(this.pending(s).map(g => [g.id, g.saved])) }
  private params(s: State) { return { path: { id: s.id }, query: { directory: this.input.directory }, signal: AbortSignal.timeout(1500) } }
  private update(s: State, message: Message) {
    if (message.info.role === "assistant") {
      for (const p of message.parts) this.map(s, p, message.info.id)
      return
    }
    const g = s.guides.get(message.info.id)
    if (!g) return // Never enlist historical inputs on restart.
    g.info = message.info; g.infoSaved = true
    g.parts = versions(message.parts)
    const actual = signature(message.parts)
    if (!effective(message.parts).length) {
      if (g.saved) {
        g.expected = actual; g.saved = actual; g.empty = true; g.dirty = false; g.verify = false
        return
      }
      if (g.removed || g.partRemoved) s.guides.delete(g.id)
      else { g.dirty = true; this.diagnostic(s, "guidance save unknown: info without expected parts; inspect native save or explicitly remove input") }
      return
    }
    // Full SDK calibration is authoritative for edits and removals.
    if (!g.saved && actual !== g.expected) { g.dirty = true; return }
    g.expected = actual; g.saved = actual; g.empty = false; g.dirty = false; g.verify = false; g.removed = false; g.partRemoved = false
  }
  private async history(s: State) {
    if (s.query) return s.query
    const revision = s.revision
    const query = (async () => {
      const result = await this.input.client.session.messages(this.params(s))
      if (result.error || !Array.isArray(result.data)) throw new Error("STEERING_EVIDENCE_UNKNOWN: public history unavailable")
      const messages = result.data as unknown as Message[]
      // Avoid overwriting newer synchronous input/part observations with an older read.
      if (s.revision === revision) {
        for (const m of messages) this.update(s, m)
        const ids = new Set(messages.map(m => m.info.id))
        for (const g of s.guides.values()) if (!ids.has(g.id)) {
          if (g.removed) s.guides.delete(g.id)
          else { g.dirty = true; this.diagnostic(s, "guidance save unknown: native history missing; retain candidate for late save, inspect or explicitly remove input") }
        }
      } else this.diagnostic(s, "history changed during query; retain pending evidence")
      return messages
    })()
    s.query = query
    try { return await query } finally { if (s.query === query) s.query = undefined }
  }
  private map(s: State, p: Part, owner?: string) {
    if (p.type !== "tool") return
    const id = owner ?? String(p.messageID ?? "")
    if (!id) return
    const status = (p.state as { status?: string } | undefined)?.status
    if (p.id && (status === "running" || status === "pending")) {
      if (s.running.size < 1024 || s.running.has(p.id)) s.running.add(p.id)
      else { s.runningOverflow = true; this.diagnostic(s, "running-part capacity exceeded; retain state until restart/delete") }
    }
    else if (p.id && status) s.running.delete(p.id)
    if (typeof p.callID === "string") s.calls.set(p.callID, id)
    if (p.tool === "task" && p.id && p.id !== p.callID) s.native.add(p.id)
    // Dropping a mapping only causes conservative fallback, never admission.
    if (s.calls.size > 1024) s.calls.delete(s.calls.keys().next().value!)
    if (s.native.size > 1024) s.native.delete(s.native.values().next().value!)
  }
  async observe(id: string, output: { message: Message["info"]; parts: Part[] }) {
    const s = this.state(id)
    const control = output.parts.find(p => p.synthetic && (p.metadata as Record<string, unknown> | undefined)?.[marker])
    if (control) {
      const key = (control.metadata as Record<string, { recoveryKey?: string }>)[marker]?.recoveryKey
      return this.control(s, key, output.message.id)
    }
    if (!effective(output.parts).length) return
    this.invalidate(s)
    s.stopped = false; s.failed = false; s.replay = undefined
    if (s.guides.size >= 256 && !s.guides.has(output.message.id)) {
      this.diagnostic(s, "capacity: 256 pending/unknown inputs; inspect native saves or remove unresolved inputs")
      throw new Error("STEERING_CAPACITY: 256 pending/unknown inputs; inspect native saves or remove unresolved inputs")
    }
    const expected = signature(output.parts)
    s.guides.set(output.message.id, { id: output.message.id, expected, eligible: s.active, steering: s.active,
      info: structuredClone(output.message), parts: new Map(), infoSaved: false, dirty: true })
    if (s.active) this.toast(s, "Guidance observed; awaiting save and next request")
  }
  async prepare(output: { messages: Message[] }) {
    const ids = new Set(output.messages.map(m => m.info.sessionID))
    if (ids.size !== 1) return
    const s = this.state([...ids][0])
    if (s.compaction?.awaitingTransform) {
      const compaction = s.compaction
      compaction.awaitingTransform = false
      let history: Message[] = []
      try { history = await this.history(s) } catch { this.diagnostic(s, "compaction replay association unavailable") }
      if (s.compaction !== compaction) return
      const included = new Set(output.messages.map(m => m.info.id))
      for (const m of output.messages) {
        this.update(s, m)
        const g = s.guides.get(m.info.id)
        if (g?.saved && !g.dirty && !g.empty && g.saved === signature(m.parts)) compaction.coverage.set(g.id, g.saved)
      }
      for (const g of s.guides.values()) if (g.saved && !g.dirty && !g.empty && g.compacted === g.saved &&
        g.summaryID && included.has(g.summaryID)) compaction.coverage.set(g.id, g.saved)
      const trigger = history.at(-1)
      if (trigger?.info.role === "user" && trigger.parts.some(p => p.type === "compaction" && p.auto === true && p.overflow === true)) {
        const original = history.slice(0, -1).reverse().find(m => m.info.role === "user" && !m.parts.some(p => p.type === "compaction"))
        const g = original && s.guides.get(original.info.id)
        if (original && g?.saved && !g.dirty && !g.empty && !included.has(g.id) && g.saved === signature(original.parts))
          s.replay = { originalID: g.id, version: g.saved, content: replayContent(original.parts, true), meta: replayMeta(original.info), triggerID: trigger.info.id,
            mediaStripped: original.parts.some(p => p.type === "file" && typeof p.mime === "string" && (p.mime.startsWith("image/") || p.mime === "application/pdf")) }
      }
      compaction.hint = !!(s.summaryHint && included.has(s.summaryHint)) || [...s.guides.values()].some(g => g.steering && !g.empty)
      if (compaction.hint) this.remind(output.messages)
      return
    }
    const epoch = s.epoch
    let history: Message[]
    try { history = await this.history(s) } catch { s.replay = undefined; this.diagnostic(s, "request association unavailable"); return }
    if (s.epoch !== epoch) return
    const parent = [...output.messages].reverse().find(m => m.info.role === "user")?.info.id
    const idsInRequest = new Set(output.messages.map(m => m.info.id))
    const candidates = history.filter(m => m.info.role === "assistant" && m.info.parentID === parent && !m.info.summary
      && !m.info.error && !m.info.finish && !m.info.time?.completed && !idsInRequest.has(m.info.id))
    const replay = s.replay
    s.replay = undefined // The first real request consumes the bounded replay window, even if association fails.
    if (candidates.length !== 1) { this.diagnostic(s, "current assistant is not unique"); return }
    const snapshot = new Map<string, string>()
    let guided: Message | undefined
    for (const m of output.messages) {
      const g = s.guides.get(m.info.id)
      if (!g || g.empty || g.dirty || g.saved !== signature(m.parts)) continue
      snapshot.set(g.id, g.saved)
      if (g.steering) guided = m
      g.prepared = g.saved
    }
    // Already completed guidance does not need replay after native compaction.
    for (const g of s.guides.values()) if (g.saved && !g.empty && !g.dirty && (g.saved === g.prepared ||
      g.saved === g.compacted && !!g.summaryID && idsInRequest.has(g.summaryID))) snapshot.set(g.id, g.saved)
    if (replay?.summaryID && idsInRequest.has(replay.summaryID)) {
      const g = s.guides.get(replay.originalID)
      const index = history.findIndex(m => m.info.id === replay.summaryID)
      const matches = output.messages.filter(m => m.info.role === "user" && !s.guides.has(m.info.id) &&
        m.info.id > replay.summaryID! && m.info.id > replay.triggerID && history[index + 1]?.info.id === m.info.id &&
        replayMeta(m.info) === replay.meta && replayContent(m.parts) === replay.content &&
        replayMeta(history[index + 1].info) === replay.meta && replayContent(history[index + 1].parts) === replay.content)
      if (g?.saved === replay.version && !g.dirty && !g.empty && matches.length === 1) {
        snapshot.set(g.id, g.saved); g.prepared = g.saved; g.replayedAs = matches[0].info.id; g.mediaStripped = replay.mediaStripped
        if (g.steering) guided = matches[0]
      } else this.diagnostic(s, "native replay incomplete or ambiguous; original guidance remains pending")
    }
    if (guided || s.summaryHint && idsInRequest.has(s.summaryHint) || [...s.guides.values()].some(g => g.steering && snapshot.get(g.id) === g.saved)) this.remind(output.messages)
    s.snapshots.set(candidates[0].info.id, snapshot)
    if (s.snapshots.size > 128) s.snapshots.delete(s.snapshots.keys().next().value!)
    s.fallback = false; s.active = true
    if (s.permit && this.version(s) !== s.permit.version) this.invalidate(s)
  }
  async gate(input: { tool: string; sessionID: string; callID: string }) {
    if (input.tool === "steering_status") return
    const s = this.state(input.sessionID)
    if (!s.guides.size) return
    let query = s.query
    if (!query && (!s.calls.has(input.callID) || [...s.guides.values()].some(g => g.dirty)) && !s.fallback) {
      s.fallback = true
      query = this.history(s)
    }
    // The fallback flag limits queries, not waiters. An ordinary task cannot
    // use the native exception while another gate is still resolving ownership.
    if (query) try { await query } catch { this.diagnostic(s, "gate history unavailable") }
    if (input.tool === "task" && (s.native.has(input.callID) || !s.calls.has(input.callID))) {
      this.diagnostic(s, "native or unknown task exempt to avoid uncaught native hook failure"); return
    }
    const snapshot = s.snapshots.get(s.calls.get(input.callID) ?? "")
    const stale = this.ordered(s).filter(g => (!g.empty || g.dirty) && (!g.saved || g.dirty || snapshot?.get(g.id) !== g.saved))
    if (!stale.length) return
    this.toast(s, "Skipped an obsolete tool; latest guidance will be used next")
    this.diagnostic(s, `blocked ${input.tool} ${input.callID}`)
    throw new Error(`STEERING_STALE_CONTEXT: request did not prepare latest guidance (${stale.map(g => g.id).join(", ")}). ${reminder}`)
  }
  compact(id: string) {
    const s = this.state(id)
    this.invalidate(s, true)
    s.replay = undefined
    s.compaction = { awaitingTransform: true, coverage: new Map() }
    s.calls.clear(); s.native.clear()
  }
  private compacted(s: State) {
    const c = s.compaction
    if (c && !c.awaitingTransform && c.summaryID) for (const [id, version] of c.coverage) {
      const g = s.guides.get(id)
      if (g?.saved === version && !g.dirty) { g.compacted = version; g.summaryID = c.summaryID }
    }
    s.summaryHint = c?.hint ? c.summaryID : undefined
    if (s.replay && c?.summaryID) s.replay.summaryID = c.summaryID
    else s.replay = undefined
    s.compaction = undefined
  }
  private remind(messages: Message[]) {
    const message = [...messages].reverse().find(m => m.info.role === "user") ?? messages.at(-1)
    if (!message) return
    message.parts.push({ id: `prt_steering_${randomUUID().replaceAll("-", "")}`, sessionID: message.info.sessionID,
      messageID: message.info.id, type: "text", synthetic: true, text: reminder })
  }
  private prune(s: State) {
    // A successful idle boundary has no old running assistant gates left.
    // Keep unknown/pending inputs, and latest metadata if recovery still needs it.
    if (s.running.size || s.runningOverflow) return
    if (!s.active && s.failed && !s.permit) {
      s.guides.clear(); s.snapshots.clear(); s.compaction = undefined; s.replay = undefined; s.summaryHint = undefined
      return
    }
    const terminal = s.terminal
    if (s.active || s.permit || s.compaction || !terminal?.time?.completed || terminal.error ||
      !terminal.finish || ["tool-calls", "unknown", "error"].includes(terminal.finish) && !terminal.structured) return
    const unsettled = [...s.guides.values()].some(g => !g.empty && (!g.saved || g.dirty || g.saved !== g.prepared && g.saved !== g.compacted))
    const latest = unsettled ? this.ordered(s).filter(g => g.saved && !g.dirty).at(-1)?.id : undefined
    for (const g of s.guides.values()) if (g.id !== latest && g.saved && !g.dirty &&
      (g.empty || g.saved === g.prepared || g.saved === g.compacted)) s.guides.delete(g.id)
    s.snapshots.clear()
  }
  private schedule(s: State) {
    if (this.options.autoResume === false || s.active || s.stopped || s.timer || s.permit || !this.pending(s).length) return
    s.timer = setTimeout(() => {
      s.timer = undefined
      void this.resume(s).catch(() => this.diagnostic(s, "recovery failed; retry manually"))
    }, 75)
    s.timer.unref?.()
  }
  private valid(s: State, p: Permit) { return s.permit === p && s.epoch === p.epoch && !s.stopped && this.version(s) === p.version }
  private async resume(s: State) {
    const epoch = s.epoch
    const messages = await this.history(s)
    if (epoch !== s.epoch || s.stopped || s.active || !this.pending(s).length) return
    const latest = [...messages].reverse().find(m => m.info.role === "assistant" && !m.info.summary)
    if (!latest || latest.info.error || !latest.info.time?.completed || !latest.info.finish ||
      ["tool-calls", "unknown", "error"].includes(latest.info.finish) && !latest.info.structured) return
    const version = this.version(s)
    if (s.attempts.some(p => p.version === version)) return
    const unattempted = this.pending(s).filter(g => g.attempted !== g.saved)
    if (!unattempted.length) return
    const g = this.ordered(s).filter(g => g.saved && !g.dirty).at(-1)!
    const info = g.info
    if (typeof info.agent !== "string" || !info.model || typeof info.model !== "object" ||
      typeof (info.model as { providerID?: unknown }).providerID !== "string" ||
      typeof (info.model as { modelID?: unknown }).modelID !== "string" ||
      info.system !== undefined && typeof info.system !== "string" || info.variant !== undefined && typeof info.variant !== "string" ||
      info.format !== undefined && (!info.format || typeof info.format !== "object")) {
      this.diagnostic(s, "cannot safely inherit guidance request fields"); return
    }
    const p: Permit = { key: randomUUID(), epoch, version, assistant: latest.info.id, status: "reserved" }
    s.permit = p; s.attempts.push(p)
    for (const guide of unattempted) guide.attempted = guide.saved
    if (s.attempts.length > 256) { s.stopped = true; this.diagnostic(s, "recovery attempt capacity reached"); return }
    try {
      const status = await this.input.client.session.status({ query: { directory: this.input.directory }, signal: AbortSignal.timeout(1500) })
      if (!this.valid(s, p)) return
      const session = await this.input.client.session.get(this.params(s))
      if (!this.valid(s, p)) return
      if (status.error || !status.data || status.data[s.id]?.type && status.data[s.id].type !== "idle" || session.error || !session.data || session.data.revert) {
        this.invalidate(s, true); this.diagnostic(s, "recovery suppressed by status/revert check"); return
      }
      // Local narrow adaptation: SDK v1 omits synthetic/metadata/variant/format,
      // all accepted by the pinned public runtime prompt schema.
      const body = { agent: info.agent, model: structuredClone(info.model),
        ...(info.system !== undefined ? { system: info.system } : {}),
        ...(info.variant !== undefined ? { variant: info.variant } : {}),
        ...(info.format !== undefined ? { format: structuredClone(info.format) } : {}),
        parts: [{ type: "text", synthetic: true, text: "[Steering continuation] Re-read original saved guidance " + this.pending(s).map(g => g.id).join(", ") + ". " + reminder,
          metadata: { [marker]: { plugin: "@oneshot/opencode-steering", kind: "continuation", recoveryKey: p.key } } }] }
      p.status = "dispatch-unknown"
      const result = await this.input.client.session.promptAsync({ ...this.params(s), body: body as NonNullable<Parameters<PluginInput["client"]["session"]["promptAsync"]>[0]>["body"] })
      if (result.error) throw new Error("prompt_async failed")
      // 204 acknowledges dispatch only. chat.message confirms the control permit.
      if (this.valid(s, p) && !p.controlID) this.diagnostic(s, "dispatch acknowledged; control save unknown")
      const timer = setTimeout(() => { if (s.permit === p) s.permit = undefined }, 5000); timer.unref?.()
    } catch { if (p.status !== "suppressed") p.status = "dispatch-unknown"; this.diagnostic(s, "recovery outcome unknown; retry manually") }
  }
  private async control(s: State, key: unknown, id: string) {
    const p = s.permit
    let valid = !!p && p.key === key && this.valid(s, p)
    if (valid) {
      try {
        const session = await this.input.client.session.get(this.params(s))
        valid = !session.error && !!session.data && !session.data.revert && this.valid(s, p!)
        const status = await this.input.client.session.status({ query: { directory: this.input.directory }, signal: AbortSignal.timeout(1500) })
        valid = valid && !status.error && !!status.data && (!status.data[s.id] || status.data[s.id].type === "idle") && this.valid(s, p!)
      } catch { valid = false }
    }
    if (!valid) {
      if (p && p.key === key) { p.status = "suppressed"; s.permit = undefined }
      const token = randomUUID(); this.suppressions.add(token)
      const timer = setTimeout(() => this.suppressions.delete(token), 30000); timer.unref?.()
      throw new Error(`STEERING_RECOVERY_SUPPRESSED (${token})`)
    }
    p!.controlID = id; p!.status = "control-accepted"
    this.toast(s, "Continuing with saved guidance")
  }
  status(id: string) {
    const s = this.sessions.get(id)
    if (!s) return { sessionID: id, evidence: "no observations in this process", provider: "unknown", adopted: "unknown" }
    return { sessionID: id, active: s.active, stopped: s.stopped, provider: "unknown", adopted: "unknown",
      messages: this.ordered(s).map(g => ({ messageID: g.id, saved: !!g.saved && !g.dirty, prepared: !!g.saved && g.prepared === g.saved, eligible: g.eligible, empty: !!g.empty && !g.dirty, replayedAs: g.replayedAs, mediaStripped: g.mediaStripped, compacted: !!g.saved && g.compacted === g.saved && !g.dirty })),
      recovery: structuredClone(s.attempts), diagnostics: [...s.diagnostics] }
  }
  async event(event: { type: string; properties?: unknown }) {
    // Everything before returning is synchronous: cancellation invalidates any
    // continuation currently waiting on SDK I/O. Streaming deltas never query history.
    try {
      const p = event.properties as { sessionID?: string; messageID?: string; partID?: string; info?: Message["info"] & { revert?: unknown };
        part?: Part & { sessionID?: string; messageID?: string }; status?: { type: string }; error?: { data?: { message?: string } } }
      const id = p?.sessionID ?? p?.part?.sessionID ?? p?.info?.sessionID ?? (event.type.startsWith("session.") ? p?.info?.id : undefined)
      if (!id) return
      const s = this.state(id)
      if (event.type === "session.error") {
        const token = [...this.suppressions].find(t => p.error?.data?.message?.includes(t))
        if (token) { this.suppressions.delete(token); return }
      }
      if (event.type === "session.deleted" || event.type === "session.error" || p.info?.error || event.type === "session.updated" && p.info?.revert) this.invalidate(s, true)
      if (event.type === "session.error" || p.info?.error) { s.compaction = undefined; s.replay = undefined; s.failed = true }
      if (event.type === "session.deleted") { s.guides.clear(); s.snapshots.clear(); s.calls.clear(); s.native.clear(); s.running.clear(); s.replay = undefined; return }
      if (event.type === "session.compacted") this.compacted(s)
      if (event.type === "session.status" && ["busy", "retry"].includes(p.status?.type ?? "")) s.active = true
      if (event.type === "session.idle" || event.type === "session.status" && p.status?.type === "idle") {
        s.active = false; s.calls.clear(); s.native.clear(); this.prune(s); this.schedule(s)
      }
      if (event.type === "message.updated" && p.info) {
        if (p.info.role === "assistant") {
          s.terminal = p.info
          if (!p.info.summary && !p.info.error && p.info.time?.completed && p.info.finish && !["error", "unknown", "tool-calls"].includes(p.info.finish)) s.failed = false
          if (p.info.summary && s.compaction && !s.compaction.awaitingTransform) s.compaction.summaryID = p.info.id
        }
        if (p.info.role === "assistant" && s.permit && !s.permit.controlID && p.info.id !== s.permit.assistant) this.invalidate(s)
        const g = s.guides.get(p.info.id)
        if (g) { g.info = p.info; g.infoSaved = true; this.confirm(s, g) }
      }
      if (event.type === "message.part.updated" && p.part) {
        this.map(s, p.part)
        const g = s.guides.get(p.part.messageID ?? "")
        if (g && p.part.id) { const version = partVersion(p.part); if (version) g.parts.set(p.part.id, version); else g.parts.delete(p.part.id); s.revision++; this.confirm(s, g) }
      }
      if (event.type === "message.removed" || event.type === "message.part.removed") {
        this.invalidate(s, true)
        const g = s.guides.get(p.messageID ?? "")
        if (g && event.type === "message.removed") { g.removed = true; g.dirty = true; g.verify = true }
        else if (g) {
          g.partRemoved = true; g.parts.delete(p.partID ?? ""); g.expected = contentVersion(g.parts); g.dirty = true; g.verify = true
        }
        s.fallback = false
      }
    } catch { /* Fire-and-forget kernel event hooks must never reject. */ }
  }
  private confirm(s: State, g: Guide) {
    if (!g.infoSaved || g.verify) return
    const actual = contentVersion(g.parts)
    if (actual === g.expected) { g.saved = actual; g.dirty = false; this.schedule(s) }
    else if (g.saved) {
      // A part update can be a delayed event for an earlier edit. Only a
      // current public SDK read can establish an edited saved content version.
      this.invalidate(s); g.dirty = true; g.verify = true; s.fallback = false
    }
  }
}
