import type { PluginInput, PluginOptions } from "@opencode-ai/plugin"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

// Structural public SDK records also accept fields added since SDK v1's schema.
type Part = { id?: string; type: string; [key: string]: unknown }
type Message = {
  info: { id: string; sessionID: string; role: string; parentID?: string; summary?: unknown;
    time?: { created?: number; completed?: number }; finish?: string; error?: { name?: string }; [key: string]: unknown }
  parts: Part[]
}
type Prepared = { assistantID: string; snapshotSequence: number; preparedAt: number; sourceFingerprint: string; contextFingerprint: string }
type Entry = {
  messageID: string; observationReason: "explicit" | "active" | "ordinary" | "unknown"; observedAt: number
  observationSequence: number; kernelCreated?: number; order?: number; expectedFingerprint?: string; fingerprint?: string
  saved: "confirmed" | "unknown"; prepared: Prepared[]; historicalBaseline: boolean; baselineReason?: string; compacted?: boolean
  provider: { status: "unknown"; source: string }; adopted: { status: "unknown"; source: string }
  pendingReason: string | null; lastError?: string
}
type Snapshot = { assistantID: string; sequence: number; preparedAt: number; users: Array<{ messageID: string; sourceFingerprint: string; contextFingerprint: string }>; coverage: Record<string, string> }
type RecoveryAttempt = { key: string; assistantID: string; pending: Array<{ messageID: string; fingerprint: string }>; attemptedAt: number; status: "attempted" | "dispatched" | "suppressed" | "dispatch-unknown"; controlMessageID?: string }
type Dispatch = { key: string; epoch: number; assistantID: string }
type State = {
  schemaVersion: 1; sessionID: string; namespace: string; lifecycle: "active" | "idle" | "cancelled" | "failed" | "deleted" | "unknown"
  evidence: "available" | "unavailable"; stateFile: string; initialized: boolean; sequence: number
  ordering: { source: "session.messages-return-order"; status: "observed" | "ambiguous" }
  messages: Entry[]; snapshots: Snapshot[]; diagnostics: Array<{ code: string; observedAt: number; assistantID?: string; callID?: string; messageIDs?: string[] }>
  recovery: { enabled: boolean; attempts: RecoveryAttempt[] }
  limitations: string[]; lastReconciledAt?: number
}
const prefix = /^steer:/i
const wrapperStart = "<system-reminder>\nThe user sent the following message:\n"
const wrapperEnd = "\n\nPlease address this message and continue with your tasks.\n</system-reminder>"
const hash = (value: string) => createHash("sha256").update(value).digest("hex")
const stable = (value: unknown): string => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const effective = (parts: Part[]) => parts.filter(part => !part.ignored && !part.synthetic && (
  part.type === "text" && typeof part.text === "string" && !!part.text.replace(prefix, "").trim()
  || part.type === "file" && typeof part.url === "string" && !!part.url))
const canonical = (parts: Part[], unwrap = false, identity = true) => effective(parts).map(part => {
  let text = part.text
  // The pinned kernel wraps later-turn user text before this public hook. Only
  // remove its exact envelope for source comparison; retain the actual hash too.
  if (unwrap && typeof text === "string" && text.startsWith(wrapperStart) && text.endsWith(wrapperEnd)) text = text.slice(wrapperStart.length, -wrapperEnd.length)
  return part.type === "text"
    ? { ...(identity ? { id: part.id } : {}), type: part.type, text }
    : { ...(identity ? { id: part.id } : {}), type: part.type, url: part.url, mime: part.mime, filename: part.filename, source: part.source }
})
const fingerprint = (parts: Part[], unwrap = false, identity = true) => hash(stable(canonical(parts, unwrap, identity)))
const unavailable = (reason: string) => new Error(`STEERING_EVIDENCE_UNAVAILABLE: ${reason}. Inspect steering_status before starting another action.`)

