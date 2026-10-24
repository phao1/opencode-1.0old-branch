# Steering 0.3.1 bounded synthetic continuation and native task compatibility

Target: OpenCode v1.3.17, fixed commit `517e6c9aa4c61dbc125e7654fc596f1d529f20d9`. This revision changes the earlier design assumption that all completion paths should remain pending. It does not alter ST-01..ST-08 or the kernel.

## Why continuation is needed

A successful `StructuredOutput` can break the active loop while later guidance is already saved. The kernel can also stop when a message generated earlier is persisted late: its user ID sorts before the just-finished assistant ID. Reusing that same user ID does not necessarily cross the exit condition. The independent native-ID/barrier probe in `scripts/probe-steering-late-save.mjs` demonstrated that a new synthetic control can start the next request while keeping the two real user messages and attachments intact. Feasibility is distinct from final installed-product verification.

## Public integration

| Behavior | Public surface | Evidence |
| --- | --- | --- |
| Observe incoming guidance | `chat.message` | The existing exact source fingerprint is recorded; no content is rewritten. This hook precedes save. |
| Establish current-process active observation | Normal `messages.transform` and `session.status` events | In-memory active/eligible sets are intentionally not restored from disk. |
| Confirm pending and successful termination | `session.messages`, `session.status` with directory and bounded timeouts | A latest completed non-summary assistant has no error; final finish is successful, or it has `structured` output. A busy/retry session does not dispatch. |
| Persist one attempt | Existing per-session serial ledger and atomic temp-file rename | Recovery key hashes exact pending IDs/fingerprints; any attempted source fingerprint is excluded from later automatic attempts. |
| Dispatch continuation | SDK `session.promptAsync` | One synthetic text part, no guidance content duplication, no `tools`, same session. No kernel-private import. |
| Check control before persistence | `chat.message` | An in-memory permit, lifecycle epoch, assistant, pending fingerprints and current idle state are checked again. |
| Record actual preparation | Existing per-assistant normal snapshot | Acknowledgment of prompt_async does not update provider/adoption evidence. |

`prompt_async` can acknowledge before its background `chat.message` executes. The permit is retained until that callback consumes it or a five-second expiry. HTTP submission is outside the serial ledger queue, preventing a reentrant-hook deadlock. The expiry releases only its own permit and rechecks newly eligible pending guidance from later turns. Already attempted source fingerprints remain excluded and are not retried. A late callback for the expired key is rejected without consuming a newer key's permit. The public async route broadcasts rejected hooks as `session.error`; a short-lived unpredictable token associates only this plugin's own suppression notification with the rejected control, preventing it from being mistaken for a new provider failure. Unrelated provider errors and cancellations retain their normal terminal handling.

## State and eligibility

`autoResume` defaults to true and may be set to false in plugin options. An eligible original guidance message must have been observed while this plugin process knew the session was active, still match its saved source fingerprint, and lack a matching normal-request preparation. Old recovered ledger entries alone never authorize dispatch.

A successful idle observation schedules a single 50 ms timer per session. The timer reloads public facts and checks the lifecycle epoch. Real user input, busy transitions, cancellation, failure and deletion invalidate scheduled work; cancellation/failure/deletion also clear eligible guidance. The synthetic control does not itself become new guidance or enter this eligibility set.

A recovery attempt contains:

- `key`, `assistantID`, `pending: [{messageID, fingerprint}]`, `attemptedAt`;
- `status`: `attempted`, `dispatched`, `suppressed` or `dispatch-unknown`;
- `controlMessageID` when the plugin observes its own control hook.

Attempts are persisted before dispatch. A write failure prevents dispatch. An ambiguous network response is retained as `dispatch-unknown` and is not retried. Duplicate events and changed batches cannot cause the same original ID/fingerprint to be attempted again. An additional newly observed guidance fingerprint can form a later bounded attempt.

## Control record and permissions

The control is a new user-role storage record, explicitly disclosed to users and tests. It has one part:

```json
{
  "type": "text",
  "synthetic": true,
  "text": "[Steering continuation] Re-read the original saved user guidance ...",
  "metadata": {
    "codeagentSteering": {
      "plugin": "@oneshot/opencode-steering",
      "kind": "continuation",
      "recoveryKey": "sha256-of-original-IDs-and-fingerprints"
    }
  }
}
```

