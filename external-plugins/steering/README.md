# @oneshot/opencode-steering 0.5.0 (Steering v2.1)

Public Hooks/SDK plugin for official OpenCode **1.3.17**. Submit ordinary guidance in the running session. At `tool.execute.before`, Steering blocks ordinary calls belonging to the most recent ordinary request when effective input arrived after its transform checkpoint. Already started tools continue. It never aborts, rolls back, forwards to running subagents, or creates a follow-up queue.

The current contract follows [DESIGN v1.3](../../docs/oneshot/runs/20261104-0553-steering-v21/DESIGN.md).

## Install

Requires Node 24+, Bun and npm. From the repository root:

```sh
bun run --cwd external-plugins/steering build
node_modules/.bin/tsc --noEmit -p external-plugins/steering
BUN_BINARY="$HOME/.bun/bin/bun" node scripts/package-steering.mjs
npm install --prefix "$HOME/.local/share/opencode-steering" --ignore-scripts /absolute/path/dist/oneshot-opencode-steering-0.5.0.tgz
```

Configure the installed entry once, then restart OpenCode:

```json
{"plugin":["/absolute/path/node_modules/@oneshot/opencode-steering/dist/index.js"]}
```

Use either this standalone entry or the aggregate CodeAgent bridge. Separate configuration entries are not deduplicated. The sole function export is `SteeringPlugin`. Runtime dependencies are bundled. Exact public plugin peer/dev version is 1.3.17; the optional type-only peer is not needed at runtime. Packaging tests an actual offline installation with a newly created empty npm cache, matching archive/installed bytes, exports and private import boundaries.

## Request scope and fail-open behavior

Only effective user input observed during a known ordinary or summary request becomes pending. Effective means a non-ignored, non-synthetic nonblank text part (including native system-reminder normalization) or a file part with a nonempty URL. File-only input qualifies. Ordinary idle input is not retained. Sessions are isolated; no history is scanned during observation, transform, tool gates, streaming or status queries.

Each transform synchronously consumes **all** previous pending IDs. An ordinary transform containing an effective matching user ID gets one synthetic reminder: latest guidance takes priority, preserve completed results, report skipped obsolete actions. Original input and attachment content is unchanged. Subsequent requests do not repeat it. Missing IDs, filtered/empty edits and native overflow copies with new IDs are dropped. Compaction clears earlier pending and disables gates; summary requests get no reminder. Effective input arriving after the summary transform is still observed and can be consumed by the next ordinary request or become an idle recovery candidate. Empty, mixed-session or missing-session transforms invalidate all current associations and recovery candidates. Unknown requests, `steering_status` and all `prt_` call IDs pass. Ordinary model `task` calls still gate.

The request association relies on the pinned kernel's serial per-session loop. The shared mutable transform output may be changed by later plugins: load Steering **after plugins that transform user messages**. G1/G3 cover this hook's checkpoint, and do not prove the final provider payload. A later plugin can remove or reinsert content beyond Steering's observation.

There are no rejecting 128/256 capacity thresholds, fingerprints, call/assistant snapshots or compaction lineage. State grows with active sessions and current-request inputs, and clears at idle/error/cancel/delete/revert or the next transform. It is not a fixed byte bound. Restart discards observations. Failed/partial/slow native saves may cause brief gate rejection for the current request; the next transform consumes them and cannot leave a permanent gate. Save failure, filtering, edits, compaction, restart and plugin ordering may cause missed interception. No guarantee of never missing a stale call is made.

## One conditional continuation

Only `session.status(type=idle)` ends an active request. Deprecated `session.idle` is ignored. If unabsorbed busy-period input remains, after 75ms Steering makes one public `session.messages` read with a short timeout. The latest effective saved user must be a candidate, and appear in the returned history after the user referenced by the **last assistant's parentID, including a summary assistant**. For summaries, the parent is the native compaction trigger: guidance before that trigger is not recovered because native compaction filtering may have removed it. That assistant must have completed successfully; a last failed or unfinished assistant cannot be skipped. Unknown parent/order, missing parts, late saves, SDK failures or timeouts abandon recovery without retry.

