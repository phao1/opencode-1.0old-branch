# @oneshot/opencode-steering 0.4.0 (Steering v2)

An independent public Hooks/SDK plugin for official OpenCode **1.3.17**. While a task runs, submit ordinary guidance in its current session. The plugin blocks obsolete ordinary tool calls that have not passed `tool.execute.before`, and prepares a reminder that latest guidance takes priority, completed results should be kept, and skipped actions should be reported. Original messages and attachments remain in native storage.

## Build and install

Requires Node 24+, npm and Bun. From the repository root:

```sh
bun run --cwd external-plugins/steering build
node_modules/.bin/tsc --noEmit -p external-plugins/steering
BUN_BINARY="$HOME/.bun/bin/bun" node scripts/package-steering.mjs
npm install --prefix "$HOME/.local/share/opencode-steering" --ignore-scripts /absolute/path/dist/oneshot-opencode-steering-0.4.0.tgz
```

The package bundles runtime dependencies into one `dist/index.js`. It declares exact public plugin peer/dev version 1.3.17. The peer is optional: it describes type and host API compatibility, while its type-only import is erased and all runtime dependencies remain bundled. Installing the artifact does not fetch this peer. Packaging verifies npm pack contents, offline installation using a newly created empty npm cache, absence of the optional type-only peer, byte identity, private import boundaries, and the sole function export `SteeringPlugin`. Root typecheck and `bun run --cwd external-plugins build` also cover the aggregate bridge.

Add the installed absolute entry once to your OpenCode config and restart:

```json
{"plugin":["/absolute/path/node_modules/@oneshot/opencode-steering/dist/index.js"]}
```

Install either the standalone package or the aggregate CodeAgent bridge. The single export prevents repeated invocation within one module by the old loader; it does not deduplicate separate configuration entries.

## Input and evidence

Use ordinary input, for example: `Keep completed work. Skip the pending export. Write a summary instead.` No queue command or prefix is required. Rapid inputs are ordered by native message ID. Ignored, synthetic and empty parts do not create guidance; generated attachment text stays in the model context. Received candidates become saved only when all expected effective parts match. A request snapshot belongs to its particular current assistant; later requests cannot admit that assistant's old tools.

`steering_status` is a read-only, always gate-exempt tool. It shows process-local saved/prepared/compacted observations, recovery attempts and short diagnostics. Compacted means that exact version was included directly, or through its previously covering summary, in a successful summary request, rather than prepared in an ordinary request; it does not prove that the summary retained its meaning. Provider receipt and semantic adoption remain `unknown`. Toasts are best effort, limited to one per 500ms, and may appear in another session's TUI. Toast failures never change steering behavior.

There is no disk ledger or second inbox. Restart drops observations and never replays historical pending input. Limits: 128 cached sessions, 256 unresolved or still needed user inputs per session, 128 assistant snapshots, 1024 call/native-part mappings, 1024 running-part IDs, 32 diagnostics and 256 recovery attempts. Successful completed idle boundaries remove settled/compacted guidance and obsolete assistant snapshots; pending/unknown inputs remain, with latest request metadata retained when recovery needs it. More than 300 ordinary serial turns do not exhaust the input cap. Cancelled/failed sessions release observations only after an explicit idle boundary with no running work or recovery permit; then they can be evicted without replaying old input. Active sessions and terminal sessions lacking that safe boundary remain protected. A running-part tracking overflow conservatively retains state until restart/delete. Idle sessions with no retained guidance can be evicted. If 256 unresolved inputs remain, capacity diagnostics require checking/removing those native inputs; errors occur before saving an additional input; unknown/evicted call or snapshot ownership cannot admit stale ordinary tools. Status does not scan history; each real request calibrates once, with one shared fallback query for unknown ownership or incomplete saves. All concurrent gates await the in-flight query before an unresolved task can use the native safety exception. Events update caches without reading history per token/tool. For a new, never-confirmed candidate, info-only history, empty parts and absent rows do not prove failure: no age-based eviction is used. Such inputs remain unknown and block stale ordinary tools; status diagnostics ask you to inspect the native save or explicitly remove the input. Later parts can still confirm the input. Already saved guidance edited to whitespace/ignored/synthetic content is confirmed empty by a current public history read and stops blocking/recovery. While its observation is retained, editing it back to effective content invalidates the empty exemption. A restart drops these process-local observations without replaying them.

## Completion recovery

After successful completion leaves saved, unprepared guidance observed during this process's active task, an idle debounce rechecks history, status and `session.get` revert state. Each guidance content version has at most one recovery attempt. A single-use permit is invalidated by cancellation/error/deletion/compaction/revert, new real input, or normal preparation. The synthetic control re-enters `chat.message` and rechecks the permit before save. A 204 acknowledgement means dispatch only; `control-accepted` means the hook accepted it, not proof of persistence or provider delivery. Unknown outcomes require manual retry; the plugin does not retry them.

The control references original guidance IDs without copying their contents. It inherits model, agent, system, variant and format from latest effective guidance. It omits tools and leaves session permissions intact. Unrecoverable fields suppress automatic recovery with diagnostics.

Both the standalone and aggregate CodeAgent entry forward plugin options unchanged to Steering. Disable recovery when desired:

```json
{"plugin":[["/absolute/path/dist/index.js",{"autoResume":false}]]}
```

Active `noReply` input cannot be distinguished by these hooks and may be recovered; applications using it should set `autoResume:false`. Public APIs offer no atomic cancel/dispatch/save transaction. Idle cancellation has no dedicated event; cancellation or revert still in progress but not yet observed, or cancellation after the last check, can race with control save. Revert is never cleaned up automatically by this plugin.

