import type { PluginInput, PluginOptions } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"

// Runtime v1.3.17 fields that the public SDK v1 does not yet describe.
export type Part = { type: string; [key: string]: unknown }
export type Message = { info: { id: string; sessionID: string; role: string; parentID?: string;
  time?: { created?: number; completed?: number }; finish?: string; summary?: unknown; error?: unknown; [key: string]: unknown }; parts: Part[] }
type Active = { ordinary: boolean; pending: Map<string, Set<unknown>> }
type Recovery = { pending: Set<string>; key: string; timer?: ReturnType<typeof setTimeout> }
const start = "<system-reminder>\nThe user sent the following message:\n"
const end = "\n\nPlease address this message and continue with your tasks.\n</system-reminder>"
const effective = (parts: Part[]) => parts.some(p => !p.ignored && !p.synthetic &&
  (p.type === "text" && typeof p.text === "string" && !!(p.text.startsWith(start) && p.text.endsWith(end)
    ? p.text.slice(start.length, -end.length) : p.text).trim() || p.type === "file" && typeof p.url === "string" && !!p.url.trim()))
const reminder = "[Steering reminder] Latest user guidance takes priority. Preserve completed results. Skip obsolete actions and report which actions were skipped and why. Re-read the original guidance before further tools."
const marker = "codeagentSteering"