The text references original message IDs and asks the model to read their existing content. It does not copy user guidance or attachments. The body uses the latest real user's `agent`, `model`, `system`, `format` and `variant`. `tools` is deliberately omitted: the pinned prompt path treats it as a session permission update. Existing permission state remains authoritative. Original user message IDs/parts and completed actions are not replayed or replaced.

## Boundaries and verification

There is no public atomic cancellation/resume compare-and-set. The final check can suppress cancellation already observed by the plugin; cancellation after that checkpoint can race with kernel persistence or loop start. No exactly-once, strict expected-turn admission, infinite delivery retry, or automatic recovery after restart is claimed. Already-running tools and batch-internal calls retain the preexisting checkpoint limits.

Production `provider` and `adopted` remain unknown. `dispatched` proves only HTTP acknowledgment, and `controlMessageID` is observed before its save. Saved source content and normal assistant preparation remain distinct evidence. Actual provider receipt and model adoption require independent request/output/action artifacts.

Component tests cover successful idle and StructuredOutput continuation, duplicate events, literal synthetic marker, metadata/permission-field preservation, async ACK preceding hook, cancellation before timer/after dispatch, busy/error/delete suppression, new input/prepared suppression, disabled recovery, network-unknown no retry, process restart, missing completion/evidence, concurrent guidance eligibility, expiry followed by new-turn pending, and a late old callback while a newer permit exists. These are component evidence only. Final acceptance requires the installed 0.3.1 archive's real-kernel lifecycle/late-save/permission and real-model recovery reports, matching its exact package SHA.

## Native SubtaskPart checkpoint

Independent code review and a real fixed-kernel comparison found that 0.3.0 blocked native `/review` even without guidance. The pinned `handleSubtask` branch runs before normal `messages.transform`, persists a tool part with its own `callID`, then supplies the tool part's `id` as the public before hook's `callID`. The ordinary model-call association and snapshot requirements therefore cannot describe this branch.

The 0.3.1 gate first attempts its existing ordinary call-ID association. Only when no such owner exists, and only for `task`, it checks a unique saved running tool part whose `id` equals the hook ID and whose separate `callID` differs. Its unfinished non-summary assistant must point to a unique parent user with a unique `SubtaskPart` whose prompt, description, agent and optional command exactly equal the saved tool input; the assistant's agent must match. Missing or ambiguous association still fails closed. Ordinary model-generated `task` calls retain the per-assistant normal snapshot gate.

This native branch has no normal snapshot. It may pass only if evidence is available, every observed effective real user input has confirmed saved parts, and every such input has matching normal preparation or completed-history baseline. Any pending text/file input blocks with `STEERING_STALE_CONTEXT`; incomplete/unknown saved evidence blocks with `STEERING_EVIDENCE_UNAVAILABLE`. The only success evidence added is the `native-subtask-checkpoint-passed` diagnostic with assistant and hook IDs. No normal `prepared` entry or snapshot is manufactured, and provider/adoption fields remain unknown.

A pure subtask command is supported under those conditions. A mixed `SubtaskPart` plus pending parent text or files is deliberately blocked: the native TaskTool forwards only the subtask prompt and does not attach the parent files or text to its child request. Guidance should be prepared in a normal model turn before invoking the command, or the standalone command should be run in a new session. An exception in this native before hook sits outside the kernel's task error handler and can leave its tool part `running` with an unfinished assistant. Automatic continuation does not repair that state. An ordinary follow-up is subject to native recovery behavior and can encounter the pending subtask again; the public plugin API supplies no safe transaction to complete it or declare its parent inputs read.

Component coverage includes native dispatch without any normal preparation, normally prepared/completed historical input, pending mixed text/file input, newly saved guidance, unsaved/partial/changed sources, read/write failure, ambiguous/mismatched native associations, and normal model-generated `task` snapshot enforcement. Installed-artifact verification must additionally exercise the actual native `/review` command, covered historical input, pending mixed text/files, and an ordinary stale model task on the fixed kernel. Component success alone is not that evidence.
