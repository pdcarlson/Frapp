---
name: hygiene-sweep
description: >
  Scan the codebase for duplicated logic and hygiene drift, then actually fix a bounded batch of
  the safest findings instead of only reporting them — verify, commit, push, and open a PR for
  human review. Use when the scheduled "Hygiene Sweep" task fires, or when asked to sweep the
  codebase for duplication/cleanup and implement fixes (not just report on them).
---

# Hygiene Sweep

You are running an unattended, scheduled pass over the codebase looking for duplicated logic and
hygiene drift — and, unlike a plain audit, this routine's job is to **fix what it safely can**, not
just describe it. Nobody is watching this run live; the way it reaches a human is the PR it opens.

## This is not one of the four ROUTINES.md routines

`docs/internal/ci-cd/ROUTINES.md` binds Issue Curator, Issue Triage, PR Follow-ups, and Docs Upkeep
to a hard **"never modify product code, never open feature PRs"** rule, specifically so unattended
runs never land unreviewed code changes. This skill is a deliberate, explicit exception the repo
owner asked for — it exists precisely to open product-code PRs autonomously. That makes the
guardrails below load-bearing, not optional: this routine earns the right to touch product code by
being conservative about what it touches and always landing in a human-reviewed PR, never merged by
the routine itself.

If you are ever tempted to loosen these guardrails "just this once" because a finding looks
obviously right, don't — the discipline is the point.

## What this run does, in order

1. **Scan.** Run the code-quality workflow from the [`audit`](../audit/SKILL.md) skill (DRY,
   naming, dead code, architecture-layer compliance) across the workspaces — delegate to parallel
   Explore/general-purpose agents per app area (`apps/api`, `apps/web`+`apps/landing`,
   `apps/mobile`+`packages/`) for a repo this size. Ask each for concrete, high-confidence findings
   only — file:line, a short excerpt, a proposed fix — not speculative ones.

2. **Select a bounded batch.** From the findings, pick only the ones that are:
   - **Mechanical** — extracting an identical, already-duplicated block into a shared helper;
     fixing an architecture-layer import violation; deduping identical JSX/logic. Not a redesign,
     not a new abstraction speculatively covering future cases.
   - **Low blast radius** — a handful of call sites, not a codebase-wide rewrite. A finding that
     recurs 100+ times (e.g. one repeated 3-line error-unwrap block across 37 files) is real but is
     its own dedicated changeset — file it as a follow-up issue instead of taking it on inline.
   - **Verifiable** — there's an existing test, type-check, or lint pass that can confirm no
     behavior changed.

   Aim for roughly 5-10 fixes per run, spread across areas if the findings support it. Fewer,
   verified fixes beat a larger, riskier batch. Zero fixes because nothing safe enough was found is
   a fine outcome — never force a fix to have something to show.

3. **Implement and verify.** Parallelize by app area (disjoint files, same working tree, no
   `isolation: worktree` needed). Each implementer must run the relevant workspace's
   `check-types`/`lint` and any directly-relevant existing tests, and report back a clear diff
   description — not just "done."

4. **Review before pushing — the repo's own gate.** This repo's pre-push hook blocks a push until
   `/diff-review` (or `/code-review`) has run against the diff and left its marker. Do not treat
   this as a formality: launch the full finder → verify → fix-or-file cycle from
   [`diff-review`](../diff-review/SKILL.md). A routine that writes its own code and skips
   independent review of that code is exactly the failure mode the four-routine product-code ban
   exists to prevent — this skill's entire license to touch product code rests on that review
   actually happening, every run.

5. **File follow-ups for what you didn't fix inline.** Larger, riskier, or design-decision-requiring
   findings (from the scan, or surfaced during review) go through
   [`file-follow-up`](../file-follow-up/SKILL.md) as `triage`-labeled GitHub issues with an Agent
   brief — never silently dropped, never expanded into this run's PR scope.

6. **Commit, push, open a PR — never self-merge.** One PR per run, following this repo's normal
   PR-authoring conventions (template, `release:patch` in the ordinary case, doc-sync checklist).
   Subscribe to its activity and drive it to green per the standing PR rules — but the PR always
   waits for a human to actually approve and merge it. This routine never merges its own PR, same as
   every other routine in this repo.

7. **Report.** Since nobody is watching the session live, a push notification is how this run
   reaches its owner — send one when a PR goes out, leading with the PR link and a one-line summary
   of what it fixes. If the scan found nothing safe enough to fix, that is a quiet-hold outcome:
   no notification, per the standing "don't interrupt for nothing changed" rule.

## Guardrails (do not skip)

- **No fix without a passing verification step.** If a workspace's tests can't run in this
  sandbox, say so explicitly rather than claiming a check that didn't happen — the same honesty
  rule that binds every other routine in this repo.
- **No behavior change, ever, from a "hygiene" fix.** If a candidate consolidation would change
  observable behavior even slightly, it's not a hygiene fix — drop it or file it as a proper
  follow-up with its own review, don't fold it in here.
- **One PR per run, never merged by the routine.** If a prior run's PR is still open, either extend
  it (this is genuinely the same batch) or wait — don't stack unrelated hygiene PRs.
- **The model and cadence for this scheduled task are configured outside this repo**, in the
  Claude Code web app's scheduled-task/trigger settings — not something this skill or any file in
  this repo controls.
