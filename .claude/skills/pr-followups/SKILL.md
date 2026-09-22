---
name: pr-followups
description: >
  Run the PR Follow-ups routine (3 of 5): harvest human-action and deferred items from recent pull
  requests (Flagged-for-review sections, agent-stated TODOs, unresolved review threads), research
  how each gets done, file them as tracked GitHub issues, refresh the "PR Follow-ups — Human Action
  List" tracking issue, and audit previously filed items for whether they've been done. Use when
  the scheduled "PR Follow-ups" routine fires, or when asked to collect or audit PR follow-up items.
---

# PR Follow-ups harvester (routine 3 of 5)

Agent PRs often end with work no PR can finish (flagged decisions, credential rotations, dashboard
clicks, unrun verification), and merging drops it. This routine turns that work into GitHub
issues. Each run does three jobs in order: **audit** what earlier runs filed, **harvest** new
items, **publish** the Human Action List. An item is done when its issue is closed; the list never
lives in a scratch file.

## Hard limits

- Ownership, the product-code ban and the docs-only self-maintenance PR are shared by every
  routine:
  [`ROUTINES.md` → Shared ownership boundary](../../../docs/internal/ci-cd/ROUTINES.md#shared-ownership-boundary-all-routines).
  Destructive writes only on `suggestion`-labeled issues; never write to Linear.
- GitHub MCP only. If it is unavailable, stop and report; REST and `gh` are not a fallback for
  tracker work (rule 4 there has the narrow settings-read carve-out).
- Never print secret values; name secrets only.

## Your namespace

You own `suggestion` issues whose marker starts `fp=pr-followup/` or `fp=human/`. The daily curator
skips them, because its close-on-code-proof and instant-`stale` rules don't fit human actions.
Beyond dedup reads, you don't touch `suggestion` issues outside these namespaces.

`fp=human/` issues are human-only blockers any session may file per
[file-follow-up](../file-follow-up/SKILL.md): title `[human] <action>`, the hold-in-triage opener,
and `source=` in the marker where yours carry `pr=`. Treat them exactly like `[pr-followup][human]`
items.

## Setup

Load the `mcp__github__` tool schemas you need (`list_issues`, `issue_read`, `issue_write`,
`add_issue_comment`, `search_issues`, `list_pull_requests`, `pull_request_read`) and confirm access
with an `issue_read` on a known issue. Label roster:
[`ROUTINES.md` → Tracker access](../../../docs/internal/ci-cd/ROUTINES.md#tracker-access-shared-by-all-routines).

Then run the
[marker-count guard](../../../docs/internal/ci-cd/GITHUB_PM.md#marker-count-guard-so-the-next-regression-surfaces-in-one-run):
two calls that fail closed if the read or index path has regressed. Read fidelity has flipped
before; the current measurement is in
[`GITHUB_PM.md` → Reading a body you intend to rewrite](../../../docs/internal/ci-cd/GITHUB_PM.md#reading-a-body-you-intend-to-rewrite-mcp-read-fidelity).

## State: the tracking issue

Cross-run state lives in one pinned issue titled **"PR Follow-ups — Human Action List"** (#814).
Find it with `search_issues query:"PR Follow-ups — Human Action List in:title"`; if that returns
nothing, confirm with a `list_issues` sweep for the `routine-state` label before concluding it is
missing, since a search false-zero would bootstrap a duplicate and reset the watermark. Create it
only on a confirmed miss, labeled `routine-state` and nothing else (so `/next` and triage never
treat it as work), and ask the maintainer to pin it.

```html
<!-- pr-followups-state: v1 last-run=<ISO date> newest-pr=#<N> backfill-oldest=#<N> backfill-empty-streak=<0|1|2> backfill-done=<yes|no> -->
```

`newest-pr` is the forward watermark (highest PR harvested), `backfill-oldest` the lowest PR the
backward crawl reached, and `backfill-done=yes` means that crawl has reached the start of useful
history.

The body carries this state twice: in a visible code fence, with a note declaring the fence
authoritative, and in the HTML comment. Read the watermarks from the fence and keep the note. A
lossy read has hidden HTML comments before, and a marker that looks missing triggers the bootstrap,
which silently re-crawls instead of failing.

Rebuild the whole body from live issue state every run. Never patch or round-trip the old body:
text you author this run is safe whatever the read path is doing.

Bootstrap (issue or marker genuinely missing): harvest PRs updated in the last 8 days and set
`backfill-oldest` to the oldest of them.

## Job 1: Audit what's already filed

List, don't search: page `list_issues state:OPEN` (fields `number,title,labels,updated_at`) and
filter client-side on the `[pr-followup]`, `[pr-followup][human]` and `[human]` title prefixes.
Prefix and title-token searches return false zeros from the semantic index, and a run that trusts
one audits nothing.

Decide each item from current code, config, CI history or runtime evidence, never from its age:

| Provable situation | Action |
| --- | --- |
| Done (code merged, secret rotated and pipeline green, setting changed) | Close `completed`, comment citing the proof (commit, green run, config read) |
| Moot (the system changed so it no longer applies) | Close `not_planned`, comment why |
| Neither provable | Leave open; add `stale` plus a dated comment only if untouched over 30 days |

Close only on proof. When a close rests on a chain of evidence rather than one read, hand the
"done" claim to the `claim-verifier` agent to try to refute it first. When you touch an older issue
whose `fp=` marker sits inside an HTML comment, promote the marker to the visible form.

## Job 2: Harvest

**Which PRs.** Forward: every PR (merged, closed or open) updated since `last-run` minus a day of
overlap, which dedup makes safe. Backward, while `backfill-done=no`: also up to 10 PRs below
`backfill-oldest`. A chunk that yields nothing increments `backfill-empty-streak`, any yield resets
it, and at 2 set `backfill-done=yes`.

**What counts.** From each PR's body, comments and review threads:

- "Flagged for review" sections (the `/next` PLAUSIBLE valve) and "Human action required",
  "Known limitations", "Deferred", "Follow-up" or "Out of scope" sections.
- Unchecked checklist items describing post-merge work (not template boilerplate).
- Agent comments saying something is undecided, blocked on the human, or left for later.
- Unresolved review threads on merged PRs that end on an open question or a promised follow-up.

Skip resolved threads, descriptions of the PR's own contents, bot linkbacks, CI noise, and
anything already tracked. If the thread shows Paul already decided, it's settled; don't harvest it.

**For each item:**

1. **Classify**: `human-action` (needs an account, dashboard, credential, purchase or product
   decision) or `agent-doable` (an agent could ship it as a PR).
2. **Research** before filing: the files and config it touches, the runbooks
   ([`ENV_REFERENCE.md`](../../../docs/internal/environment/ENV_REFERENCE.md),
   [`AGENT_INFRA.md`](../../../docs/internal/ci-cd/AGENT_INFRA.md), `docs/internal/ops/`), and
   [`/infrastructure-research`](../infrastructure-research/SKILL.md) for provider state. Write a
   **How to do it** section: numbered steps, exact setting, secret and file names, and what proves
   it done. If it turns out to be done already, don't file.
3. **Dedup** on `fp=pr-followup/<slug>`, with the slug taken from the action, not the PR title.
   Search open and closed issues for the exact `fp=` string (a hit counts only if the returned
   body contains it) and for the PR number, and check the issues the PR itself links. A near-match
   open issue gets a refresh comment, not a duplicate. A PR-number hit is worth reading, but a zero
   from it proves nothing: it is a token query, and those false-zero.
4. **File** with `issue_write`:
   - Title `[pr-followup] <imperative action>`, or `[pr-followup][human] …` for human-action items.
   - Labels `triage` + `suggestion` + one `area:<x>` + one priority (`P1` only for broken
     pipelines or security).
   - Body: summary, source (PR link and quoted text), classification, **How to do it**, acceptance
     criteria, an
     [Agent brief](../../../docs/internal/ci-cd/GITHUB_PM.md#agent-briefs-depth--model--ultracode)
     for agent-doable items, an optional `Estimate:` line, and last the visible marker line
     `` `agent-suggestion: v1 fp=pr-followup/<slug> pr=#<N>` ``. Keep it a visible line, not an
     HTML comment, so a lossy read can't hide it from dedup.
   - Human-action items open with `**Human action required — hold in triage; not for /next.**`
     so triage keeps them in the inbox.

File at most about 10 per run, highest impact first, and log what you dropped for the next run.
Zero filings is a normal outcome.

## Job 3: Publish the Human Action List

Rebuild the tracking issue body with `issue_write` update:

1. **Needs you**: every open `[human]` item from both namespaces, by priority:
   `#N — title — one-line "do this" — source` (the PR, or the marker's `source=` for
   session-filed blockers). Checkboxes are fine, but issue state is canonical: a ticked box on an
   open issue is a prompt to close that issue.
2. **Agent queue**: open agent-doable `pr-followup` items, one line each.
3. **Recently closed**: items closed since the last run, with what proved them done.
4. **State**: the fence, its authority note, and the `pr-followups-state` comment, with new
   watermarks and `last-run`.

Comment on an issue only when you have something it doesn't already say
([`ROUTINES.md` rule 6](../../../docs/internal/ci-cd/ROUTINES.md#shared-ownership-boundary-all-routines)).

## How the run ends

Work through all three jobs without stopping to summarize; put any status note in the same message
as your next tool call. Stop early only if the GitHub MCP is unavailable or the marker-count guard
fails, and report that as the finding. Otherwise the run ends when the tracking issue is
republished, and your final message is the run report.

## Run report

Paul gets this as the weekly digest, so lead with the **Needs you** count and the top 3 items.
Then: audit outcomes (closed, staled, left open), PRs scanned forward and backward, issues filed
(numbers), the tracking-issue update, what you dropped, and anything the next run should know.

## Self-maintenance

Per
[`ROUTINES.md` → Self-maintenance](../../../docs/internal/ci-cd/ROUTINES.md#self-maintenance-the-update-themselves-contract),
check this file's tool names, links and state-marker format against reality. Mechanical drift goes
in one docs-only PR (`.claude/skills/pr-followups/` is on the allowlist); judgment-laden drift
becomes a `suggestion` issue (`area:docs`).
