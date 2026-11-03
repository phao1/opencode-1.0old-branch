# Host verification evidence

2026-11-04: DESIGN v1.3 / Generator round 4 final formal checks 8/8 PASS; root tests 113/113; installed tests 44/44 (29 unit + 15 official kernel). Fixed kernel tracked source is clean. Timing derived independently from current native messages. Previous demo outputs are preserved in adjacent archive directories; v1.2 formal logs are historical in [v1.2](v1.2/RESULT.md).

| Mode | Plugin | Passed | Obsolete written | Stale calls blocked | Requests | First tool ms | Guidance during first tool |
| --- | --- | --- | --- | --- | --- | --- | --- |
| headless | disabled | true | true | 0 | 4 | 2 | false |
| headless | enabled | true | false | 1 | 4 | 4 | false |
| tui | disabled | true | true | 0 | 4 | 3 | false |
| tui | enabled | true | false | 1 | 4 | 4 | false |
| natural-tui | disabled | true | false | 0 | 3 | 8008 | true |
| natural-tui | enabled | true | false | 0 | 3 | 8005 | true |

Natural controls both adopted guidance and skipped obsolete.md. Held-decision controls demonstrate stale-call interception. No natural timing behavioral advantage is claimed.

Review round 2 G2 reminder regression is separately proven with official kernel provider requests: ordinary 0→1→0, summary 0→0→1→0, saved controls contain zero complete reminders; see [round 4 report](../impl/round-4/implementation-details.md).

Logs are retained as .txt files beside ignored CLI .log files. [Result](RESULT.md) / [Raw timing](HOST-EVIDENCE.json).
