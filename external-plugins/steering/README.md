# @oneshot/opencode-steering 0.3.1

A standalone public-API plugin for OpenCode v1.3.17, pinned commit `517e6c9aa4c61dbc125e7654fc596f1d529f20d9`. It records message evidence, schedules bounded synthetic continuation after successful completion leaves active-turn guidance pending, and prevents a tool that has not passed its execution checkpoint from acting on an older assistant context after new user guidance has been saved.

The package bundles its public runtime dependencies. It does not need the one-shot worker, this development repository, or imports from private kernel modules. It exports one plugin function for the pinned legacy plugin loader.

## Install

Build the archive from the development checkout:

```sh
npm run package:steering
```

This creates `dist/oneshot-opencode-steering-0.3.1.tgz` and `dist/steering-package-report.json`. The report includes the archive SHA256, npm integrity, clean installation path and entry-module check. Packaging alone does not verify kernel behavior.

Install the archive in a dedicated directory:

```sh
mkdir -p "$HOME/.local/share/opencode-steering"
npm install --prefix "$HOME/.local/share/opencode-steering" --ignore-scripts /absolute/path/oneshot-opencode-steering-0.3.1.tgz
```

Add the installed entry's absolute path once to your OpenCode configuration. Replace `/home/me` with your actual home directory:

```json
{
  "plugin": [
    "/home/me/.local/share/opencode-steering/node_modules/@oneshot/opencode-steering/dist/index.js"
  ]
}
```

On macOS, the path normally starts with `/Users/your-name`. Restart OpenCode after changing its plugin configuration. Install either this standalone plugin or a CodeAgent bridge that already includes it; loading both would register duplicate behavior.

## Use in the current session

While work is running, submit ordinary guidance or explicitly prefix it with `steer:`:

```text
steer: Keep the work already completed. Change the next operation to use the revised target.
```

The original user message and its attachments stay in the same session. The plugin does not abort and replay the task, create a second session, elevate the message to a system instruction, or interpret shell/file markers in the text. A blank `steer:` without usable content is rejected.

A later ordinary tool call is checked against the particular assistant request that produced it. If guidance arrived after that request's context was prepared, the tool receives `STEERING_STALE_CONTEXT` before its implementation starts. The model can then read the guidance in the next request and choose the next action. Missing or ambiguous evidence fails closed with `STEERING_EVIDENCE_UNAVAILABLE`.

A tool already past the checkpoint may finish. There is no rollback, cancellation of an already-sent model request, or atomic `expected_turn_id` admission guarantee.

Native subtask commands such as `/review` dispatch before the normal model preparation hook. Version 0.3.1 recognizes only that pinned native path: the saved tool-part ID used by its hook, the distinct tool call ID, its assistant and parent user, and an exactly matching `SubtaskPart` prompt/description/agent/command. A pure native command can proceed when all effective real text/file inputs have complete saved evidence and were already normally prepared or belong to completed-history baseline. This checkpoint records `native-subtask-checkpoint-passed`; it does not create a normal snapshot or claim provider receipt. Ordinary model-generated `task` calls still require their own normal assistant snapshot.

Pending text or attachments block native dispatch, including text/files submitted alongside a `SubtaskPart`. The pinned native TaskTool forwards the subtask prompt, rather than the parent's text/files, so the plugin cannot claim those inputs were read. Prepare the intended guidance in a normal model turn before invoking a native command, or use a new session for a standalone command. If native dispatch is blocked, this kernel can leave its tool part `running` and its assistant unfinished because the before hook sits outside the native task's error handler. Automatic continuation does not repair that state; a follow-up remains subject to native session recovery and may encounter the same pending subtask. There is no public safe operation for this plugin to mark the native task completed or fabricate preparation.

## Inspect evidence

The read-only `steering_status` tool returns evidence for the current session. Its optional `messageID` argument filters one message; it cannot query another session. Tool availability follows the host's normal agent permissions.

The same JSON is written beneath `$XDG_STATE_HOME/codeagent-steering` (or `~/.local/state/codeagent-steering`). Hashed project/session names prevent message text from becoming a path. An optional plugin configuration can set the state root explicitly:

```json
{
  "plugin": [
    ["/absolute/path/node_modules/@oneshot/opencode-steering/dist/index.js", {
      "stateDirectory": "/absolute/path/steering-evidence"
    }]
  ]
}
```

Read the JSON files directly to inspect `sessionID`, `stateFile`, `messages`, `snapshots` and `diagnostics`. Each message distinguishes:

