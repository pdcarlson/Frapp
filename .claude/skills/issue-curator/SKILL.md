---
name: issue-curator
description: >
  Run the Issue Curator routine (1 of 3) — maintain the `suggestion` GitHub issues the agents own
  (close what's provably done, mark stale, dedup, refresh, split), then discover a few high-value
  new issues and file them into the `triage` inbox with an Agent brief. Use when the scheduled
  "Issue Curator" routine fires, or when asked to curate or groom the suggestion backlog.
---

# Issue Curator (routine 1 of 3)

You are a meticulous engineer and product thinker who keeps the GitHub Issues backlog **healthy and
high-signal, not just growing**. Each run does **two jobs in order**: **(1) MAINTAIN** the existing
`suggestion` issues — resolve/close what's provably done, link duplicates, refresh what drifted,
split what's oversized — then **(2) DISCOVER** high-value new work and file it **into the `triage`
inbox**. The paired **triage** routine ([`issue-triage`](../issue-triage/SKILL.md)) runs ~1h later
and prioritizes/promotes what lands in triage — this skill does **not** do triage.

**Ownership, tracker, and the product-code ban** — read
[`ROUTINES.md` → Shared ownership boundary](../../../docs/internal/ci-cd/ROUTINES.md#shared-ownership-boundary-all-routines)
first. The single repo-write exception is the [self-maintenance step](#self-maintenance-update-yourself)
at the end of the run.

## Tracker access

Use the **GitHub MCP** — the same path `/next` uses. Load schemas first, e.g.
`ToolSearch("select:mcp__github__list_issues,mcp__github__issue_read,mcp__github__issue_write,
mcp__github__add_issue_comment,mcp__github__search_issues,mcp__github__sub_issue_write")`. Verify
access at the start of the run (an `issue_read` on a known issue resolves). **If the GitHub MCP is
unavailable, stop and report — no fallback**, no REST calls (shell access to `api.github.com` is
session-dependent — never rely on it), no scratch files. The label roster and shared routine config live in
[`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md).

## Ownership boundary (read first — hard invariant)

Shared rules:
[`ROUTINES.md` → Shared ownership boundary](../../../docs/internal/ci-cd/ROUTINES.md#shared-ownership-boundary-all-routines).
This routine's extra constraint: it owns **only** `suggestion` issues, including organizational
writes (re-label, split), not just destructive ones.

> **Every other issue — epics, planning items, anything a human filed — is strictly READ-ONLY.**
> Reference or link to them freely; **never edit, reopen, close, or re-label them.**

- **Pre-write gate (mandatory).** Before *any* write to an issue, fetch its labels
  (`issue_read get_labels`) and confirm `suggestion` is present; if not, **SKIP and log it**.
- **Duplicate across the boundary.** If a suggestion duplicates a human/internal
  (non-`suggestion`) issue, close **your suggestion** as `duplicate` with `duplicate_of` the
  internal one — **never touch the internal issue** (at most one back-reference comment).

## Run order: maintain first, then discover

1. **Phase 1 — Maintenance** over open `suggestion` issues (always first).
2. **Phase 2 — Discovery** across four lenses, **budgeted by what Phase 1 found**.
3. **Self-maintenance** — verify this contract still matches reality (see below).

## Phase 1 — Maintenance pass (`suggestion` issues)

Pull the open suggestion set (`list_issues` with `labels: ["suggestion"]`, state OPEN) and triage
each — **except issues whose marker fingerprint starts `fp=pr-followup/` or `fp=human/`**: those
are owned by the weekly [`pr-followups`](../pr-followups/SKILL.md) routine, whose audit rules
differ (human actions can't be proven from code/spec), so skip them entirely. Issues labeled
**`scope:production`** are **parked by owner decision** (2026-08-10; see the label roster in
[`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md)), not aging — never mark them `stale`,
never raise their priority for age, and never file duplicates of them. Pick **exactly one** action
per issue, grounded in **current code and `spec/`** (not a hunch):

| Situation (must be provable from code/spec) | Action |
| --- | --- |
| Referenced behavior now **exists / implemented** — the suggestion is **done** | Close as **`completed`** + comment citing the proving file/path (and PR if known) |
| Code/spec **moved on** so it's **moot / superseded** | Close as **`not_planned`** + comment why it's obsolete |
| **Duplicate** of another `suggestion` issue | **Close the newer/worse-specified one** as `duplicate` with `duplicate_of` the canonical, comment the link. Never edit the canonical beyond a back-link |
| Intent **still valid** but file/line refs or context **drifted** | **Refresh the description** (fix paths/snippet/spec quote); keep the `fp=` marker; add an [Agent brief](#agent-brief) if missing. Leave open |
| **Aging / uncertain** — you **cannot prove** resolved/duplicate/obsolete | Add the **`stale`** label + a short comment ("no longer matches X as of <date>; confirm or close"). **Leave it open** |
| Still accurate and active | **Skip** — leave untouched |

**The bar for closing is "provable."** Only close when you can point at the code or spec that
makes it so. Otherwise mark **`stale`** and leave it open. When in doubt, do not close.

**Label writes replace the whole set.** `issue_write`'s `labels` field overwrites — always send
the union of the existing labels plus your change, never just the addition.

**Reading a body you intend to rewrite.** **No MCP read path returns a body faithfully — not
`issue_read`, not `list_issues`, and no longer `search_issues`.** All three corrupt a body three
ways on read: HTML comments deleted (a legacy `fp=` marker), unrecognised tags deleted (including
JSX inside ` ```tsx ` fences), and `'`/`"`/`&`/`>` entity-escaped. `search_issues` was the lossless
exception until it regressed on all three vectors, confirmed 2026-08-20. Refreshing or splitting
from that text silently destroys content — a dropped code snippet is **unrecoverable**, unlike a
marker you could rebuild from `fp=<area>/<slug>`.

**So: prefer a comment over a rewrite.** Anything additive — a note, a finding, an Agent brief —
goes in `add_issue_comment`, which is lossless. Rewrite only when you author the replacement body
yourself, or under the narrow escape hatch (`WebFetch`-confirm the body has no comments and no
tags, then un-escape entities):
[`GITHUB_PM.md` → Reading a body you intend to rewrite](../../../docs/internal/ci-cd/GITHUB_PM.md#reading-a-body-you-intend-to-rewrite-mcp-read-fidelity).

**The `fp=` lookup is unaffected.** `search_issues` resolves fingerprints precisely — a real one
returns exactly its issue, a fabricated one returns zero — so dedup below needs no redesign. Since
it matches *semantically* rather than by number, verify the returned `number` is the issue you mean.
Start each run with the marker-count guard in `GITHUB_PM.md`.

**Legacy markers.** Older suggestions carry a `<!-- cursor-suggestion: v1 fp=… -->` or
`<!-- agent-suggestion: v1 fp=… -->` marker as an **HTML comment**. Those are still stored and still
valid — they are merely unreadable through the MCP, so **a marker you cannot see is "unknown", never
"absent"**; never re-file on that basis alone. New filings use the visible-line form below. When you
refresh a body for any other reason, promote the marker to the visible form; never rewrite a body
*only* to change the marker.

**Split a genuinely oversized suggestion** into native **sub-issues** (`sub_issue_write` with the
parent) only when each child is independently executable; each child is a normal suggestion (its
own `suggestion` + `area:<x>` labels, its own `fp=` marker, its own Agent brief). The parent keeps
a checklist.

## Phase 2 — Discovery pass (four lenses) — budget-bound

Surface high-value work the project doesn't already track. Look across the whole codebase, the
spec, the UX, and the runtime — not just whatever prompted the run.

### Net-growth budget (this is what stops the backlog ballooning)

- **Maintenance first.** Prune/consolidate before filing anything new.
- **Prefer refreshing an existing near-match over filing new.**
- **Conservative net-new cap.** File at most **~3** net-new suggestions per run; when there are
  **> 40 open `suggestion` issues**, cap at **~2** and spend the run consolidating. (The backlog
  has been well past 40 for a while — treat consolidation as the standing mode until Phase 1 says
  otherwise.) A run that **nets negative** is a great outcome.
- **No platform cap.** GitHub Issues has no active-issue limit. The backlog stays lean **by choice** — the net-new budget above is the only throttle, and it exists for signal quality.
- **No quota, quality gate only.** Filing **zero** is valid and common. Never pad a run.
- **Fan-out is fine; the budget still binds.** You may parallelize the lenses (e.g. with the
  Workflow tool) to *find* candidates, but every candidate still passes the dedup check, the
  quality gate, and the net-new cap before filing. More finders never means more filings.

### Lens 1 — Engineering gaps

Run the audit playbook ([`/audit`](../audit/SKILL.md)): `npm run check-types`, `npm run lint`,
`npm audit`, `npm run check:api-contract`, `npm run check:migration-safety`. All five run on a fresh
sandbox with no manual package build, but for three different reasons — do not collapse them:
`check-types` and `lint` are turbo tasks wired to `^build` in `turbo.json`; `check:api-contract` is a
root node script that builds `./packages/*` itself before regenerating; `npm audit` and
`check:migration-safety` need no build at all. `^build` covers **only** the turbo tasks. Plus: weak tests
on complex logic, N+1/in-memory aggregation, large unsplit modules, auth-guard/RLS gaps, secret
exposure, CI holes. `npm run lint` is read-only and never edits files, but `npm run check:api-contract`
regenerates the contract artifacts when API-related files changed — treat those edits as throwaway
(`git checkout -- .`); never commit them.

### Lens 2 — Product & behavior gaps (grounded in `spec/`)

Compare `spec/product/`, `spec/behavior/`, `spec/architecture/`, `spec/ui/` against what's
implemented: unbuilt/partial spec'd features, missing cross-surface flows, unimplemented
invariants/edge-cases/anti-fraud. A spec'd capability with no/partial code is a **product gap**
worth filing.

### Lens 3 — Creative next steps & research, including existing epics

Beyond fixing what's broken, propose where to go next — inventive but concrete (a spike, a short
design doc, a metric to add). **Ideate against the live epics, not just the codebase:** read the
open `[Epic]` parent issues and propose self-contained next issues that advance them — attach such
an issue as a sub-issue of its epic so triage can place it. Label forward-looking items
`area:research`.

### Lens 4 — Runtime & ops signals (best effort)

Where the session has the tools, ground suggestions in what's actually happening in production —
this lens files the highest-signal issues because the evidence is live, not hypothetical:

- **Sentry MCP** (if available): new or growing error clusters, regressions on recent releases.
- **Supabase MCP** (if available): `get_advisors` security/performance findings against the hosted
  project.
- **GitHub MCP**: repeated CI failures or flaky jobs on recent `main` runs.

Cite the live evidence (error ID, advisor name, run link) in the issue. If a tool isn't present in
this session, skip the source silently — never guess at runtime state.

## Filing a new issue (into the `triage` inbox)

Every issue this routine **creates**:

- Labels: **`triage`** (intake — the triage routine prioritizes and promotes it) +
  **`suggestion`** (always — the ownership/dedup/lifecycle anchor) + exactly one **`area:<x>`**
  (`api`/`web`/`db`/`deps`/`security`/`ci`/`docs`/`product`/`ux`/`research`/`dx`) + a **priority
  label** (`P1`–`P4`) from impact — promotion out of triage requires one, so propose it now.
  **Don't inflate:** a routine suggestion is `P3`/`P4`; reserve `P1`/`P2` for genuine high-impact
  (security, data-loss, broken core flows). `/next` ranks by priority, so inflated suggestions
  bury real work.
- An **[Agent brief](#agent-brief)** — always.
- Optionally attached as a sub-issue of an epic when it clearly belongs to one (Lens 3).
- Description in the template below, ending with the hidden `fp=` dedup marker.

**Dedup (idempotent re-runs).** Fingerprint `fp = <area>/<slug(title)>` anchored to
`file=<primary-path>` (no line number). Before creating: `search_issues` (open **and** closed) for
the `fp=` string; if found → **skip** (or refresh the open one). Legacy `cursor-suggestion` and
comment-form `agent-suggestion` markers use the same `fp=` format and count as matches — but a
comment-form marker is invisible to the search index as well as to the read, so **absence of a hit
is weak evidence**; also search the finding's key terms before concluding an issue is net-new. **Also search the finding's key terms
against `[human]` titles** — if an open `fp=human/` blocker already tracks the same action
(dashboard toggles and advisor findings are the usual overlap), skip: filing a promotable twin
would route `/next` into a wall the held issue already documents. Embed the marker:
a visible `` `agent-suggestion: v1 fp=<area>/<slug> file=<path>` `` line — **a visible line, not an
HTML comment**, because every MCP read deletes comments and that hides the marker from the search
index too.

### Agent brief

Issues on this board are executed by agents, so every suggestion carries a machine-readable brief
telling the executing agent how hard to dig. Policy (field meanings, defaults, how `/next` honors
it): [`GITHUB_PM.md` → Agent briefs](../../../docs/internal/ci-cd/GITHUB_PM.md#agent-briefs-depth--model--ultracode).
Format:

```markdown
### Agent brief
`depth:<skim|standard|deep>` · `model:<fable|any>` · `ultracode:<yes|no>`
<one line on where the depth should go — what to verify, which subsystem to load>
```

**Err on the side of `depth:deep`** — the policy section above defines the field calibrations, and
where this file and it disagree, policy wins. Suggest `model:fable` + `ultracode:yes` for
cross-cutting, architectural, security-sensitive, or subtle-correctness work; `model:any` otherwise.

### Description template

```markdown
### Summary
<one sentence>

### Category
`area:<x>` · `type:<gap|improvement|idea>` · priority:<P1|P2|P3|P4>

### Agent brief
`depth:<skim|standard|deep>` · `model:<fable|any>` · `ultracode:<yes|no>`
<one line on where the depth should go>

### Location
`path/to/file.ext:line`  (or `spec/...` for product/behavior items)

### Description
<what's wrong, missing, or worth pursuing>

### Rationale & impact
<why it matters — tie product/behavior items to the spec or the user; cite live evidence for Lens 4>

### Suggested fix / first step
<concrete next step; for ideas, the smallest spike>

### Acceptance criteria
- [ ] <objectively verifiable outcome>

---

`agent-suggestion: v1 fp=<area>/<slug> file=<primary-path>`

_Filed by the Issue Curator routine. Edit freely; keep the `fp=` line above — it is the dedup key,
and it must stay a visible line (an HTML comment is invisible to every MCP read)._
```

Title format: `[suggestion] <imperative title>`. `type:` is body metadata, not a label.

## Self-maintenance (update yourself)

End every run by checking this contract against reality — the routine keeps itself current instead
of silently rotting:

- **Label-roster drift:** do the state/priority/area labels in
  [`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md) still match the live repo?
- **Dead commands:** do the Lens 1 commands still exist in `package.json`?
- **Stale references:** do the spec directories, skills, and doc links this file names still exist?
- **New surfaces:** did a new epic, label, spec area, or MCP tool appear that a lens should use?

Then act, once per run at most: **mechanical drift** (renamed label, dead command, moved file) →
open a docs-only PR **per the binding contract in
[`ROUTINES.md` → Self-maintenance](../../../docs/internal/ci-cd/ROUTINES.md#self-maintenance-the-update-themselves-contract)**
(that section — not this paragraph — defines the allowed paths and limits); **judgment-laden
drift** (a lens seems wrong, a new lens seems warranted, policy tension) → file a normal
`suggestion` (`area:docs`, usually `depth:standard`) describing the change instead. That contract
is the **only** repo write this routine is permitted, ever.

## Guardrails

- **Ownership boundary is absolute** — see
  [`ROUTINES.md` → Shared ownership boundary](../../../docs/internal/ci-cd/ROUTINES.md#shared-ownership-boundary-all-routines).
  Pre-write label gate before every write; never touch a non-`suggestion` issue.
- **Never** print secret values (follow `AGENTS.md`).
- Ground every close in code/spec you can cite; else mark `stale`. Don't invent unscoped features.
- If a check can't run (e.g. Supabase down), note it in the issue rather than guessing.
- Zero new issues is a success, not a failure. Don't lower the bar to produce output.
- **Don't do triage's job** — propose a priority label, but leave inbox grooming, re-bucketing,
  and Backlog promotion to [`issue-triage`](../issue-triage/SKILL.md).
- End the run with a short report: maintenance actions taken, issues filed (with numbers), and
  anything the next run should know.
