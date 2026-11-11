---
name: weekly-upkeep
description: >
  Run the Weekly Upkeep routine (3 of 3): once a week, fix one hygiene theme in the code
  (hygiene-scan), except on the first Wednesday of the month, which sweeps a slice of the docs
  (docs-upkeep) instead; open at most one PR and never a second while one is open. Use when the
  scheduled "Weekly Upkeep" routine fires.
---

# Weekly Upkeep (routine 3 of 3)

Until 2026-11-06 Docs Upkeep ran weekly and the Hygiene Scan daily. The scan opened one PR in a
month and then sat behind it, so the two came to share one weekly slot, alternating
([ADR-16](../../../spec/architecture/adr/adr-16.md) amendment 11). On 2026-11-11, after Shawn asked
for regular code cleanup back, the owner gave the code the larger share: four people merge every
day, so hygiene debt builds weekly. The phase's skill owns the
work; this skill owns which one runs, the open-PR rule, and the record.

## This week's job

```sh
D=$(TZ=America/New_York date +%d); [ $(( 10#$D )) -le 7 ] && echo docs || echo hygiene
```

- `docs`: the first Wednesday of the month (its day of the month is 7 or less). Follow
  [`docs-upkeep`](../docs-upkeep/SKILL.md).
- `hygiene`: every later Wednesday (day 8 or more). Follow [`hygiene-scan`](../hygiene-scan/SKILL.md).

The day comes from the Eastern date, the zone the task is scheduled in, because the Wednesday
23:07 ET fire is already Thursday in UTC, and a UTC day could tip the 7th into the 8th. `%d` is
zero-padded, so parse it base 10 (`10#$D`), or `08` and `09` fail as octal. A manual run on another
day uses the same rule: in the first seven days of the month it sweeps docs. Both phase skills
derive their own slice from the calendar: the hygiene slice steps two groups a week, so five
weekly runs still read all five groups, and the docs slice comes from the month.

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
