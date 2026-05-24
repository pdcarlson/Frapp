# Redesign chunk status

Update this file at each state transition: when you start a chunk (`not started` → `in progress`), when you open the PR (`in progress` → `in review`), and when it merges (`in review` → `shipped`). One row per chunk; keep the table compact.

| #   | Title                                          | Branch                                          | State        | PR    | Notes |
| --- | ---------------------------------------------- | ----------------------------------------------- | ------------ | ----- | ----- |
| 01  | Foundation                                     | `claude/redesign-chunk-01-foundation-kWOsy`     | shipped      | [#229](https://github.com/pdcarlson/Frapp/pull/229) | Tailwind `content` glob fix (added `./components/**`) landed here; `--font-mono` is a deliberate system stack (no Geist Mono); `/home` route left reachable, deletion deferred to Chunk 03. |
| 02  | Data model + Edge Function scaffold            | `claude/redesign-chunk-02-data-edge-MhyoA`      | shipped      | [#231](https://github.com/pdcarlson/Frapp/pull/231) | Runtime verification (db reset / curl / fn idempotency) BLOCKED in sandbox — see [#235](https://github.com/pdcarlson/Frapp/issues/235). Blockers for Chunk 04: [#233](https://github.com/pdcarlson/Frapp/issues/233) + [#234](https://github.com/pdcarlson/Frapp/issues/234) (Edge Function auth bypass). Follow-ups: [#236](https://github.com/pdcarlson/Frapp/issues/236); data [#232](https://github.com/pdcarlson/Frapp/issues/232). |
| 03  | Onboarding wizard                              | `claude/redesign-chunk-03-onboarding-ARrq1`     | in progress  | —     | Branch from main; replaces `chapter-bootstrap`, deletes dead `/home` route. |
| 04  | Chat foundation + hot-path client              | `claude/redesign-chunk-04-chat-foundation`      | not started  | —     |       |
| 05  | Chat integrations + push                       | `claude/redesign-chunk-05-chat-integrations`    | not started  | —     |       |
| 06  | Settings shell + Org + Modules                 | `claude/redesign-chunk-06-settings-shell`       | not started  | —     |       |
| 07  | Settings customization                         | `claude/redesign-chunk-07-settings-custom`      | not started  | —     |       |
| 08  | Settings Beta + Audit + nudges                 | `claude/redesign-chunk-08-settings-beta-audit`  | not started  | —     |       |
| 09  | Members directory + custom fields              | `claude/redesign-chunk-09-members`              | not started  | —     |       |
| 10a | Ops: Events                                    | `claude/redesign-chunk-10a-events`              | not started  | —     |       |
| 10b | Ops: Tasks                                     | `claude/redesign-chunk-10b-tasks`               | not started  | —     |       |
| 10c | Ops: Points                                    | `claude/redesign-chunk-10c-points`              | not started  | —     |       |
| 10d | Ops: Dues / Billing                            | `claude/redesign-chunk-10d-dues`                | not started  | —     |       |
| 10e | Ops: Rush / Recruitment / Intake               | `claude/redesign-chunk-10e-rush`                | not started  | —     |       |
| 10f | Ops: Backwork                                  | `claude/redesign-chunk-10f-backwork`            | not started  | —     |       |
| 10g | Ops: Reports                                   | `claude/redesign-chunk-10g-reports`             | not started  | —     |       |
| 10h | Ops: Onboarding pathway                        | `claude/redesign-chunk-10h-onboarding-pathway`  | not started  | —     |       |
| 11  | Mobile chat parity                             | `claude/redesign-chunk-11-mobile-chat`          | not started  | —     |       |
| 12  | Marketing site refresh                         | `claude/redesign-chunk-12-marketing`            | not started  | —     |       |

States: `not started` → `in progress` (branch exists, work underway) → `in review` (PR open) → `shipped` (merged to main).
