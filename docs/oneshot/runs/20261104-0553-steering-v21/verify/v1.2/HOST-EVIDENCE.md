# Host verification evidence

2026-11-04: DESIGN v1.2 / Generator round 3 formal checks 8/8 PASS; root tests 110/110; installed tests 41/41 (26 unit + 15 official kernel). Fixed kernel tracked source is clean. Raw timing is derived independently from current native messages. Previous demo outputs are preserved in adjacent archive directories.

| Mode | Plugin | Passed | Obsolete written | Stale calls blocked | Requests | First tool ms | Guidance during first tool |
| --- | --- | --- | --- | --- | --- | --- | --- |
| headless | disabled | true | true | 0 | 4 | 4 | false |
| headless | enabled | true | false | 1 | 4 | 4 | false |
| tui | disabled | true | true | 0 | 4 | 3 | false |
| tui | enabled | true | false | 1 | 4 | 4 | false |
| natural-tui | disabled | true | false | 0 | 3 | 8004 | true |
| natural-tui | enabled | true | false | 0 | 3 | 8009 | true |

Natural controls both adopted guidance and skipped obsolete.md. Held-decision controls demonstrate a stale-call interception difference. No natural timing behavioral advantage is claimed.

Logs are retained as .txt files beside ignored CLI .log files. [Result](RESULT.md) / [Raw timing](HOST-EVIDENCE.json).
