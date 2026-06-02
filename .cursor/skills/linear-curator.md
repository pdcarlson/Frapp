# Skill: Linear Issue Curator (automation 1 of 2)

> Use when running the Cursor **"Linear Issue Curator"** automation (or doing it by hand). Each run does
> **two jobs in order**: **(1) MAINTAIN** the existing `suggestion` issues in **Linear** — resolve/cancel
> what's provably done, link duplicates, refresh what drifted, split what's oversized — then
> **(2) DISCOVER** high-value new work and file it **into Linear's Triage**. **Read-only on code** (never
> edit files or open PRs), and **only ever writes to issues it owns** (`suggestion`-labeled). The paired
> **triage** automation ([`linear-triage.md`](linear-triage.md)) then prioritizes and buckets what lands
> in Triage — this skill does **not** do triage.

**Issues live in Linear. Never create a GitHub issue.** All creates/updates here go to **Linear** via the
`LINEAR_API_KEY` (see [Linear API access](../../docs/internal/ci-cd/CURSOR_AUTOMATIONS.md#linear-api-access-shared-by-both-automations) for auth, the GraphQL helper, and the ID cache). Transport-agnostic: if a Linear MCP is available in your environment, its tools are fine too — what matters is that the write lands in Linear.

---

## Ownership boundary (read first — hard invariant)

This automation owns **only the issues it filed** — those carrying the **`suggestion`** label. It may
cancel, re-label, comment on, re-body, mark-duplicate, set priority/estimate, or split **only those**.

> **Every other issue — epics, Projects, planning items, anything a human filed — is strictly READ-ONLY.**
> Reference or link to them freely; **never edit, reopen, cancel, or move them.**

- **Pre-write gate (mandatory).** Before *any* write to an issue, fetch its labels and confirm
  `suggestion` is present; if not, **SKIP and log it** — do not write. (GraphQL: read `labels { nodes { name } }` for the issue id; only proceed if `suggestion` ∈ that set.)
- **Duplicate across the boundary.** If a suggestion duplicates a human/internal (non-`suggestion`)
  issue, cancel **your suggestion** and relate it to the internal one — **never touch the internal issue**
  (at most one back-reference comment).

---

## Run order: maintain first, then discover

1. **Phase 1 — Maintenance** over open `suggestion` issues (always first).
2. **Phase 2 — Discovery** across three lenses, **budgeted by what Phase 1 found**.

Authenticate once at the start (verify `viewer` resolves — see the shared Linear API access doc).

---

## Phase 1 — Maintenance pass (`suggestion` issues)

Pull the open suggestion set (states other than Done/Canceled/Duplicate) and triage each. Pick **exactly
one** action per issue, grounded in **current code and `spec/`** (not a hunch):

| Situation (must be provable from code/spec) | Action |
| --- | --- |
| Referenced behavior now **exists / implemented** — the suggestion is **done** | Set state **Done** + comment citing the proving file/path (and PR if known) |
| Code/spec **moved on** so it's **moot / superseded** | Set state **Canceled** + comment why it's obsolete |
| **Duplicate** of another `suggestion` issue | **Cancel the newer/worse-specified one**, create a `duplicate` relation to the canonical, comment the link. Never edit the canonical beyond a back-link |
| Intent **still valid** but file/line refs or context **drifted** | **Refresh the description** (fix paths/snippet/spec quote); keep the `fp=` marker. Leave open |
| **Aging / uncertain** — you **cannot prove** resolved/duplicate/obsolete | Add the **`stale`** label + a short comment ("no longer matches X as of <date>; confirm or close"). **Leave it open** |
| Still accurate and active | **Skip** — leave untouched |

**The bar for Done/Canceled is "provable."** Only close when you can point at the code or spec that makes
it so. Otherwise mark **`stale`** and leave it open. When in doubt, do not close.

**Split a genuinely oversized suggestion** into Linear **sub-issues** (set each child's `parentId` to the
parent) only when each child is independently executable; each child is a normal suggestion (its own
`suggestion` + `area:<x>` labels + its own `fp=` marker). The parent keeps a checklist.

GraphQL for state changes, comments, relations, and sub-issues: see the shared
[Linear API access](../../docs/internal/ci-cd/CURSOR_AUTOMATIONS.md#linear-api-access-shared-by-both-automations).

---

## Phase 2 — Discovery pass (three lenses) — budget-bound

Surface high-value work the project doesn't already track. **Not a diff review:** if a merged PR triggered
the run, treat it as one small signal and look across the whole codebase, the spec, and the UX.

### Net-growth budget (this is what stops the backlog ballooning)

- **Maintenance first.** Prune/consolidate before filing anything new.
- **Prefer refreshing an existing near-match over filing new.**
- **Conservative net-new cap.** File at most **~3** net-new suggestions per run; when there are **> 40 open
  `suggestion` issues**, cap at **~2** and spend the run consolidating. A run that **nets negative** is a
  great outcome.
- **Cap guard.** Linear Free allows **250 active** issues. Before creating, check the active count; if near
  the cap, **file nothing** and consolidate instead (closed issues auto-archive — Done after 28d, Canceled
  after 7d — and free slots automatically).
- **No quota, quality gate only.** Filing **zero** is valid and common. Never pad a run.

### Lens 1 — Engineering gaps
Run the audit playbook ([`audit.md`](audit.md)): `npm run check-types`, `npm run lint`, `npm audit`,
`npm run check:api-contract`, `npm run check:migration-safety`. On a fresh sandbox build shared packages
first (`npx turbo run build --filter=./packages/*`). Plus: weak tests on complex logic, N+1/in-memory
aggregation, large unsplit modules, auth-guard/RLS gaps, secret exposure, CI holes. Treat `lint --fix`
edits as throwaway (`git checkout -- .`); never commit.

### Lens 2 — Product & behavior gaps (grounded in `spec/`)
Compare `spec/product/`, `spec/behavior/`, `spec/architecture/`, `spec/ui/` against what's implemented:
unbuilt/partial spec'd features, missing cross-surface flows, unimplemented invariants/edge-cases/anti-fraud.
A spec'd capability with no/partial code is a **product gap** worth filing.

### Lens 3 — Creative next steps & research, including existing Projects
Beyond fixing what's broken, propose where to go next — inventive but concrete (a spike, a short design
doc, a metric to add). **Ideate against the live Linear Projects, not just the codebase:** read the open
Projects (Chat rework, AI features, Pricing & billing, Analytics, Platform, Security) and propose
self-contained next issues that advance them — set such an issue's `projectId` so triage can place it.
Label forward-looking items `area:research`.

---

## Filing a new issue (into Linear Triage)

Every issue this flow **creates**:
- State = **Triage** (intake; the triage automation prioritizes and buckets it).
- Labels: **`suggestion`** (always — the ownership/dedup/lifecycle anchor) + exactly one **`area:<x>`**.
- **Priority** set (1 Urgent…4 Low) from impact — Linear requires a priority to leave Triage, so set it now.
- Optional `projectId` when the idea clearly belongs to an existing Project (Lens 3).
- Description in the template below, ending with the hidden `fp=` dedup marker.

**Dedup (idempotent re-runs).** Fingerprint `fp = <area>/<slug(title)>` anchored to `file=<primary-path>`
(no line number). Before creating: fetch open+canceled+done `suggestion` issues and search descriptions for
the `fp=` string; if found → **skip** (or refresh the open one). Embed the marker:
`<!-- cursor-suggestion: v1 fp=<area>/<slug> file=<path> -->`.

### Description template
```markdown
### Summary
<one sentence>

### Category
`area:<x>` · `type:<gap|improvement|idea>` · priority:<urgent|high|medium|low>

### Location
`path/to/file.ext:line`  (or `spec/...` for product/behavior items)

### Description
<what's wrong, missing, or worth pursuing>

### Rationale & impact
<why it matters — tie product/behavior items to the spec or the user>

### Suggested fix / first step
<concrete next step; for ideas, the smallest spike>

### Acceptance criteria
- [ ] <objectively verifiable outcome>

---
<!-- cursor-suggestion: v1 fp=<area>/<slug> file=<primary-path> -->
_Filed by the Cursor "Linear Issue Curator" automation. Edit freely; keep the marker for dedup._
```
Title format: `[suggestion] <imperative title>`. `type:` is body metadata, not a label.

---

## Guardrails
- **Ownership boundary is absolute** — pre-write label gate before every write; never touch a non-`suggestion` issue.
- **Never** modify code, push branches, or open PRs. **Never** create GitHub issues — Linear only.
- **Never** print secret values (follow `AGENTS.md`).
- Ground every Done/Cancel in code/spec you can cite; else mark `stale`. Don't invent unscoped features.
- If a check can't run (e.g. Supabase down), note it in the issue rather than guessing.
- Zero new issues is a success, not a failure. Don't lower the bar to produce output.
- **Don't do triage's job** — set a sane priority and (optionally) project, but leave inbox grooming,
  re-bucketing, and Backlog promotion to [`linear-triage.md`](linear-triage.md).
