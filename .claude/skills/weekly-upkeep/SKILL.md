---
name: weekly-upkeep
description: >
  Run the Weekly Upkeep routine (3 of 3): once a week, fix one hygiene theme in the code
  (hygiene-scan), except on the first Wednesday of the month, which sweeps a slice of the docs
  (docs-upkeep) instead; open at most one PR and never a second while one is open. Use when the
  scheduled "Weekly Upkeep" routine fires.
---

# Weekly Upkeep (routine 3 of 3)

Docs Upkeep and the Hygiene Scan share one weekly slot. Hygiene runs every week except the first
Wednesday of the month, which sweeps the docs ([ADR-16](../../../spec/architecture/adr/adr-16.md)
amendment 11 has the history and why). The phase's skill owns the work; this skill owns which one
runs, the slice each phase reads, the open-PR rule, and the record.

## This week's job and slice

```bash
W=$(( $(date -u +%s) / 604800 ))             # weeks since the epoch; each starts Thursday 00:00 UTC
WED=$(( W * 604800 - 86400 ))                 # that week's Wednesday, the day of its scheduled fire
DAY=$(date -u -d "@$WED" +%-d)
MON=$(( $(date -u -d "@$WED" +%Y) * 12 + $(date -u -d "@$WED" +%-m) ))
if [ "$DAY" -le 7 ]; then echo "docs group=$(( MON % 5 ))"
else echo "hygiene group=$(( ((W - MON) % 5 + 5) % 5 ))"; fi
```

- `docs`: the fire's Wednesday is the first of its month (day 7 or less). Follow
  [`docs-upkeep`](../docs-upkeep/SKILL.md) and sweep the printed group.
- `hygiene`: any later Wednesday. Follow [`hygiene-scan`](../hygiene-scan/SKILL.md) and read the
  printed group.

Everything comes from the scheduled fire, not the moment the command runs. The Wednesday 23:07 ET
fire is already Thursday in UTC, and the week rolls over at Thursday 00:00 UTC, so a run that
starts hours late, or a manual re-run any time before the next Wednesday evening, gets the same
phase and group. A manual run on a Wednesday before 00:00 UTC lands in the previous week's job.
All of it is UTC, so it needs no time-zone data. `%-d` and `%-m` are GNU `date`, unpadded, so the
arithmetic works in any shell without `10#`.

The docs group counts months since year zero, so it steps by one each month straight through New
Year and each docs group comes round every five months. The hygiene group counts weeks minus
months, which steps by one per hygiene run and not at all across the docs week, so each hygiene
group is read every fifth hygiene run, five to seven weeks apart. Both are checked over 2026–2031.

## One upkeep PR at a time

Before starting, list open PRs from `claude/docs-upkeep-*` and `claude/hygiene-scan-*` branches.
If one is open, whichever kind it is, don't open another: service it instead (merge `main` if it is
behind and conflicts, fix a failure your earlier run's change caused, answer review threads), then
do the phase's read-only part (the docs phase lists what it would fix; the hygiene phase runs its
lenses and writes its ledger) and end. This is the rule `hygiene-scan` §0.5 already applies to
itself, now covering both.

Hygiene opens most weeks and docs only monthly, so a hygiene PR still open on a first Wednesday
turns that month's docs run read-only, and its group waits five months for its next sweep. That
cost is accepted rather than letting two upkeep PRs pile up on the owner, who merges most PRs the
day they go green. Name it in the report's first line ("Docs sweep blocked by #N") so he sees it.

Inside the phase its skill wins, with three exceptions that this skill owns: the one-upkeep-PR rule
above (neither phase's own check sees the other kind's PR), the slice group printed above, and the
phase posts no run record of its own.

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