export class SteeringLedger {
  private readonly namespace: string
  private readonly directory: string
  private readonly stateDirectory: string
  private readonly sessions = new Map<string, Promise<State>>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly compactingSessions = new Set<string>()
  private readonly deleted = new Set<string>()
  private readonly storageErrors = new Set<string>()
  private readonly readErrors = new Set<string>()
  private readonly autoResume: boolean
  private readonly activeSessions = new Set<string>()
  private readonly eligible = new Map<string, Map<string, string>>()
  private readonly epochs = new Map<string, number>()
  private readonly terminalEpochs = new Map<string, number>()
  private readonly suppressionTokens = new Map<string, Set<string>>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly dispatches = new Map<string, Dispatch>()
  private readonly input: PluginInput
  constructor(input: PluginInput, options: PluginOptions) {
    this.input = input
    this.autoResume = options.autoResume !== false
    this.directory = input.directory
    this.namespace = hash(stable({ directory: path.resolve(input.directory), project: input.project?.id ?? "unknown" }))
    this.stateDirectory = typeof options.stateDirectory === "string" ? path.resolve(options.stateDirectory)
      : path.join(process.env.XDG_STATE_HOME || path.join(homedir(), ".local", "state"), "codeagent-steering")
  }
  private file(sessionID: string) { return path.join(this.stateDirectory, this.namespace, `${hash(sessionID)}.json`) }
  private fresh(sessionID: string): State {
    return { schemaVersion: 1, sessionID, namespace: this.namespace, lifecycle: this.deleted.has(sessionID) ? "deleted" : "unknown", evidence: "available", stateFile: this.file(sessionID), initialized: false, sequence: 0,
      ordering: { source: "session.messages-return-order", status: "observed" }, messages: [], snapshots: [], diagnostics: [], recovery: { enabled: this.autoResume, attempts: [] },
      limitations: ["Prepared context does not confirm provider receipt or semantic adoption.", "The public tool checkpoint cannot retract tools that already passed, batch-internal subtools, or StructuredOutput.", "Automatic recovery adds an identifiable synthetic control record, never a duplicate of user guidance.", "Recovery is bounded per observed guidance fingerprint and does not resume old pending on process restart.", "No atomic cancel/expected-turn transaction, abort/replay, or exactly-once guarantee."] }
  }
  private async load(sessionID: string) {
    let pending = this.sessions.get(sessionID)
    if (!pending) {
      pending = (async () => {
        const fresh = this.fresh(sessionID)
        if (this.deleted.has(sessionID)) return fresh
        try {
          const parsed = JSON.parse(await readFile(fresh.stateFile, "utf8")) as State
          if (parsed.schemaVersion !== 1 || parsed.sessionID !== sessionID || parsed.namespace !== this.namespace || !Array.isArray(parsed.messages) || !Array.isArray(parsed.snapshots)
            || !Array.isArray(parsed.diagnostics) || !Number.isInteger(parsed.sequence)
            || parsed.messages.some(item => typeof item.messageID !== "string" || !Array.isArray(item.prepared))
            || parsed.snapshots.some(item => typeof item.assistantID !== "string" || !Array.isArray(item.users) || !item.coverage)) throw new Error("Invalid ledger")
          parsed.stateFile = fresh.stateFile
          parsed.recovery ??= { enabled: this.autoResume, attempts: [] }
          if (!Array.isArray(parsed.recovery.attempts)) throw new Error("Invalid recovery evidence")
          parsed.recovery.enabled = this.autoResume
          parsed.limitations = fresh.limitations
          // A restart cannot establish that an old active request still runs.
          // Terminal reasons remain useful evidence until a new busy event.
          if (parsed.lifecycle === "active") parsed.lifecycle = "unknown"
          return parsed
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            this.storageErrors.add(sessionID)
            this.diagnostic(fresh, "state-read-failed")
          }
          return fresh
        }
      })()
      this.sessions.set(sessionID, pending)
    }
    return pending
  }
  private async serial<T>(sessionID: string, fn: (state: State) => Promise<T>): Promise<T> {
    const previous = this.queues.get(sessionID) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(async () => fn(await this.load(sessionID)))
    this.queues.set(sessionID, next)
    try { return await next } finally { if (this.queues.get(sessionID) === next) this.queues.delete(sessionID) }
  }
  private diagnostic(state: State, code: string, extra: { assistantID?: string; callID?: string; messageIDs?: string[] } = {}) {
    state.diagnostics.push({ code, observedAt: Date.now(), ...extra })
    if (state.diagnostics.length > 100) state.diagnostics.splice(0, state.diagnostics.length - 100)
  }
  private refresh(state: State) {
    state.evidence = this.storageErrors.has(state.sessionID) || this.readErrors.has(state.sessionID) ? "unavailable" : "available"
    for (const entry of state.messages) {
      const covered = entry.prepared.some(prepared => prepared.sourceFingerprint === entry.fingerprint)
      entry.pendingReason = state.evidence === "unavailable" ? "evidence-unavailable" : entry.saved !== "confirmed" ? "awaiting-save"
        : covered ? null : entry.historicalBaseline ? "historical-coverage-unknown" : state.lifecycle === "cancelled" ? "pending-cancelled" : state.lifecycle === "failed" ? "pending-failed"
        : state.lifecycle === "idle" ? "pending-ended" : entry.compacted ? "pending-compacted" : "awaiting-normal-request"
    }
  }
  private async persist(state: State) {
    this.refresh(state)
    if (this.deleted.has(state.sessionID) || this.storageErrors.has(state.sessionID)) return
    const temporary = `${state.stateFile}.${randomUUID()}.tmp`
    try {
      await mkdir(path.dirname(state.stateFile), { recursive: true, mode: 0o700 })
      await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 })
      await rename(temporary, state.stateFile)
    } catch {
      this.storageErrors.add(state.sessionID)
      this.diagnostic(state, "state-write-failed")
      this.refresh(state)
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }
  private entry(state: State, messageID: string): Entry {
    let entry = state.messages.find(item => item.messageID === messageID)
    if (!entry) {
      entry = { messageID, observationReason: "unknown", observedAt: Date.now(), observationSequence: ++state.sequence, saved: "unknown", prepared: [], historicalBaseline: false,
        provider: { status: "unknown", source: "public-hooks-cannot-confirm-transport" }, adopted: { status: "unknown", source: "no-semantic-evidence" }, pendingReason: "awaiting-save" }
      state.messages.push(entry)
    }
    return entry
  }
  private async reconcile(state: State): Promise<Message[]> {
    if (this.deleted.has(state.sessionID)) return []
    try {
      const result = await this.input.client.session.messages({ path: { id: state.sessionID }, query: { directory: this.directory }, signal: AbortSignal.timeout(1500) })
      if (result.error || !Array.isArray(result.data)) throw new Error("Unreadable public messages")
      const messages = result.data as unknown as Message[]
      if (messages.some(message => message.info.sessionID !== state.sessionID || !Array.isArray(message.parts))) throw new Error("Invalid public messages")
      this.readErrors.delete(state.sessionID)
      const first = !state.initialized
      const users = messages.filter(message => message.info.role === "user" && effective(message.parts).length)
      const seen = new Set<string>()
      let previous: Message | undefined
      for (const [order, message] of users.entries()) {
        const existing = state.messages.some(entry => entry.messageID === message.info.id)
        const entry = this.entry(state, message.info.id)
        seen.add(entry.messageID)
        const actual = fingerprint(message.parts)
        entry.order = order
        entry.kernelCreated = message.info.time?.created
        entry.fingerprint = actual
        entry.saved = !entry.expectedFingerprint || actual === entry.expectedFingerprint ? "confirmed" : "unknown"
        entry.lastError = entry.saved === "unknown" ? "saved-parts-do-not-match-observation" : undefined
        if (first && !existing) {
          // On first attachment, completed earlier history is a baseline, never
          // evidence that the provider saw it or that its request was obeyed.
          entry.historicalBaseline = messages.some(item => item.info.role === "assistant" && !item.info.summary && !item.info.error && !!item.info.time?.completed
            && !!item.info.parentID && item.info.parentID >= message.info.id && (item.info.time.created ?? 0) >= (message.info.time?.created ?? Infinity))
          if (entry.historicalBaseline) entry.baselineReason = "completed-history-consumption-unknown"
        }
        if (previous && (previous.info.id >= message.info.id || (previous.info.time?.created ?? 0) > (message.info.time?.created ?? Infinity))) state.ordering.status = "ambiguous"
        previous = message
      }
      for (const entry of state.messages) if (!seen.has(entry.messageID)) { entry.saved = "unknown"; entry.lastError = "message-or-effective-parts-unavailable" }
      state.messages.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.observationSequence - b.observationSequence)
      state.initialized = true
      state.lastReconciledAt = Date.now()
      this.refresh(state)
      return messages
    } catch {
      this.readErrors.add(state.sessionID)
      this.diagnostic(state, "messages-query-failed")
      this.refresh(state)
      throw unavailable("public message query failed")
    }
  }
  private epoch(sessionID: string) { return this.epochs.get(sessionID) ?? 0 }
  private invalidate(sessionID: string, terminal = false) {
    this.epochs.set(sessionID, this.epoch(sessionID) + 1)
    const timer = this.timers.get(sessionID)
    if (timer) clearTimeout(timer)
    this.timers.delete(sessionID)
    if (terminal) {
      this.terminalEpochs.set(sessionID, (this.terminalEpochs.get(sessionID) ?? 0) + 1)
      this.eligible.delete(sessionID); this.activeSessions.delete(sessionID)
    }
  }
  private pending(state: State) {
    const eligible = this.eligible.get(state.sessionID)
    return state.messages.filter(entry => entry.saved === "confirmed" && entry.fingerprint && eligible?.get(entry.messageID) === entry.fingerprint
      && !entry.historicalBaseline && !entry.prepared.some(item => item.sourceFingerprint === entry.fingerprint)
      && !state.recovery.attempts.some(attempt => attempt.pending.some(item => item.messageID === entry.messageID && item.fingerprint === entry.fingerprint)))
  }
  private latestAssistant(messages: Message[]) { return [...messages].reverse().find(message => message.info.role === "assistant") }
  private successful(message: Message | undefined) {
    return !!message && !message.info.summary && !message.info.error && !!message.info.time?.completed && !!message.info.finish
      && (message.info.structured !== undefined || !["tool-calls", "unknown", "error"].includes(message.info.finish))
  }
  private async idle(sessionID: string) {
    const result = await this.input.client.session.status({ query: { directory: this.directory }, signal: AbortSignal.timeout(1500) })
    if (result.error || !result.data) throw unavailable("recovery status query failed")
    return !result.data[sessionID] || result.data[sessionID].type === "idle"
  }
  private schedule(state: State) {
    const sessionID = state.sessionID
    if (!this.autoResume || state.lifecycle !== "idle" || this.deleted.has(sessionID) || this.timers.has(sessionID) || this.dispatches.has(sessionID) || !this.pending(state).length) return
    const epoch = this.epoch(sessionID)
    const timer = setTimeout(() => {
      this.timers.delete(sessionID)
      void this.resume(sessionID, epoch).catch(async () => {
        await this.serial(sessionID, async current => { this.diagnostic(current, "recovery-check-failed"); await this.persist(current) }).catch(() => undefined)
      })
    }, 50)
    timer.unref?.()
    this.timers.set(sessionID, timer)
  }
  private async resume(sessionID: string, epoch: number) {
    // Persist attempt inside the queue, then dispatch OUTSIDE it: promptAsync
    // re-enters chat.message and would deadlock if the queue were held.
    const request = await this.serial(sessionID, async state => {
      if (epoch !== this.epoch(sessionID) || state.lifecycle !== "idle" || this.deleted.has(sessionID)) return
      const messages = await this.reconcile(state)
      const assistant = this.latestAssistant(messages)
      const pending = this.pending(state)
      if (!pending.length || !this.successful(assistant) || state.evidence !== "available" || !await this.idle(sessionID) || epoch !== this.epoch(sessionID)) return
      const latest = [...messages].reverse().find(message => message.info.role === "user" && effective(message.parts).length)
      if (!latest || typeof latest.info.agent !== "string" || !latest.info.model) return
      const items = pending.map(entry => ({ messageID: entry.messageID, fingerprint: entry.fingerprint! }))
      const key = hash(stable(items))
      const attempt: RecoveryAttempt = { key, assistantID: assistant!.info.id, pending: items, attemptedAt: Date.now(), status: "attempted" }
      state.recovery.attempts.push(attempt)
      await this.persist(state)
      if (state.evidence !== "available" || this.storageErrors.has(sessionID) || epoch !== this.epoch(sessionID)) return
      const dispatch = { key, epoch, assistantID: assistant!.info.id }
      this.dispatches.set(sessionID, dispatch)
      return { dispatch, body: {
        agent: latest.info.agent, model: structuredClone(latest.info.model),
        ...(latest.info.system !== undefined ? { system: latest.info.system } : {}),
        ...(latest.info.format !== undefined ? { format: structuredClone(latest.info.format) } : {}),
        ...(latest.info.variant !== undefined ? { variant: latest.info.variant } : {}),
        // Never send tools: the pinned prompt path treats it as a permission update.
        parts: [{ type: "text", synthetic: true,
          text: "[Steering continuation] Re-read the original saved user guidance in this conversation (message IDs: " + items.map(item => item.messageID).join(", ") + "). Continue the existing task using that guidance. Preserve completed work and existing permissions. This is a synthetic continuation control, not new user guidance.",
          metadata: { codeagentSteering: { plugin: "@oneshot/opencode-steering", kind: "continuation", recoveryKey: key } } }],
      } }
    })
    if (!request) return
    let outcome: RecoveryAttempt["status"] = "suppressed"
    try {
      if (this.epoch(sessionID) === request.dispatch.epoch && !this.deleted.has(sessionID)) {
        // SDK v1 declarations omit public runtime synthetic/metadata/format fields.
        const options = { path: { id: sessionID }, query: { directory: this.directory }, body: request.body, signal: AbortSignal.timeout(5000) }
        const result = await this.input.client.session.promptAsync(options as unknown as Parameters<PluginInput["client"]["session"]["promptAsync"]>[0])
        outcome = "error" in result && result.error ? "dispatch-unknown" : "dispatched"
      }
    } catch { outcome = "dispatch-unknown" }
    finally {
      // prompt_async may acknowledge before chat.message runs. Keep the token
      // through that callback; a timeout only releases memory, never retries.
      const cleanup = setTimeout(() => {
        if (this.dispatches.get(sessionID) !== request.dispatch) return
        this.dispatches.delete(sessionID)
        // A newer turn may have accumulated a different pending fingerprint
        // while this permit was outstanding. Recheck only those new items;
        // pending() excludes every already attempted original fingerprint.
        void this.serial(sessionID, async state => {
          await this.reconcile(state)
          await this.persist(state)
          this.schedule(state)
        }).catch(() => undefined)
      }, 5000)
      cleanup.unref?.()
      await this.serial(sessionID, async state => {
        const attempt = state.recovery.attempts.find(item => item.key === request.dispatch.key)
        if (attempt && attempt.status !== "suppressed") attempt.status = outcome
        this.diagnostic(state, `recovery-${attempt?.status ?? outcome}`, { messageIDs: attempt?.pending.map(item => item.messageID) })
        await this.persist(state)
        this.schedule(state)
      })
    }
  }
  private suppression(sessionID: string) {
    // The public async route reports a rejected control as session.error. Match
    // only our own unpredictable token, never a generic provider error prefix.
    const token = randomUUID()
    const tokens = this.suppressionTokens.get(sessionID) ?? new Set<string>()
    tokens.add(token)
    this.suppressionTokens.set(sessionID, tokens)
    const cleanup = setTimeout(() => {
      tokens.delete(token)
      if (!tokens.size && this.suppressionTokens.get(sessionID) === tokens) this.suppressionTokens.delete(sessionID)
    }, 30000)
    cleanup.unref?.()
    return new Error(`STEERING_RECOVERY_SUPPRESSED: lifecycle or pending guidance changed before control persistence (${token})`)
  }
  private async control(sessionID: string, output: { message: { id: string }; parts: Part[] }, key: unknown) {
    await this.serial(sessionID, async state => {
      const dispatch = this.dispatches.get(sessionID)
      const attempt = state.recovery.attempts.find(item => item.key === key)
      const messages = await this.reconcile(state)
      const assistant = this.latestAssistant(messages)
      const pending = attempt?.pending.every(item => state.messages.some(entry => entry.messageID === item.messageID && entry.saved === "confirmed" && entry.fingerprint === item.fingerprint && !entry.prepared.some(prepared => prepared.sourceFingerprint === item.fingerprint)))
      if (!dispatch || dispatch.key !== key || dispatch.epoch !== this.epoch(sessionID) || !attempt || !pending || !this.successful(assistant)
        || assistant!.info.id !== dispatch.assistantID || ["cancelled", "failed", "deleted"].includes(state.lifecycle) || state.evidence !== "available" || !await this.idle(sessionID)
        || dispatch.epoch !== this.epoch(sessionID)) {
        if (attempt) attempt.status = "suppressed"
        // A late callback for an expired key must not consume a newer permit.
        if (dispatch?.key === key) this.dispatches.delete(sessionID)
        await this.persist(state)
        throw this.suppression(sessionID)
      }
      attempt.controlMessageID = output.message.id
      await this.persist(state)
      if (this.storageErrors.has(sessionID) || dispatch.epoch !== this.epoch(sessionID)) throw unavailable("recovery evidence changed before control save")
      this.dispatches.delete(sessionID)
    })
  }
  async observe(sessionID: string, output: { message: { id: string }; parts: Part[] }) {
    const control = output.parts.find(part => part.type === "text" && part.synthetic && (part.metadata as { codeagentSteering?: { plugin?: string } } | undefined)?.codeagentSteering?.plugin === "@oneshot/opencode-steering")
    if (control) return this.control(sessionID, output, (control.metadata as { codeagentSteering: { recoveryKey?: string } }).codeagentSteering.recoveryKey)
    const observedActive = this.activeSessions.has(sessionID)
    const texts = output.parts.filter(part => part.type === "text" && !part.synthetic && !part.ignored && typeof part.text === "string")
    const explicit = texts.some(part => prefix.test(String(part.text)))
    if (explicit && !effective(output.parts).length) throw new Error("Usage: steer: <guidance for the current task>, or attach a file")
    if (!effective(output.parts).length) return
    this.invalidate(sessionID)
    const observedTerminalEpoch = this.terminalEpochs.get(sessionID) ?? 0
    await this.serial(sessionID, async state => {
      // This runs before the kernel persists the incoming message. It never
      // mutates input or reports a successful save merely because the hook ran.
      await this.reconcile(state).catch(() => undefined)
      const entry = this.entry(state, output.message.id)
      entry.observationReason = explicit ? "explicit" : state.lifecycle === "active" ? "active" : "ordinary"
      const expected = fingerprint(output.parts)
      if (entry.expectedFingerprint !== expected) {
        entry.expectedFingerprint = expected
        entry.historicalBaseline = false
        if (entry.fingerprint !== expected) entry.saved = "unknown"
      }
      if (this.autoResume && observedActive && observedTerminalEpoch === (this.terminalEpochs.get(sessionID) ?? 0)) {
        const eligible = this.eligible.get(sessionID) ?? new Map<string, string>()
        eligible.set(entry.messageID, expected)
        this.eligible.set(sessionID, eligible)
      }
      await this.persist(state)
      this.schedule(state)
    })
  }
  async compacting(sessionID: string) {
    this.compactingSessions.add(sessionID)
    await this.serial(sessionID, async state => { this.diagnostic(state, "compaction-started"); await this.persist(state) })
  }
  async prepare(output: { messages: Message[] }) {
    const sessionIDs = [...new Set(output.messages.map(message => message.info.sessionID))]
    if (sessionIDs.length !== 1) return
    const sessionID = sessionIDs[0]
    await this.serial(sessionID, async state => {
      let messages: Message[]
      try { messages = await this.reconcile(state) } catch { await this.persist(state); return }
      if (this.compactingSessions.delete(sessionID)) {
        this.diagnostic(state, "compaction-prepared")
        await this.persist(state)
        return
      }
      const contextIDs = new Set(output.messages.map(message => message.info.id))
      const parent = [...output.messages].reverse().find(message => message.info.role === "user")?.info.id
      const candidates = messages.filter(message => message.info.role === "assistant" && !message.info.summary && !message.info.time?.completed && !message.info.finish && !message.info.error
        && message.info.parentID === parent && !contextIDs.has(message.info.id))
      if (candidates.length !== 1 || state.snapshots.some(snapshot => snapshot.assistantID === candidates[0]?.info.id)) {
        this.diagnostic(state, "assistant-association-unavailable")
        await this.persist(state)
        return
      }
      const assistantID = candidates[0].info.id
      // Only definitely pending, previously observed guidance can be restored.
      // Equal content under another ID could be native compaction replay; do not
      // guess or inject a duplicate. Leave it pending and fail closed at gate.
      for (const entry of state.messages) {
        if (contextIDs.has(entry.messageID) || entry.historicalBaseline || entry.saved !== "confirmed" || entry.prepared.some(item => item.sourceFingerprint === entry.fingerprint)) continue
        entry.compacted = true
        const source = messages.find(message => message.info.id === entry.messageID)
        if (!source || entry.observationReason === "unknown" || state.ordering.status === "ambiguous" || Buffer.byteLength(stable(source.parts)) > 1_048_576
          || output.messages.some(message => message.info.role === "user" && fingerprint(message.parts, true, false) === fingerprint(source.parts, false, false))) continue
        const sourceIndex = messages.indexOf(source)
        const insertion = output.messages.findIndex(message => messages.findIndex(item => item.info.id === message.info.id) > sourceIndex)
        output.messages.splice(insertion < 0 ? output.messages.length : insertion, 0, structuredClone(source))
        contextIDs.add(entry.messageID)
      }
      const snapshot: Snapshot = { assistantID, sequence: ++state.sequence, preparedAt: Date.now(), users: [], coverage: {} }
      for (const message of output.messages.filter(message => message.info.role === "user" && effective(message.parts).length)) {
        const entry = state.messages.find(item => item.messageID === message.info.id)
        if (!entry || entry.saved !== "confirmed" || (fingerprint(message.parts) !== entry.fingerprint && fingerprint(message.parts, true) !== entry.fingerprint)) {
          this.diagnostic(state, "context-source-mismatch", { assistantID, messageIDs: [message.info.id] })
          await this.persist(state)
          return
        }
        snapshot.users.push({ messageID: entry.messageID, sourceFingerprint: entry.fingerprint!, contextFingerprint: fingerprint(message.parts) })
        snapshot.coverage[entry.messageID] = entry.fingerprint!
      }
      for (const entry of state.messages) {
        if (entry.saved === "confirmed" && entry.fingerprint && (entry.historicalBaseline || entry.prepared.some(item => item.sourceFingerprint === entry.fingerprint))) snapshot.coverage[entry.messageID] = entry.fingerprint
      }
      state.snapshots.push(snapshot)
      for (const user of snapshot.users) {
        const entry = state.messages.find(item => item.messageID === user.messageID)!
        entry.prepared.push({ assistantID, snapshotSequence: snapshot.sequence, preparedAt: snapshot.preparedAt, sourceFingerprint: user.sourceFingerprint, contextFingerprint: user.contextFingerprint })
        entry.compacted = false
      }
      state.lifecycle = "active"
      this.activeSessions.add(sessionID)
      await this.persist(state)
    })
  }
  async gate(input: { tool: string; sessionID: string; callID: string }) {
    if (input.tool === "steering_status") return
    await this.serial(input.sessionID, async state => {
      let messages: Message[] = []
      let owners: Message[] = []
      let nativeOwner: Message | undefined
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          messages = await this.reconcile(state)
          owners = messages.filter(message => message.info.role === "assistant" && message.parts.some(part => part.type === "tool" && part.callID === input.callID && part.tool === input.tool))
          nativeOwner = owners.length === 0 ? this.nativeSubtaskOwner(messages, input) : undefined
          if (owners.length || nativeOwner || attempt === 2) break
          await new Promise(resolve => setTimeout(resolve, 20))
        }
        const owner = owners.length === 1 ? owners[0] : nativeOwner
        const snapshot = owner && state.snapshots.find(item => item.assistantID === owner.info.id)
        if ((!snapshot && !nativeOwner) || state.evidence === "unavailable") {
          this.diagnostic(state, "tool-association-unavailable", { callID: input.callID })
          throw unavailable("tool call has no trustworthy assistant snapshot")
        }
        const unresolved = state.messages.filter(entry => entry.saved === "unknown" && (nativeOwner || entry.fingerprint))
        if (unresolved.length) throw unavailable("saved message parts changed or became unavailable")
        // Native SubtaskPart dispatch precedes normal messages.transform. It
        // may proceed without inventing a snapshot only when every real input
        // is already covered by normal preparation or completed-history baseline.
        const pending = state.messages.filter(entry => entry.saved === "confirmed" && (snapshot
          ? snapshot.coverage[entry.messageID] !== entry.fingerprint
          : !entry.historicalBaseline && !entry.prepared.some(item => item.sourceFingerprint === entry.fingerprint)))
        if (pending.length) {
          const messageIDs = pending.map(entry => entry.messageID)
          this.diagnostic(state, "stale-tool-blocked", { assistantID: owner!.info.id, callID: input.callID, messageIDs })
          throw new Error(`STEERING_STALE_CONTEXT: assistant ${owner!.info.id} did not prepare saved guidance ${messageIDs.join(", ")}. Read the latest user guidance in the next model request before taking further actions.`)
        }
        this.diagnostic(state, nativeOwner ? "native-subtask-checkpoint-passed" : "tool-checkpoint-passed", { assistantID: owner!.info.id, callID: input.callID })
      } finally { await this.persist(state) }
      if (this.storageErrors.has(state.sessionID) || this.readErrors.has(state.sessionID)) throw unavailable("evidence persistence failed")
    })
  }
  private nativeSubtaskOwner(messages: Message[], input: { tool: string; sessionID: string; callID: string }) {
    if (input.tool !== "task") return
    // The pinned native path persists a separate ToolPart.callID but passes
    // ToolPart.id to this hook. Never treat an ordinary model task as native.
    const candidates = messages.flatMap(owner => owner.info.role === "assistant" && !owner.info.summary && !owner.info.finish && !owner.info.time?.completed && !owner.info.error
      ? owner.parts.filter(part => part.type === "tool" && part.tool === "task" && part.id === input.callID && part.sessionID === input.sessionID && part.messageID === owner.info.id
        && typeof part.callID === "string" && !!part.callID && part.callID !== input.callID).map(part => ({ owner, part })) : [])
    if (candidates.length !== 1) return
    const { owner, part } = candidates[0]
    const toolState = part.state as { status?: unknown; input?: unknown } | undefined
    if (toolState?.status !== "running" || !toolState.input || typeof toolState.input !== "object" || Array.isArray(toolState.input)) return
    const parents = messages.filter(message => message.info.role === "user" && message.info.id === owner.info.parentID)
    if (parents.length !== 1) return
    const tasks = parents[0].parts.filter(task => task.type === "subtask" && task.sessionID === input.sessionID && task.messageID === parents[0].info.id
      && typeof task.prompt === "string" && typeof task.description === "string" && typeof task.agent === "string"
      && (task.command === undefined || typeof task.command === "string") && task.agent === owner.info.agent
      && stable(toolState.input) === stable({ prompt: task.prompt, description: task.description, subagent_type: task.agent, command: task.command }))
    if (tasks.length === 1) return owner
  }
  async status(sessionID: string, messageID?: string) {
    return this.serial(sessionID, async state => {
      await this.reconcile(state).catch(() => undefined)
      // Status is observational; busy is never an acceptance lock.
      if (!this.deleted.has(sessionID)) {
        try {
          const result = await this.input.client.session.status({ query: { directory: this.directory }, signal: AbortSignal.timeout(1500) })
          if (!result.error && result.data) {
            const status = result.data[sessionID]?.type
            if (status === "busy" || status === "retry") state.lifecycle = "active"
            else if (!["cancelled", "failed"].includes(state.lifecycle)) state.lifecycle = "idle"
          }
        } catch { this.diagnostic(state, "status-query-failed") }
      }
      await this.persist(state)
      const result = structuredClone(state)
      if (messageID) result.messages = result.messages.filter(entry => entry.messageID === messageID)
      return result
    })
  }
  async event(event: { type: string; properties?: unknown }) {
    const properties = event.properties as { sessionID?: string; info?: Message["info"]; part?: { sessionID?: string }; status?: { type: string }; error?: { name?: string; data?: { message?: string } } } | undefined
    const sessionID = properties?.sessionID ?? properties?.info?.sessionID ?? properties?.part?.sessionID
      ?? (event.type === "session.deleted" ? properties?.info?.id : undefined)
    if (!sessionID) return
    const errorMessage = properties?.error?.data?.message
    if (event.type === "session.error" && properties?.error?.name === "UnknownError" && typeof errorMessage === "string") {
      const tokens = this.suppressionTokens.get(sessionID)
      const ownToken = tokens && [...tokens].find(token => errorMessage.includes(token))
      if (ownToken) {
        tokens!.delete(ownToken)
        if (!tokens!.size) this.suppressionTokens.delete(sessionID)
        if (!this.deleted.has(sessionID)) await this.serial(sessionID, async state => {
          this.diagnostic(state, "recovery-suppression-notification")
          await this.persist(state)
        }).catch(() => undefined)
        return
      }
    }
    // Invalidate before awaiting the queue, so cancellation can suppress a
    // scheduled/in-flight control even while a slow SDK read is outstanding.
    const terminal = event.type === "session.deleted" || !!(properties?.error ?? properties?.info?.error)
    if (terminal) this.invalidate(sessionID, true)
    if (event.type === "session.status" && ["busy", "retry"].includes(properties?.status?.type ?? "")) {
      this.invalidate(sessionID)
      this.activeSessions.add(sessionID)
    }
    if (event.type === "session.idle" || event.type === "session.status" && properties?.status?.type === "idle") this.activeSessions.delete(sessionID)
    try {
      await this.serial(sessionID, async state => {
        if (event.type === "session.deleted") {
          this.deleted.add(sessionID)
          state.lifecycle = "deleted"
          this.compactingSessions.delete(sessionID)
          await rm(state.stateFile, { force: true }).catch(() => this.diagnostic(state, "state-delete-failed"))
          this.sessions.delete(sessionID)
          return
        }
        if (this.deleted.has(sessionID)) return
        if (event.type === "session.status") {
          if (properties?.status?.type === "busy" || properties?.status?.type === "retry") state.lifecycle = "active"
          else if (!["cancelled", "failed"].includes(state.lifecycle)) state.lifecycle = "idle"
        }
        if (event.type === "session.idle" && !["cancelled", "failed"].includes(state.lifecycle)) state.lifecycle = "idle"
        const error = properties?.error ?? properties?.info?.error
        if (error) state.lifecycle = error.name === "MessageAbortedError" ? "cancelled" : "failed"
        if (event.type === "session.compacted") this.compactingSessions.delete(sessionID)
        if (["message.updated", "message.part.updated", "message.removed", "message.part.removed", "session.status", "session.idle", "session.error", "session.compacted"].includes(event.type)) {
          await this.reconcile(state).catch(() => undefined)
          await this.persist(state)
          this.schedule(state)
        }
      })
    } catch {
      // Event callbacks are fire-and-forget in the pinned kernel. Never allow an
      // unhandled rejection to crash it or represent this as delivery success.
      this.readErrors.add(sessionID)
      const state = await this.load(sessionID).catch(() => undefined)
      if (state) { this.diagnostic(state, "event-observation-failed"); this.refresh(state) }
    }
  }
}
