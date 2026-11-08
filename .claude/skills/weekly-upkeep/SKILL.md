---
name: weekly-upkeep
description: >
  Run the Weekly Upkeep routine (3 of 3): once a week, alternating weeks, either sweep a
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
echo $(( $(date -u +%s) / 604800 % 2 ))
```

- `1`: follow [`docs-upkeep`](../docs-upkeep/SKILL.md).
- `0`: follow [`hygiene-scan`](../hygiene-scan/SKILL.md).

That is whole weeks since the Unix epoch, which start on Thursday 00:00 UTC, just before the
scheduled fire (Wednesday 23:07 ET is Thursday in UTC). It counts straight through New Year, where
ISO week numbers don't: 2026 has a week 53, so ISO-week parity would run the same phase twice in a
row. A manual run before Thursday 00:00 UTC lands in the previous week and gets the other phase.
Both skills derive their own slice from the calendar, and stepping 14 days still walks every one
of their five groups (docs-upkeep's New Year skew aside).

## One upkeep PR at a time

Before starting, list open PRs from `claude/docs-upkeep-*` and `claude/hygiene-scan-*` branches.
If one is open, whichever kind it is, don't open another: service it instead (merge `main` if it is
behind and conflicts, fix a failure your earlier run's change caused, answer review threads), then
do the phase's read-only part (the docs phase lists what it would fix; the hygiene phase runs its
lenses and writes its ledger) and end. This is the rule `hygiene-scan` §0.5 already applies to
itself, now covering both.

Inside the phase its skill wins, with two exceptions that this skill owns: the one-upkeep-PR rule
above (neither phase's own check sees the other kind's PR), and the phase posts no run record of
its own.

## Telling the owner

The owner reads the run's final message in the *Frapp scheduled tasks* session, so the ping is
its first line. When the run opens a PR, that line is the PR link and its one-sentence theme. He
merges it without being asked, so don't phrase it as an ask. A **Needs you** item from the phase's
report goes right under it. With neither, the first line is "Nothing needs you this run."

**Connectors.** The session holds every connector the owner has, write tools included. Use Sentry,
Supabase, Vercel, Render and PostHog for reads only, and never call Stripe, Gmail, Resend or any
messaging connector.

## How the run ends

The phase's own ending rules apply. Your last tracker write is the
[run record](../../../docs/ci-cd/routines.md#run-record-all-routines), `routine=weekly-upkeep`,
with the outcome the phase's skill would have given its own record (`stopped` when a push, the
pre-push hook or the sandbox bringup ended it early). Its second line names the phase, as
`docs-upkeep:` or `hygiene-scan:`, then what happened. The final message is the phase's run
report, under the first line above.