export class SteeringState {
  private active = new Map<string, Active>()
  private compacting = new Set<string>()
  private recovering = new Map<string, Recovery>()
  private issued = new Map<string, string>()
  private suppressions = new Set<string>()
  private input: PluginInput
  private options: PluginOptions
  constructor(input: PluginInput, options: PluginOptions) { this.input = input; this.options = options }
  private invalidate(id: string) {
    clearTimeout(this.recovering.get(id)?.timer)
    this.recovering.delete(id)
  }
  private clear(id: string) {
    this.active.delete(id); this.compacting.delete(id); this.invalidate(id)
  }
  private toast(message: string) {
    void this.input.client.tui.showToast({ body: { title: "Steering", message, variant: "info", duration: 2500 },
      signal: AbortSignal.timeout(1500) }).catch(() => undefined)
  }
  private params(id: string) {
    return { path: { id }, query: { directory: this.input.directory }, signal: AbortSignal.timeout(1500) }
  }
  async observe(id: string, output: { message: Message["info"]; parts: Part[] }) {
    const control = output.parts.find(p => {
      const c = (p.metadata as Record<string, { plugin?: string; recoveryKey?: string }> | undefined)?.[marker]
      return p.synthetic && c?.plugin === "@oneshot/opencode-steering" &&
        typeof c.recoveryKey === "string" && this.issued.get(c.recoveryKey) === id
    })
    if (control) return this.control(id, (control.metadata as Record<string, { recoveryKey: string }>)[marker].recoveryKey)
    this.invalidate(id)
    const s = this.active.get(id)
    if (!s || output.message.role !== "user") return
    if (!effective(output.parts)) { s.pending.delete(output.message.id); return }
    s.pending.set(output.message.id, new Set(output.parts.filter(p => effective([p])).map(p => p.id)))
    this.toast("Guidance observed; waiting for next request")
  }
  async prepare(output: { messages: Message[] }) {
    const ids = new Set(output.messages.map(m => m.info.sessionID))
    if (ids.size !== 1 || ![...ids][0]) {
      for (const id of new Set([...this.active.keys(), ...this.compacting, ...this.recovering.keys()])) this.clear(id)
      return
    }
    const id = [...ids][0], previous = this.active.get(id)
    const recovery = this.recovering.get(id)
    this.invalidate(id)
    const summary = this.compacting.delete(id)
    const included = !summary && output.messages.find(m => m.info.role === "user" &&
      (previous?.pending.has(m.info.id) || recovery?.pending.has(m.info.id)) && effective(m.parts))
    this.active.set(id, { ordinary: !summary, pending: new Map() })
    if (!included) return
    included.parts.push({ type: "text", synthetic: true, text: reminder })
    this.toast("Guidance absorbed at this request checkpoint")
  }
  async gate(input: { tool: string; sessionID: string; callID: string }) {
    if (input.tool === "steering_status" || input.callID?.startsWith("prt_")) return
    const s = this.active.get(input.sessionID)
    if (!s?.ordinary || !s.pending.size) return
    this.toast("Blocked an obsolete tool; latest guidance will be used next")
    throw new Error("STEERING_STALE_CONTEXT: guidance arrived after this request checkpoint. " + reminder)
  }
  compact(id: string) {
    this.clear(id); this.compacting.add(id)
  }
  private valid(id: string, r: Recovery) { return this.recovering.get(id) === r }
  private async recover(id: string, r: Recovery) {
    let dispatched = false
    try {
      const result = await this.input.client.session.messages(this.params(id))
      if (!this.valid(id, r) || result.error || !Array.isArray(result.data)) return
      const messages = result.data as unknown as Message[]
      if (messages.some(m => m.info.sessionID !== id)) return
      const assistant = [...messages].reverse().find(m => m.info.role === "assistant")?.info
      const latest = [...messages].reverse().find(m => m.info.role === "user" && effective(m.parts))
      const parent = messages.findIndex(m => m.info.role === "user" && m.info.id === assistant?.parentID)
      if (!assistant || assistant.error || !assistant.time?.completed || !assistant.finish ||
        ["tool-calls", "unknown", "error"].includes(assistant.finish) && !assistant.structured ||
        !latest || !r.pending.has(latest.info.id) || parent < 0 || messages.indexOf(latest) <= parent) return
      const status = await this.input.client.session.status({ query: { directory: this.input.directory }, signal: AbortSignal.timeout(1500) })
      if (!this.valid(id, r) || status.error || !status.data || status.data[id]?.type && status.data[id].type !== "idle") return
      const session = await this.input.client.session.get(this.params(id))
      if (!this.valid(id, r) || session.error || !session.data || session.data.revert) return
      const { agent, model, system, variant, format } = latest.info
      const body = { agent, model, system, variant, format, parts: [{ type: "text", synthetic: true,
        text: "[Steering continuation] Re-read original saved guidance " + latest.info.id + ". Continue with the current task.",
        metadata: { [marker]: { plugin: "@oneshot/opencode-steering", recoveryKey: r.key } } }] }
      this.issued.set(r.key, id)
      const timer = setTimeout(() => this.issued.delete(r.key), 30000); timer.unref?.()
      const dispatch = await this.input.client.session.promptAsync({ ...this.params(id),
        body: body as NonNullable<Parameters<PluginInput["client"]["session"]["promptAsync"]>[0]>["body"] })
      dispatched = !dispatch.error
    } catch { if (this.valid(id, r)) this.invalidate(id) }
    finally { if (!dispatched && this.valid(id, r)) this.invalidate(id) }
  }
  private async control(id: string, key: string) {
    const r = this.recovering.get(id)
    let valid = !!r && r.key === key
    try {
      if (valid) {
        const session = await this.input.client.session.get(this.params(id))
        valid = this.valid(id, r!) && !session.error && !!session.data && !session.data.revert
        if (valid) {
          const status = await this.input.client.session.status({ query: { directory: this.input.directory }, signal: AbortSignal.timeout(1500) })
          valid = this.valid(id, r!) && !status.error && !!status.data && (!status.data[id] || status.data[id].type === "idle")
        }
      }
    } catch { valid = false }
    if (this.issued.get(key) !== id) return
    if (valid) { this.toast("Continuing with saved guidance"); return }
    if (r && r.key === key && this.valid(id, r)) this.invalidate(id)
    const token = randomUUID()
    this.suppressions.add(token)
    const timer = setTimeout(() => this.suppressions.delete(token), 30000); timer.unref?.()
    throw new Error(`STEERING_RECOVERY_SUPPRESSED (${token})`)
  }
  status(id: string) {
    const s = this.active.get(id)
    return { sessionID: id, request: s ? s.ordinary ? "ordinary" : "summary" : "unknown",
      pending: [...(s?.pending.keys() ?? [])], recovery: this.recovering.has(id), provider: "unknown", adopted: "unknown" }
  }
  async event(event: { type: string; properties?: unknown }) {
    const p = event.properties as { sessionID?: string; messageID?: string; info?: Message["info"] & { revert?: unknown };
      part?: Part & { sessionID?: string; messageID?: string }; status?: { type: string }; error?: { data?: { message?: string } } }
    const id = p?.sessionID ?? p?.part?.sessionID ?? p?.info?.sessionID ?? (event.type.startsWith("session.") ? p?.info?.id : undefined)
    if (!id) return
    if (event.type === "session.error") {
      const token = [...this.suppressions].find(t => p.error?.data?.message?.includes(t))
      if (token) { this.suppressions.delete(token); return }
    }
    if (event.type === "session.deleted" || event.type === "session.error" || p.info?.error ||
      event.type === "session.updated" && p.info?.revert) { this.clear(id); return }
    if (event.type === "message.part.updated" && p.part &&
      this.recovering.get(id)?.pending.has(p.part.messageID ?? "")) this.invalidate(id)
    if (event.type === "message.removed" || event.type === "message.part.removed" ||
      event.type === "message.part.updated" && p.part && !effective([p.part]) &&
      this.active.get(id)?.pending.get(p.part.messageID ?? "")?.has(p.part.id)) {
      this.active.get(id)?.pending.delete(p.messageID ?? p.part?.messageID ?? "")
      this.invalidate(id)
    }
    if (event.type !== "session.status" || p.status?.type !== "idle") return
    const s = this.active.get(id)
    this.clear(id)
    if (!s?.pending.size || this.options.autoResume === false) return
    const r: Recovery = { pending: new Set(s.pending.keys()), key: randomUUID() }
    this.recovering.set(id, r)
    r.timer = setTimeout(() => this.invalidate(id), 5000); r.timer.unref?.()
    const timer = setTimeout(() => { if (this.valid(id, r)) void this.recover(id, r) }, 75); timer.unref?.()
  }
}