- `saved`: confirmed only after its persisted content is observed.
- `prepared`: assistant request IDs plus separate source/context fingerprints.
- `provider.status`: normally `unknown`; a public preparation hook cannot prove receipt by the provider.
- `adopted.status`: normally `unknown`; completing an assistant message cannot prove the model obeyed.
- `pendingReason`: why a saved message has not been prepared, including completion, cancellation, failure or unavailable evidence.

The verifier independently records actual provider payloads and tool execution. It does not change unknown production fields into successful delivery or semantic adoption claims.

## Completion boundary and recovery

Version 0.3 defaults to bounded automatic continuation. If a successful assistant finishes and the session is idle while guidance observed during this process's active run is saved but unprepared, the plugin waits briefly, rechecks public messages/status, persists an attempt, then calls the public `session.promptAsync` once. A completed `StructuredOutput` counts as successful even when its finish reason is `tool-calls`.

The continuation adds **one extra user-role storage record containing a synthetic control text**, marked with `parts[].synthetic: true` and `parts[].metadata.codeagentSteering`. It references the original guidance IDs; it does not copy their contents. Original user IDs, parts, attachments and completed work remain in place. The control copies the latest real user's agent/model/system/format/variant; it does **not** send `tools`, because that field can update session permissions in the pinned kernel.

Set `autoResume: false` to disable this behavior:

```json
{
  "plugin": [
    ["/absolute/path/node_modules/@oneshot/opencode-steering/dist/index.js", {
      "autoResume": false
    }]
  ]
}
```

Each eligible message fingerprint is attempted at most once by this process and recorded durably before dispatch. An unknown network outcome is not retried. Old pending messages are not automatically dispatched after restarting OpenCode. Cancelled, failed, deleted or busy sessions are skipped. A cancellation or new input observed before the synthetic `chat.message` persistence checkpoint suppresses the control. The public API has no atomic transaction with cancellation: a cancellation after the final check can still race with control persistence. This is not an exactly-once or atomic `expected_turn_id` guarantee.

`recovery.attempts` exposes the key, source IDs/fingerprints, original assistant ID, attempt time, `attempted`/`dispatched`/`suppressed`/`dispatch-unknown` status and observed control ID. `dispatched` means the public async endpoint acknowledged the request; it does not prove the control was saved or the provider received/adopted the guidance. The original messages' `prepared` evidence remains the separate normal-request checkpoint, and `provider`/`adopted` remain unknown without external evidence.

With recovery disabled or suppressed, the saved guidance remains queryable as pending. Explicit user continuation can still start another request. Same-message-ID wake experiments are not the production recovery mechanism: they cannot reliably cross the kernel's late-save ID termination condition.

## Verify the installed artifact

From the development checkout, with Node 24+, npm, Bun and a logged-in Codex CLI available:

```sh
node scripts/verify-steering.mjs --core-only
node scripts/verify-steering.mjs
```

`BUN_BINARY`, `KERNEL_ROOT`, and `CODEX_BINARY` may select installed executables/checkouts. `CODEX_BINARY` can point to an HTTP-only official CLI wrapper when the default transport is unavailable. Real CLI calls use fresh ephemeral read-only sessions, low reasoning, a 90-second limit, and only the actual kernel provider messages/tools. The model chooses its own tool arguments and final text; the harness controls only when a response is released.

`--core-only` tests the explicitly scoped core behavior, including a real-model relay run. The default full mode includes terminal/late-save recovery, permissions and restart coverage and exits nonzero when required evidence or original acceptance behavior fails. A source change is not a passing artifact result; inspect the final package SHA and case reports. `--deterministic-only` omits the real-model run and is explicitly protocol evidence only. `--use-package-report` reuses the exact clean installation in the existing package report; otherwise a fresh artifact is built and installed.

Results and raw evidence are retained under `.codeagent/steering-verification-*`, with an index in `dist/steering-verification-report.json`. Provider/model failures are failures; there is no fallback that fabricates a model decision. Check the reported artifact SHA before comparing runs.

## Upgrade or remove

To upgrade, install the new archive in the same dedicated directory and restart OpenCode. Keep or archive the existing state directory if its historical evidence is needed. To remove the plugin, remove its configuration entry, restart OpenCode, then optionally run `npm uninstall --prefix "$HOME/.local/share/opencode-steering" @oneshot/opencode-steering`. Removing the package does not remove kernel sessions or their messages.
