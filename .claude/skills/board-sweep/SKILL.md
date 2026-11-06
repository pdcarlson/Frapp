---
name: board-sweep
description: >
  Run the Board Sweep routine (2 of 3): once a week, in one session, harvest what last week's PRs
  left for a human (pr-followups), maintain the agent-owned suggestions and file a few new ones
  (issue-curator), then prioritize the triage inbox and groom a Backlog batch (issue-triage), and
  tell the owner only about decisions waiting on him. Use when the scheduled "Board Sweep" routine
  fires, or when asked for the weekly tracker pass.
---

# Board Sweep (routine 2 of 3)

Until 2026-11-06 three routines did this on their own schedules: PR Follow-ups (weekly), the Issue
Curator (weekly) and Issue Triage (daily). Triage had made no writes for weeks, because the inbox
is almost all the owner's own holds, so the three now run once a week as phases of one session
([ADR-16](../../../spec/architecture/adr/adr-16.md) amendment 11). Each phase's skill still owns
how that job is done. This skill owns the order, the one run record, and what reaches the owner.

## The phases, in order

The order matters: each phase files what the next one sorts.

1. **PR follow-ups**: follow [`pr-followups`](../pr-followups/SKILL.md) (audit, harvest, publish
   the Human Action List).
2. **Curate**: follow [`issue-curator`](../issue-curator/SKILL.md). Maintenance takes at most
   about 30 `suggestion` issues per run, oldest-touched first; discovery keeps its budget.
3. **Triage**: follow [`issue-triage`](../issue-triage/SKILL.md), Pass A (the inbox, including
   what phases 1 and 2 just filed) and Pass B (a Backlog batch of about 50).

Inside a phase, its skill wins, with three exceptions that this skill owns:

- **One run record.** A phase posts no run record of its own; the record at the end of this run
  covers all three.
- **One self-maintenance PR.** Collect mechanical drift from every phase and open at most one
  docs-only PR for the whole run, on the
  [self-maintenance allowlist](../../../docs/ci-cd/routines.md#self-maintenance-the-update-themselves-contract).
- **One report.** Each phase's report becomes a section of the run report below.

The marker-count guard and the fidelity probe are run once, before the first body write, and bind
every phase. A guard failure turns body writes off for the whole run.

When the run is running out of budget, finish the phase you're in and skip the rest: a skipped
phase is named in the report and the record's second line, and next week's run starts with it.

## Telling the owner

The owner wants a ping only for a real decision. Post to him (in the Frapp project thread this
routine reports into, with the chat tool the session has) only when the run found at least one of:

- a new `[human]` or `[pr-followup][human]` item filed this run;
- an owner decision a phase can't make (a spec-vs-code contradiction, a priority he set that looks
  wrong, a blocked epic).

List each one with its issue link and the one-line question, at most about eight lines, with the
most urgent first. Don't list PRs waiting to merge: he merges everything anyway. When nothing needs
him, post nothing.

## How the run ends

Work through the phases without stopping to summarize; put any status note in the same message as
your next tool call. Your last tracker write is the
[run record](../../../docs/ci-cd/routines.md#run-record-all-routines), `routine=board-sweep`:
`done` when every phase ran, or a phase was skipped for budget (name it on the second line);
`stopped` when the marker-count guard failed or nothing could run. With the GitHub MCP unavailable
there is no record to post, and none is posted any other way.

The final message is the run report: a **Needs you** line first (count and the top three), then
one section per phase in the shape its skill specifies, then the self-maintenance PR if any.
