---
name: weekly-upkeep
description: >
  Run the Weekly Upkeep routine (3 of 3): once a week, alternating by ISO week, either sweep a
  slice of the docs (docs-upkeep) or fix one hygiene theme in the code (hygiene-scan), opening at
  most one PR and never a second while one is open. Use when the scheduled "Weekly Upkeep" routine
  fires.
---

# Weekly Upkeep (routine 3 of 3)

Until 2026-11-06 Docs Upkeep ran weekly and the Hygiene Scan daily. The scan opened one PR in a
month and then sat behind it, so the two now share one weekly slot and alternate
([ADR-16](../../../spec/architecture/adr/adr-16.md) amendment 11). The phase's skill owns the work;
this skill owns which one runs, the open-PR rule, and the record.

## This week's job

```sh
V=$(date -u +%V); echo $(( 10#$V % 2 ))
```

- `0` (even ISO week): follow [`docs-upkeep`](../docs-upkeep/SKILL.md).
- `1` (odd ISO week): follow [`hygiene-scan`](../hygiene-scan/SKILL.md).

`-u` keeps a manual re-run on the scheduled answer, and `10#` stops `08` and `09` parsing as octal.
Both skills derive their slice from the calendar, and stepping two weeks (or 14 days) still walks
every one of their five groups.

## One upkeep PR at a time

Before starting, list open PRs from `claude/docs-upkeep-*` and `claude/hygiene-scan-*` branches.
If one is open, whichever kind it is, don't open another: service it instead (merge `main` if it is
behind and conflicts, fix a failure your earlier run's change caused, answer review threads), then
do the phase's read-only part (the docs phase lists what it would fix; the hygiene phase runs its
lenses and writes its ledger) and end. This is the rule `hygiene-scan` §0.5 already applies to
itself, now covering both.

Inside the phase its skill wins, except that the phase posts no run record of its own.

## Telling the owner

When the run opens a PR, post one line to the owner (in the Frapp project thread this routine
reports into, with the chat tool the session has): the PR link and its one-sentence theme. He
merges it without being asked, so don't phrase it as an ask. Post nothing when there is no PR,
unless the phase's report has a **Needs you** item, which goes in the same short post.

## How the run ends

The phase's own ending rules apply. Your last tracker write is the
[run record](../../../docs/ci-cd/routines.md#run-record-all-routines), `routine=weekly-upkeep`,
with the outcome the phase's skill would have given its own record (`stopped` when a push, the
pre-push hook or the sandbox bringup ended it early). Its second line names the phase, as
`docs-upkeep:` or `hygiene-scan:`, then what happened. The final message is the phase's run
report.
