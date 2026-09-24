---
name: issue-triage
description: >
  Run the Issue Triage routine (2 of 5) — process the GitHub `triage` inbox (dedup, set priority,
  backfill Agent briefs, promote to Backlog) and groom the existing Backlog so `/next` always has
  clean, correctly-ranked work. Use when the scheduled "Issue Triage" routine fires, or when asked
  to triage the inbox or groom the board.
---

# Issue Triage (routine 2 of 5)

You keep the board clean so [`/next`](../../commands/next.md) always has good work to pull. The
run follows the [`issue-curator`](../issue-curator/SKILL.md) by about an hour and does two jobs:
(A) process the `triage` inbox, and (B) groom a batch of the Backlog (open issues with no state
label). `/next` ranks by priority label, so correct priorities are the main job in both. The run
is done when every inbox item is promoted or held with a reason, a Backlog batch is groomed, and
the [board-health report](#board-health-report) is written.

## Ownership: organize freely, destroy narrowly

The shared contract is
[`ROUTINES.md` → Shared ownership boundary](../../../docs/internal/ci-cd/ROUTINES.md#shared-ownership-boundary-all-routines)
and [→ Tracker access](../../../docs/internal/ci-cd/ROUTINES.md#tracker-access-shared-by-all-routines):
GitHub MCP only (stop and report if it's unavailable), Linear is retired, no product code. Triage
organizes the whole inbox, whoever filed it, but destroys only what agents own.

- **Organize (any `triage` item):** fill an absent priority label, add an `Estimate:` line,
  record `Blocked by #N`, attach to an epic where it clearly belongs, and promote to Backlog by
  removing `triage`. Never overwrite a priority a human set.
- **Destroy (`suggestion`-labeled only):** close as `not_planned`, mark `duplicate` with
  `duplicate_of`, or edit the body (including adding an Agent brief). Check `issue_read
  get_labels` for `suggestion` before each such write; if it's absent, skip and log. A
  human-filed item that looks wrong stays in triage with a comment for the human. One that only
  lacks an Agent brief isn't held: an absent brief reads as `depth:deep`.
- `issue_write`'s `labels` field replaces the whole set, so always send the union of the existing
  labels plus your change.
- Leave `in-progress` and `in-review` issues alone (claims and sweeps belong to `/next`), and
  `routine-state` issues too (routine infrastructure, never work). Leave `incident` issues'
  labels and priority alone, since the watchdog that filed one also closes it; a comment
  reporting what you found is fine, a provider change because an alert suggested it isn't.
- Never print secret values. The only repo write this routine makes is the
  [self-maintenance](#self-maintenance-update-yourself) PR.

**Reading before a body edit.** Start each run with the marker-count guard in
[`GITHUB_PM.md`](../../../docs/internal/ci-cd/GITHUB_PM.md#marker-count-guard-so-the-next-regression-surfaces-in-one-run).
Whether a body edit may be sourced from an MCP read is a measurement that has flipped before, not
a fixed fact: the table, the probe, and the fallback when it's red are in
[`GITHUB_PM.md` → Reading a body you intend to rewrite](../../../docs/internal/ci-cd/GITHUB_PM.md#reading-a-body-you-intend-to-rewrite-mcp-read-fidelity).
A brief backfill touches many bodies, so before one, re-run the probe against fixture #1736 and
record the result in the report. If a leg can't run (say, the direct REST read hits a rate limit),
say so rather than reporting an unqualified green. When the probe is red, add a
brief as a comment, or author the full replacement body yourself; never round-trip a body through
a lossy read to add a section.

`search_issues` is semantic, not a fetch by number. Query with distinctive words from the
target's title and confirm the returned `number` before using it.

## Pass A — the triage inbox

List every open issue labeled `triage`. For each:

1. **Dedup.** If it duplicates an open issue: when it's `suggestion`-owned, close it as
   `duplicate` with `duplicate_of` the canonical; otherwise leave it and comment the likely
   duplicate for a human.
2. **Prioritize.** Set a priority label `P1`–`P4` from impact; no issue leaves triage without
   one. A routine suggestion is usually `P3` or `P4`; `P2` is for genuine high impact (security,
   data loss, broken core flows). Optionally add an `Estimate: <fibonacci>` line when scope is
   clear.
3. **Agent brief.** On `suggestion`-owned items, add a missing `### Agent brief` (format in the
   [curator skill](../issue-curator/SKILL.md#agent-brief), field policy in
   [`GITHUB_PM.md`](../../../docs/internal/ci-cd/GITHUB_PM.md#agent-briefs-depth--model--ultracode)),
   and correct one that's mis-calibrated (a schema-touching change marked `skim`) or out of
   roster. Test each value against the roster (`depth:skim|standard|deep`, `model:fable|any`,
   `ultracode:yes|no`) rather than a list of known-bad spellings, since new ones keep appearing.
   Between two depths, pick the deeper. Deliver it in the body when the probe is green (the
   brief is a description section), and as a comment when it isn't, which `/next` also reads. Check for a correction a
   previous run already commented first ([comment once](#comment-once-not-once-per-run)).
4. **Blocked-by.** Record `Blocked by #N` where a dependency is obvious. `/next` reads blockers
   only from body lines ([`next.md`](../../commands/next.md) §0.2 condition 3 and §1.1), so a
   commented blocker doesn't stop the issue ranking as claimable.
   - On a body you may edit (one you authored this run, or a `suggestion`-owned body under step
     3's probe condition), write the line.
   - On a human-filed body, the ownership boundary bars the rewrite. Comment anyway, since a
     `/next` session reads it during verification, but list the issue in the report as needing
     an owner body edit. The comment doesn't fix it.
5. **Epic attach.** Attach it as a sub-issue when it clearly belongs to an open epic; otherwise
   leave it standalone.
   - Epics are titled both `[Epic] <name>` and `Epic: <name>`, and `has_children: true` is the
     structural check that doesn't depend on the title. Match all three. Which title form is
     canonical is the owner's call (#2189), not a routine's.
   - A child that names its parent (`Umbrella: #N`, `Epic: #N`) is evidence about #N even when #N
     has no epic title and no children yet. Attach on that claim: it flips `has_children`, which
     lets the `Fixes`-vs-`Part of` guard in
     [`GITHUB_PM.md`](../../../docs/internal/ci-cd/GITHUB_PM.md) stop a single-slice PR from
     closing the whole umbrella. Never infer an umbrella from topic similarity.
   - `sub_issue_write` takes the parent's `issue_number` and the child's `sub_issue_id`, which is
     its internal id, not its number. Get it from an `issue_write` result or `issue_read get`;
     `list_issues` doesn't return it.
6. **Promote or hold.**
   - `suggestion`-owned, or clearly well-formed and actionable: remove `triage`.
   - Human-action holds: a `[pr-followup][human]` or bare `[human]` title prefix, or a body
     opening with `**Human action required — hold in triage`. Never promote these, because
     `/next` can't do the work. Leave them in triage, touching only priority and estimate. The
     [`pr-followups`](../pr-followups/SKILL.md) routine owns their lifecycle (`fp=pr-followup/`,
     `fp=human/`). Never add `suggestion` yourself. It hands an issue to the routines (it's what
     lets PR Follow-ups close it and any routine re-body it), and nothing you can read tells you
     whether the label was omitted or the owner removed it to take the item over: agents file
     through the MCP as the owner, and label history isn't exposed. List `[human]` items that lack
     it in the report, noting whether the body carries an agent `fp=` marker, so the owner can
     adopt or close them.
   - Ambiguous, under-specified, or a significant human decision: leave it in triage with a short
     comment on what's needed. Don't force-promote work a human should accept.

## Pass B — Backlog grooming

Groom about 25 Backlog issues per run, oldest-groomed first, so successive runs cover the whole
Backlog. Much of the `suggestion` backlog lands unprioritized, and a correct priority is what
keeps real work from being buried under suggestions in `/next`.

- **Priority:** set one on any `suggestion`-owned issue missing it, and fix obviously wrong ones,
  with the same calibration as Pass A step 2.
- **Agent briefs:** backfill and correct them on `suggestion`-owned issues, under the same rules
  as Pass A step 3 (probe before a body-edit backfill, comment once).
- **Epics:** attach a suggestion only when it unambiguously belongs to the epic's scope. Most
  suggestions stay standalone, and that's correct: general, cross-cutting, infra, or speculative
  work doesn't belong under an epic, and force-bucketing to clear the pile hides it. You may
  detach a `suggestion`-owned issue from an epic it doesn't fit.
- **Estimate:** an optional `Estimate:` line when scope is clear.
- **Stale and duplicates:** add `stale` to obviously aging suggestions the curator missed. Close
  or dedup only `suggestion`-owned issues, and only with proof. Never mark a `scope:production`
  issue `stale` or raise its priority for age; those are parked by owner decision (see the roster
  in ROUTINES.md).
- **Ownership:** on human and planning issues in the Backlog, only fill an absent priority. Don't
  re-bucket, re-prioritize, close, or re-body them, and don't restructure epics.

## Comment once, not once per run

[`ROUTINES.md` rule 6](../../../docs/internal/ci-cd/ROUTINES.md#shared-ownership-boundary-all-routines)
is the canonical statement, and it binds every comment this routine writes: holds, brief
corrections, Blocked-by notes, and their Pass B equivalents. Before commenting, read the issue's
comments (`issue_read get_comments`). If a standing comment already says it and is still
accurate, stay silent and surface the re-handle in the report. The MCP can't edit comments, so
the only choices are posting again or staying silent.

The rule is "don't restate what stands", not "don't comment again". A standing correction is
already in force, because `/next` reads it. Restating it buries the comments that carry real
content, and each repeat bumps `updated_at`, which skews Pass B's oldest-groomed-first order.
When you do have something new (a new blocker, another affected call site), post it, lead with
the new part, and reference the standing comment instead of re-deriving it. Narrowing a standing
point into one question the owner can answer in a reply also counts as new. Holding back a
genuinely new blocker to avoid a second comment is the worse failure.

## Self-maintenance (update yourself)

At the end of the run, check this file and the shared config in
[`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md) against the live repo: label roster,
links, tool names. Act on drift at most once per run, under the contract in
[`ROUTINES.md` → Self-maintenance](../../../docs/internal/ci-cd/ROUTINES.md#self-maintenance-the-update-themselves-contract),
which sets the allowed paths and limits: mechanical drift gets the docs-only PR, and
judgment-laden drift gets a `suggestion` (`area:docs`).

## Board-health report

This runs unattended. Work through both passes without stopping to summarize or offer options,
and put any status note in the same message as your next tool call. End the run when the inbox
and the Backlog batch are done, or when nothing more can move (the GitHub MCP is unavailable, or
the marker-count guard failed and body writes are off). A run that only organizes and holds is
still a success. The final message is this report, which the routine surfaces to the maintainer:

- Marker-count guard result, and the probe result if you edited bodies (noting any leg you
  couldn't run).
- Inbox: items processed, promoted, and held, with a one-line reason per hold.
- Backlog: batch size, priorities set or corrected, briefs backfilled.
- Blockers you could only comment, listed as needing an owner body edit.
- Anomalies you didn't act on: `in-progress` issues that look abandoned (the sweep is `/next`
  §0.7's job), human-filed items waiting on a decision, suspected duplicates across the ownership
  boundary.
- For the curator: the open-`suggestion` count, and whether consolidation mode (more than 40)
  binds.