Public status/get must confirm idle and no revert. A synthetic `promptAsync` references the original guidance ID without copying its contents, inheriting model, agent, system, variant and format, and omitting tools. Permissions stay native. Every await checks candidate identity. New input, transforms, another status-idle cancellation, errors, deletion, revert and compaction invalidate the permit. Any part update to a recovering candidate also invalidates it, even while history/status/get or control-save checks await SDK results; uncertain edits conservatively abandon recovery without another history query. Any same-session message/part deletion can abandon recovery because history order and the parent boundary may change, even when the deleted item is unrelated. The control rechecks status/get before save. Rejection recognizes only keys issued by this process for that session. Issued-key records expire 30 seconds after dispatch, separately from the 5-second permit; signed stale replays can be rejected within that window. Unknown, missing, cross-session or expired keys are treated as ordinary synthetic input and pass without validation SDK calls. Public plugin metadata alone cannot authorize rejection. A random token identifies their delayed errors so those errors cannot clear a new genuine request. Permits expire after 5 seconds. A 204 response acknowledges dispatch, without proving persistence or semantic adoption.

The saved continuation carries the original guidance ID and a short request to re-read and continue. At the first clear ordinary transform, Steering captures the current recovery candidate before invalidating its permit and matches effective user IDs together with active pending input. A match adds G3 temporarily to that request output. The checkpoint consumes these candidates once, including absent or ineffective IDs. The tool-result request receives zero G3 reminders. Cancelled, expired or otherwise invalidated candidates provide no reminder, and summary transforms consume candidates without adding G3.

Both standalone and aggregate entries forward this option:

```json
{"plugin":[["/absolute/path/dist/index.js",{"autoResume":false}]]}
```

**Active `noReply` input requires `autoResume:false`** because the public hook cannot distinguish it. This option also suppresses recovery history reads. There is no atomic cancel/dispatch/save transaction: cancellation not yet observed or after the last check can race with save. Late save after the single check requires manual continuation. The plugin never cleans up native revert.

`steering_status` shows request type, pending IDs and whether recovery is active, with provider/adopted always `unknown`. Best-effort observed/absorbed/blocked/continuing toasts may appear in another session's TUI; offline failures are ignored.

## Verification and evidence

```sh
export BUN_BINARY="$HOME/.bun/bin/bun"
node scripts/verify-steering.mjs
npm test
node scripts/check-kernel.mjs
node scripts/steering-v2-demo.mjs --out .codeagent/demo-headless
node scripts/steering-v2-demo.mjs --tui --out .codeagent/demo-tui
node scripts/steering-v2-demo.mjs --natural --tui --out .codeagent/demo-natural
```

Provide an official 1.3.17 binary at `~/.local/opencode-1.3.17/opencode` or via `OPENCODE_BINARY`; tests fail on missing/wrong versions. Deterministic tests run the real isolated server and local SSE fixtures, require no paid model and also run against the installed artifact. The AST/scanner effective-line assertion runs in `npm test` (pure type declarations/imports and comments excluded; mixed lines count).

Real demos require logged-in Codex CLI and tmux. Headless and ordinary TUI hold an unchanged real model tool decision before its gate. `--natural --tui` holds no response: the first tool sleeps 8 seconds before writing checkpoint.md, guidance is submitted directly in TUI while that native tool is running, and the next model response is natural. Both controls may correctly adopt the guidance; this is reported without claiming a difference. Demos retain screens, raw model requests/responses/JSONL, native messages, files, logs and per-case results. Existing output directories are archived on rerun, preventing stale artifact passes. `CODEX_BINARY`/`BUN_BINARY` select alternative executables.

The G1 boundary excludes tools that already passed the checkpoint, batch internals, StructuredOutput and native `prt_` subtask calls. Model semantic adoption is never guaranteed.

## Historical v2.0 guarantees intentionally removed

Version 0.4.0 used saved fingerprints, assistant/call snapshots, summary lineage and overflow replay association, repeated reminders, hard capacities and unknown-evidence blocking. Those guarantees no longer apply. v2.1 favors eventual ordinary-input/tool availability, deliberately accepting missed gates for uncertain evidence. Prior evidence remains historical; current design and results are indexed in [this run](../../docs/oneshot/runs/20261104-0553-steering-v21/README.md).

Change log: 2026-11-04 — v2.1/0.5.0, fail-open rewrite, parent-boundary continuation, natural TUI evidence and executable size check.

Change log: 2026-11-04 — DESIGN v1.2 review fixes: observe summary-period guidance, use the last assistant including summaries, invalidate edited recovery candidates after idle, and bound session-associated issued-control identity. Real-model demos are rerun by host formal verification.

Change log 2026-11-04 — DESIGN v1.3 moves recovered G3 into the first ordinary transform and keeps the saved continuation to its ID reference and short re-read request. Ordinary and summary G2 fixtures verify provider reminder counts of one then zero.
