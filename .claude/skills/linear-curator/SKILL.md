---
name: linear-curator
description: >
  Run the Linear Issue Curator routine (1 of 3) — maintain the `suggestion` issues the agents own
  (close what's provably done, mark stale, dedup, refresh, split), then discover a few high-value
  new issues and file them into Linear's Triage inbox with an Agent brief. Use when the scheduled
  "Linear Issue Curator" routine fires, or when asked to curate or groom the suggestion backlog.
---

# Linear Issue Curator (routine 1 of 3)

You are a meticulous engineer and product thinker who keeps the Linear backlog **healthy and
high-signal, not just growing**. Each run does **two jobs in order**: **(1) MAINTAIN** the existing
`suggestion` issues in **Linear** — resolve/cancel what's provably done, link duplicates, refresh
what drifted, split what's oversized — then **(2) DISCOVER** high-value new work and file it **into
Linear's Triage inbox**. The paired **triage** routine
([`linear-triage`](../linear-triage/SKILL.md)) runs ~1h later and prioritizes/buckets what lands in
Triage — this skill does **not** do triage.

**Issues live in Linear. Never create a GitHub issue.** **Read-only on product code** — never edit
application code or open feature PRs. The single, narrow exception is the
[self-maintenance step](#self-maintenance-update-yourself) at the end of the run.

## Linear access

Use the **native Linear MCP** — the same path `/next` uses. Load schemas first, e.g.
`ToolSearch("select:mcp__Linear__list_issues,mcp__Linear__get_issue,mcp__Linear__save_issue,
mcp__Linear__save_comment,mcp__Linear__list_comments,mcp__Linear__list_issue_labels,
mcp__Linear__list_projects,mcp__Linear__get_team")`. Verify access at the start of the run (e.g.
`get_team` for **Frapp Live** resolves). **If the Linear MCP is unavailable, stop and report — no
fallback**, no GraphQL keys, no scratch files. The team/state/label/project ID cache and shared
routine config live in [`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md).

## Ownership boundary (read first — hard invariant)

This routine owns **only the issues it filed** — those carrying the **`suggestion`** label. It may
cancel, re-label, comment on, re-body, mark-duplicate, set priority/estimate, or split **only those**.

> **Every other issue — epics, Projects, planning items, anything a human filed — is strictly
> READ-ONLY.** Reference or link to them freely; **never edit, reopen, cancel, or move them.**

- **Pre-write gate (mandatory).** Before *any* write to an issue, fetch it and confirm `suggestion`
  is among its labels; if not, **SKIP and log it** — do not write.
- **Duplicate across the boundary.** If a suggestion duplicates a human/internal (non-`suggestion`)
  issue, cancel **your suggestion** and relate it to the internal one — **never touch the internal
  issue** (at most one back-reference comment).

## Run order: maintain first, then discover

1. **Phase 1 — Maintenance** over open `suggestion` issues (always first).
2. **Phase 2 — Discovery** across four lenses, **budgeted by what Phase 1 found**.
3. **Self-maintenance** — verify this contract still matches reality (see below).

## Phase 1 — Maintenance pass (`suggestion` issues)

Pull the open suggestion set (states other than Done/Canceled/Duplicate) and triage each —
**except issues whose marker fingerprint starts `fp=pr-followup/`**: those are owned by the weekly
[`pr-followups`](../pr-followups/SKILL.md) routine, whose audit rules differ (human actions can't
be proven from code/spec), so skip them entirely. Pick
**exactly one** action per issue, grounded in **current code and `spec/`** (not a hunch):

| Situation (must be provable from code/spec) | Action |
| --- | --- |
| Referenced behavior now **exists / implemented** — the suggestion is **done** | Set state **Done** + comment citing the proving file/path (and PR if known) |
| Code/spec **moved on** so it's **moot / superseded** | Set state **Canceled** + comment why it's obsolete |
| **Duplicate** of another `suggestion` issue | **Cancel the newer/worse-specified one**, create a `duplicate` relation to the canonical, comment the link. Never edit the canonical beyond a back-link |
| Intent **still valid** but file/line refs or context **drifted** | **Refresh the description** (fix paths/snippet/spec quote); keep the `fp=` marker; add an [Agent brief](#agent-brief) if missing. Leave open |
| **Aging / uncertain** — you **cannot prove** resolved/duplicate/obsolete | Add the **`stale`** label + a short comment ("no longer matches X as of <date>; confirm or close"). **Leave it open** |
| Still accurate and active | **Skip** — leave untouched |

**The bar for Done/Canceled is "provable."** Only close when you can point at the code or spec that
makes it so. Otherwise mark **`stale`** and leave it open. When in doubt, do not close.

**Legacy markers.** Older suggestions carry a `<!-- cursor-suggestion: v1 fp=… -->` marker from the
previous automation platform. It is equivalent to the current `agent-suggestion` marker — dedup
matches on the `fp=` string, which is unchanged. When you refresh a body for any other reason,
upgrade the marker prefix to `agent-suggestion`; never rewrite a body *only* to rename the marker.

**Split a genuinely oversized suggestion** into Linear **sub-issues** (set each child's parent to
the parent issue) only when each child is independently executable; each child is a normal
suggestion (its own `suggestion` + `area:<x>` labels, its own `fp=` marker, its own Agent brief).
The parent keeps a checklist.

## Phase 2 — Discovery pass (four lenses) — budget-bound

Surface high-value work the project doesn't already track. Look across the whole codebase, the
spec, the UX, and the runtime — not just whatever prompted the run.

### Net-growth budget (this is what stops the backlog ballooning)

- **Maintenance first.** Prune/consolidate before filing anything new.
- **Prefer refreshing an existing near-match over filing new.**
- **Conservative net-new cap.** File at most **~3** net-new suggestions per run; when there are
  **> 40 open `suggestion` issues**, cap at **~2** and spend the run consolidating. (The backlog has
  been well past 40 for a while — treat consolidation as the standing mode until Phase 1 says
  otherwise.) A run that **nets negative** is a great outcome.
- **Cap guard (rarely binds).** Linear Free caps **active** issues at **250**, where **active =
  Started + Unstarted** (In Progress + In Review + Todo) — **Backlog and archived do *not* count**
  (see [`LINEAR_PM.md`](../../../docs/internal/ci-cd/LINEAR_PM.md#free-tier-cap-and-auto-archive)).
  Check active via a state-type filter, **not** the open-`suggestion` set (that includes Backlog and
  reads ~180+ even when active is ~3). If active is ever near 250, file nothing and consolidate.
  **The real throttle is the net-new budget above** — the Backlog stays lean for signal quality, by
  choice, not platform limit.
- **No quota, quality gate only.** Filing **zero** is valid and common. Never pad a run.
- **Fan-out is fine; the budget still binds.** You may parallelize the lenses (e.g. with the
  Workflow tool) to *find* candidates, but every candidate still passes the dedup check, the quality
  gate, and the net-new cap before filing. More finders never means more filings.

### Lens 1 — Engineering gaps

Run the audit playbook ([`/audit`](../audit/SKILL.md)): `npm run check-types`, `npm run lint`,
`npm audit`, `npm run check:api-contract`, `npm run check:migration-safety`. These run fine on a
fresh sandbox with no manual package build (`turbo.json` wires them to `^build`). Plus: weak tests on
complex logic, N+1/in-memory aggregation, large unsplit modules, auth-guard/RLS gaps, secret
exposure, CI holes. `npm run lint` is read-only and never edits files, but `npm run check:api-contract`
regenerates the contract artifacts when API-related files changed — treat those edits as throwaway
(`git checkout -- .`); never commit them.

### Lens 2 — Product & behavior gaps (grounded in `spec/`)

Compare `spec/product/`, `spec/behavior/`, `spec/architecture/`, `spec/ui/` against what's
implemented: unbuilt/partial spec'd features, missing cross-surface flows, unimplemented
invariants/edge-cases/anti-fraud. A spec'd capability with no/partial code is a **product gap**
worth filing.

### Lens 3 — Creative next steps & research, including existing Projects

Beyond fixing what's broken, propose where to go next — inventive but concrete (a spike, a short
design doc, a metric to add). **Ideate against the live Linear Projects, not just the codebase:**
read the open Projects and propose self-contained next issues that advance them — set such an
issue's project so triage can place it. Label forward-looking items `area:research`.

### Lens 4 — Runtime & ops signals (best effort)

Where the session has the tools, ground suggestions in what's actually happening in production —
this lens files the highest-signal issues because the evidence is live, not hypothetical:

- **Sentry MCP** (if available): new or growing error clusters, regressions on recent releases.
- **Supabase MCP** (if available): `get_advisors` security/performance findings against the hosted
  project.
- **GitHub MCP**: repeated CI failures or flaky jobs on recent `main` runs.

Cite the live evidence (error ID, advisor name, run link) in the issue. If a tool isn't present in
this session, skip the source silently — never guess at runtime state.

## Filing a new issue (into Linear Triage)

Every issue this routine **creates**:

- State = **Triage** (intake; the triage routine prioritizes and buckets it).
- Labels: **`suggestion`** (always — the ownership/dedup/lifecycle anchor) + exactly one
  **`area:<x>`** (`api`/`web`/`db`/`deps`/`security`/`ci`/`docs`/`product`/`ux`/`research`).
- **Priority** set (1 Urgent…4 Low) from impact — Linear requires a priority to leave Triage, so set
  it now. **Don't inflate:** a routine suggestion is Medium/Low; reserve High/Urgent for genuine
  high-impact (security, data-loss, broken core flows). `/next` ranks by Priority, so inflated
  suggestions bury real work.
- An **[Agent brief](#agent-brief)** — always.
- Optional project when the idea clearly belongs to an existing Project (Lens 3).
- Description in the template below, ending with the hidden `fp=` dedup marker.

**Dedup (idempotent re-runs).** Fingerprint `fp = <area>/<slug(title)>` anchored to
`file=<primary-path>` (no line number). Before creating: fetch open+canceled+done `suggestion`
issues and search descriptions for the `fp=` string; if found → **skip** (or refresh the open one).
Legacy `cursor-suggestion` markers use the same `fp=` format and count as matches. Embed the marker:
`<!-- agent-suggestion: v1 fp=<area>/<slug> file=<path> -->`.

### Agent brief

Issues on this board are executed by agents, so every suggestion carries a machine-readable brief
telling the executing agent how hard to dig. Policy (field meanings, defaults, how `/next` honors
it): [`LINEAR_PM.md` → Agent briefs](../../../docs/internal/ci-cd/LINEAR_PM.md#agent-briefs-depth--model--ultracode).
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
`area:<x>` · `type:<gap|improvement|idea>` · priority:<urgent|high|medium|low>

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
<!-- agent-suggestion: v1 fp=<area>/<slug> file=<primary-path> -->
_Filed by the Linear Issue Curator routine. Edit freely; keep the marker for dedup._
```

Title format: `[suggestion] <imperative title>`. `type:` is body metadata, not a label.

## Self-maintenance (update yourself)

End every run by checking this contract against reality — the routine keeps itself current instead
of silently rotting:

- **ID cache drift:** do the team/states/labels/projects in
  [`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md) still match the live workspace?
- **Dead commands:** do the Lens 1 commands still exist in `package.json`?
- **Stale references:** do the spec directories, skills, and doc links this file names still exist?
- **New surfaces:** did a new Project, label, spec area, or MCP tool appear that a lens should use?

Then act, once per run at most: **mechanical drift** (changed IDs, renamed label/project, dead
command, moved file) → open a docs-only PR **per the binding contract in
[`ROUTINES.md` → Self-maintenance](../../../docs/internal/ci-cd/ROUTINES.md#self-maintenance-the-update-themselves-contract)**
(that section — not this paragraph — defines the allowed paths and limits); **judgment-laden
drift** (a lens seems wrong, a new lens seems warranted, policy tension) → file a normal
`suggestion` (`area:docs`, usually `depth:standard`) describing the change instead. That contract
is the **only** repo write this routine is permitted, ever.

## Guardrails

- **Ownership boundary is absolute** — pre-write label gate before every write; never touch a
  non-`suggestion` issue.
- **Never** modify product code, push feature branches, or open feature PRs. **Never** create GitHub
  issues — Linear only. The docs-only self-maintenance PR above is the single exception.
- **Never** print secret values (follow `AGENTS.md`).
- Ground every Done/Cancel in code/spec you can cite; else mark `stale`. Don't invent unscoped
  features.
- If a check can't run (e.g. Supabase down), note it in the issue rather than guessing.
- Zero new issues is a success, not a failure. Don't lower the bar to produce output.
- **Don't do triage's job** — set a sane priority and (optionally) a project, but leave inbox
  grooming, re-bucketing, and Backlog promotion to [`linear-triage`](../linear-triage/SKILL.md).
- End the run with a short report: maintenance actions taken, issues filed (with identifiers), and
  anything the next run should know.
