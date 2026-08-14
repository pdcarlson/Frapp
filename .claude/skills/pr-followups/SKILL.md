---
name: pr-followups
description: >
  Run the PR Follow-ups routine (3 of 3) — harvest human-action and deferred items out of recent
  pull requests (Flagged-for-review sections, agent-stated TODOs, unresolved review threads),
  research how each one gets done against the repo's configs and runbooks, file them as tracked
  GitHub issues, refresh the "PR Follow-ups — Human Action List" tracking issue, and audit
  previously filed items (including older PRs) for whether they've actually been done. Use when
  the scheduled "PR Follow-ups" routine fires, or when asked to collect or audit PR follow-up
  items.
---

# PR Follow-ups harvester (routine 3 of 3)

Agent-driven PRs routinely end with things **no PR can finish**: "Flagged for review" lists,
deferred decisions, credential rotations, dashboard clicks, verification the sandbox couldn't run.
Merging the PR silently drops them. This routine sweeps them into **GitHub Issues** — the
canonical tracker — so nothing needs a human to remember a PR thread. Each run does **three jobs
in order**: **(1) AUDIT** previously harvested items against reality, **(2) HARVEST** new items
from recent (and progressively older) PRs, **(3) PUBLISH** the human-action list.

**Check-off is issue state — not this routine's memory.** An item is "done" when its issue is
closed; the harvested list never lives in a scratch file. **Issues live in GitHub Issues. Linear
is retired — never write to it.** Read-only on product code; the sole repo-write exception is the
docs-only self-maintenance PR defined in
[`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md#self-maintenance-the-update-themselves-contract).

## Access

Everything runs through the **GitHub MCP** (the only sanctioned path; sandbox shell access to `api.github.com` is session-dependent and must not be relied on).
Load schemas first, e.g.
`ToolSearch("select:mcp__github__list_issues,mcp__github__issue_read,mcp__github__issue_write,
mcp__github__add_issue_comment,mcp__github__search_issues,mcp__github__list_pull_requests,
mcp__github__pull_request_read")`. Verify access up front (an `issue_read` on a known issue
resolves). **If the GitHub MCP is unavailable, stop and report — no fallback.** The label roster
lives in [`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md#tracker-access-shared-by-all-routines).
PR reads use `list_pull_requests` and `pull_request_read` (`get`, `get_comments`,
`get_review_comments`).

## Ownership boundary (hard invariant, shared with the other routines)

Destructive writes (close, re-body, mark-duplicate) only on issues carrying the **`suggestion`**
label — confirm via `issue_read get_labels` before every such write, else SKIP and log.
Human-filed and planning issues are strictly read-only. Policy:
[`GITHUB_PM.md` → Ownership boundary](../../../docs/internal/ci-cd/GITHUB_PM.md#ownership-boundary-organize-broadly-destroy-narrowly).

Within the `suggestion` set, lifecycle ownership is partitioned by fingerprint namespace: issues
whose marker starts `fp=pr-followup/` **or `fp=human/`** belong to **this** routine — the daily
curator skips them (its "provable from code/spec" close bar and instant-`stale` rule don't fit
human actions), and this routine never touches `suggestion` issues outside its namespaces beyond
dedup reads. The `fp=human/` namespace holds **human-only blocker issues filed by any agent
session** per the AGENTS.md hard rule (owner mandate 2026-08-12): title `[human] <action>`,
`suggestion`-labeled, hold-in-triage opener, `source=` instead of `pr=` in the marker. This
routine audits and closes them exactly like `[pr-followup][human]` items and publishes them on
the Human Action List.

## State: the Human Action List tracking issue

All cross-run state lives in one **pinned GitHub issue** titled
**"PR Follow-ups — Human Action List"** (find it with
`search_issues query:"PR Follow-ups — Human Action List in:title"`; create it on first run with
`issue_write` — label it **`routine-state`** and nothing else: that label marks routine
infrastructure, which `/next` and the triage routine both skip, so the tracking issue can never be
claimed or promoted as work — and ask the maintainer to pin it). Its body carries, in an HTML
comment at the end:

```html
<!-- pr-followups-state: v1 last-run=<ISO date> newest-pr=#<N> backfill-oldest=#<N> backfill-empty-streak=<0|1|2> backfill-done=<yes|no> -->
```

- `newest-pr` — the highest PR number already harvested (forward watermark).
- `backfill-oldest` — the lowest PR number reached crawling backwards (audit watermark).
- `backfill-done=yes` once the backward crawl has reached the beginning of useful history.

If the issue or marker is missing, bootstrap: window = PRs updated in the last 8 days,
`backfill-oldest` = the oldest PR in that window.

> **Read this issue's body with `search_issues`, never `issue_read` or `list_issues`.** Those two
> corrupt the body they return three ways — HTML comments deleted, unrecognised tags deleted, and
> `'`/`"`/`&` entity-escaped — so the `pr-followups-state` marker above is invisible in their
> output even when it is there. Republishing the tracking issue from that text deletes the marker,
> and because a missing marker is the bootstrap trigger, the next run silently resets to an 8-day
> window and re-crawls history it had already audited, rather than failing loudly. The
> `search_issues` lookup named above already returns the raw body intact on all three counts;
> keep using it, and confirm the marker is present in what you write back. Verified 2026-08-14 —
> full table and the probe to re-verify:
> [`GITHUB_PM.md` → Reading a body you intend to rewrite](../../../docs/internal/ci-cd/GITHUB_PM.md#reading-a-body-you-intend-to-rewrite-mcp-read-fidelity).
>
> The visible code fence duplicating this marker on **#814** was a workaround for the era when no
> lossless read was known. It is harmless and can stay, but it is no longer load-bearing — the
> HTML comment above is authoritative again.

## Job 1 — Audit previously harvested items

Fetch open issues whose description contains the `fp=pr-followup/` **or `fp=human/`** marker
(`search_issues query:"fp=pr-followup in:body state:open"` **and**
`search_issues query:"fp=human in:body state:open"`, plus a description check). For each,
decide **from current code, config, CI history, or runtime evidence** — never from the issue's
age:

| Provable situation | Action |
| --- | --- |
| The action was done (code merged, secret rotated and pipeline green, setting changed) | Close as **`completed`** + comment citing the proof (commit, green run, config read) |
| Moot — the surrounding system changed so the item no longer applies | Close as **`not_planned`** + comment why |
| Cannot prove either | Leave open; add `stale` + a dated comment only if untouched > 30 days |

The bar is the curator's: **close only on proof**. This job is what answers "has the stuff from
further back actually been done?" — it runs every time, before anything new is filed.

## Job 2 — Harvest

### Which PRs

1. **Forward:** all PRs (merged, closed, and open) with `updated_at` in the window since
   `last-run` minus 1 day of overlap (dedup makes overlap safe).
2. **Backward (audit crawl):** while `backfill-done=no`, also take up to **10** PRs below
   `backfill-oldest`. Stopping rule, evaluated across runs via the marker: a chunk yielding zero
   items increments `backfill-empty-streak`; any yield resets it to 0; at 2, set
   `backfill-done=yes`. This is how coverage eventually reaches "even further back" without one
   giant run.

### What counts as a follow-up item

Read each PR's body, its issue-style comments, and its review threads. Harvest:

- **"Flagged for review" sections** — the `/next` NEEDS_HUMAN valve — and any "Human action
  required", "Known limitations", "Deferred", "Follow-up", "Out of scope" sections.
- **Unchecked checklist items** in the PR body that describe post-merge work (not PR-template
  boilerplate).
- **Agent comments** stating something is undecided, blocked on the human, or left for later
  (credential rotations, dashboard/UI steps, product decisions, unverified behavior).
- **Unresolved review threads on merged PRs** whose last state is an open question or a promised
  follow-up.

Skip: resolved threads, items merely describing the PR's own contents, bot linkbacks, CI noise,
and anything already tracked (see dedup).

### Classify, research, file

For each surviving item:

1. **Classify** — `human-action` (needs an account, dashboard, credential, purchase, or product
   decision an agent cannot make) vs `agent-doable` (an ordinary follow-up an agent could ship as
   a PR).
2. **Research** — ground it before filing: read the files/config it touches and the relevant
   runbooks ([`ENV_REFERENCE.md`](../../../docs/internal/environment/ENV_REFERENCE.md),
   [`AGENT_INFRA.md`](../../../docs/internal/ci-cd/AGENT_INFRA.md), `docs/internal/ops/`), and use
   [`/infrastructure-research`](../infrastructure-research/SKILL.md) for provider runtime truth.
   Write a **"How to do it"** section: concrete numbered steps, exact setting/secret/file names,
   what proves it done. If research shows the item is already done, don't file — that's a Job 1
   outcome discovered early.
3. **Dedup** — fingerprint `fp=pr-followup/<slug>` (slug from the action, not the PR title).
   Before filing, `search_issues` open **and** closed for the `fp=` string **and** for the PR
   number; a near-match open issue gets refreshed (comment + link), not duplicated. Also check
   issues the PR itself references.
4. **File** via `issue_write` create:
   - Title: `[pr-followup] <imperative action>` — human-action items get `[pr-followup][human]`.
   - Labels: **`triage`** + **`suggestion`** + one `area:<x>` + a priority label (don't inflate;
     `P1` only for broken pipelines/security).
   - Description: summary · source (PR link + quoted text) · classification · **How to do it**
     (the research) · acceptance criteria · an **Agent brief**
     ([`GITHUB_PM.md` → Agent briefs](../../../docs/internal/ci-cd/GITHUB_PM.md#agent-briefs-depth--model--ultracode))
     for agent-doable items · optionally an `Estimate:` line · ending with
     `<!-- agent-suggestion: v1 fp=pr-followup/<slug> pr=#<N> -->`.
   - `[human]` items additionally open with `**Human action required — hold in triage; not for
     /next.**` so the triage routine keeps them in the inbox instead of promoting them.
- **Budget:** at most **~10** new issues per run, highest-impact first; log what was dropped and
  let the next run pick it up. Zero filings is a normal outcome.

## Job 3 — Publish the Human Action List

Rebuild the tracking issue's body from **live issue state** (never from memory) via `issue_write`
update:

1. **Needs you** — every open `[human]` item (both namespaces): `#N — title — one-line "do
   this" — source` (the source PR for harvested items; the marker's `source=` value for
   session-filed `fp=human/` blockers). Order by priority. Checkboxes are welcome, but state is canonical — a checked box without a
   closed issue is a prompt to close the issue.
2. **Agent queue** — open agent-doable `pr-followup` items (one line each; `/next` will get them).
3. **Recently closed** — items closed since the last run, with what proved them done.
4. Refresh the `pr-followups-state` marker (new watermarks, `last-run`).

End the run with a short report: audit outcomes (closed/stale/left), PRs scanned (forward +
backward), issues filed (numbers), tracking issue updated, and anything the next run should know.
The routine's completion notification is Paul's weekly digest — put the "Needs you" count and top
3 items in the final message.

## Self-maintenance

Same binding contract as the other two routines —
[`ROUTINES.md` → Self-maintenance](../../../docs/internal/ci-cd/ROUTINES.md#self-maintenance-the-update-themselves-contract):
verify this file's tool names, doc links, and the state-marker format still match reality;
mechanical drift → one docs-only PR (allowed paths include `.claude/skills/pr-followups/`);
judgment-laden drift → file a `suggestion` (`area:docs`) instead.

## Guardrails

- Never write to Linear (retired); never modify product code; never push feature branches. The
  docs-only self-maintenance PR is the single exception.
- Never print secret values; reference secret **names** only (follow `AGENTS.md`).
- Close only on proof; when unsure, leave open and say why.
- Don't re-litigate decisions a human already made in the PR thread — if the thread shows Paul
  decided, the item is closed, not harvested.
- One comment per issue per run at most — no comment spam on unchanged items.
- Zero new issues is a success; never pad the run.