## G1–G7 boundaries

- G1: Ordinary stale calls are blocked, including multiple calls from one response. Already passed gates, MCP permission waits after the gate, batch internals and StructuredOutput are outside this guarantee.
- G2: Compaction records versions actually present in its transform and inherits unchanged versions only when their covering summary is included. A successful new summary replaces the prior summary ID, without an unbounded lineage graph. Successful completion retires those versions for future ordinary snapshots that contain that summary; it does not set ordinary prepared. Later inputs/edits and failed summaries are not retired. Completion clears the summary marker so the first ordinary request is prepared normally. Successful-idle recovery is bounded and non-atomic. Cancelled/error/deleted/compacted/reverted sessions do not automatically revive once observed.
- G3: Summary requests, ordinary requests containing a covering summary, and native replay requests carry an explicit latest-priority/preserve-results/report-skipped-actions reminder. A single latest-summary marker retains that static prompt across safe idle pruning. Request-only reminder and tool errors make the priority explicit. Preparation does not prove semantic adoption.
- G4: Toast and process-local status provide minimal feedback; native QUEUED display is unchanged.
- G5: Running subagents receive no forwarding. Native SubtaskPart uses a special unguarded hook path: confirmed part.id and unknown task ownership are safely exempted to avoid a hanging running part. An ordinary model task with confirmed callID ownership is gated. Native task exemptions do not claim G1 coverage or preparation of parent attachments.
- G6: Running tools continue; use native Esc for cancellation. No emergency abort or rollback.
- G7: No separate follow-up queue, copied message store or cross-session message relay.

## Native overflow replay

The fixed kernel may exclude the latest original input from an overflow summary, then copy it under new user/part IDs. One bounded current compaction window recognizes only an observed original, a public `auto:true, overflow:true` compaction trigger, a successful summary, adjacent native replay IDs, and strict request/history payload plus model/agent/system/variant/format/tools equality. New real input, cancellation/failure, another compaction or the first subsequent real request closes the window. Missing, ambiguous or incomplete evidence keeps the old version pending; arbitrary same-text history cannot grant coverage.

Only an actual request containing the confirmed native replay marks the original version prepared for that assistant. Text files and their generated synthetic attachment text are matched. As in the pinned source, image/* and application/pdf become `[Attached <mime>: <filename>]` text placeholders: **their original media content is absent from the replay request**. Status exposes `replayedAs` and `mediaStripped`; prepared here means the native rendered representation was included, without claiming full attachment delivery or semantic adoption. The plugin does not re-inject full media or create its own replay message.

## Deterministic CI

Install an exact official binary in a disposable prefix; retain the generated npm lock for integrity/platform subpackage verification. npm verifies its registry integrity. Never use `@latest`:

```sh
npm install --prefix .codeagent/steering-ci --save-exact --ignore-scripts opencode-ai@1.3.17
export OPENCODE_BINARY="$PWD/.codeagent/steering-ci/node_modules/opencode-ai/bin/opencode"
test "$("$OPENCODE_BINARY" --version)" = 1.3.17
export BUN_BINARY="$HOME/.bun/bin/bun"
node scripts/verify-steering.mjs
npm test
node scripts/check-kernel.mjs
```

`verify-steering` builds/packs/installs the independent artifact and runs all new tests against the installed entry. The root default `npm test` includes the same deterministic integration using the source entry. The tests run an actual official server with isolated XDG paths, no project config, disabled title/summary/models fetch, and local OpenAI SSE fixtures. They fail when the binary is missing or the version differs. No paid model/login is needed. A3 uses native-ID allocation barriers, and its disabled control actually stalls. Revert testing delays only the public SDK get to ensure revert has persisted before dispatch; no kernel code or SDK response is changed. Raw integration evidence and kernel logs remain under `.codeagent/steering-v2-*`.

## Real Codex demos

A logged-in Codex CLI and tmux (for TUI) are required:

```sh
node scripts/steering-v2-demo.mjs --out .codeagent/steering-v2-demo-headless
node scripts/steering-v2-demo.mjs --tui --out .codeagent/steering-v2-demo-tui
```

Use a fresh output directory for each run. `CODEX_BINARY`, `OPENCODE_BINARY` and `BUN_BINARY` can select executables. Both demos run enabled/disabled controls. They hold a real Codex tool decision after it is chosen, save the correction, then forward the unchanged decision. They retain native messages, HTTP request bodies, original Codex JSONL, final decisions/usage, artifacts and kernel logs, plus tmux capture-pane output. No scripted model fallback is used. tmux owns a unique socket/session and cleans up only that server. The API key is ephemeral and excluded from model evidence.

Current implementation evidence is indexed in [the implementation run](../../docs/oneshot/runs/20261104-0426-steering-v2/README.md). Legacy v0.3 ledger probes and documents describe historical results, not v2 behavior.

Change log (2026-11-04, round 2): retain info-only/slow-save candidates; await shared gate queries; track successful summary coverage and clear its marker; prune settled evidence at safe idle; forward aggregate options. Implementation-side regressions are indexed in the run README; formal verification remains with the host.

Change log (2026-11-04, round 3): transfer successive summary coverage; bind strictly confirmed native overflow replay; preserve explicit compaction-chain reminders; distinguish saved empty edits; release safely idle cancelled/failed sessions; verify optional exact peer with a fresh empty offline cache.
