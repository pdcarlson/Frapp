# Skill: Suggestion Triage

> Use when running the Cursor "Suggestion Triage" automation (or doing it by hand). Each run does **two
> jobs in order**: **(1) MAINTAIN** the existing suggestion backlog — close what's resolved, link
> duplicates, refresh what drifted, split what's oversized — then **(2) DISCOVER** high-value new work.
> **Read-only on code** (never edit files or open PRs), and **only ever writes to issues it owns**
> (`label:suggestion`). See the ownership boundary below — it is a hard invariant.

---

## What this skill does

Keeps the `suggestion` issue set **healthy and high-signal**, not just growing. As the codebase moves
fast, old suggestions go stale, duplicate each other, and pile up faster than they're fixed. So before
surfacing anything new, the agent **prunes and consolidates** what's already filed; only then does it
look for genuinely new, well-formed work across three lenses (engineering / product & behavior /
creative). Re-runs are **idempotent** (a finding is never filed twice) and **net-conservative** (a run
that closes more than it opens is a success).

This skill is the behavior contract for the automation in
[`docs/internal/ci-cd/CURSOR_AUTOMATIONS.md`](../../docs/internal/ci-cd/CURSOR_AUTOMATIONS.md). The
dashboard prompt is intentionally thin — the real rules live here.

---

## Ownership boundary (read this first — it is the hard invariant)

Cursor owns **only the issues it filed** — the ones carrying the **`suggestion`** label. It may close,
re-label, comment on, re-body, mark-duplicate, or split **only those**.

> **Every other issue — backlog work units, epics, and anything a human filed — is strictly READ-ONLY.**
> Reference or link to them freely; **never edit, relabel, reopen, or close them.**

- **Pre-write gate (mandatory).** Before *any* write/close/relabel/comment-to-close, fetch the issue's
  labels and confirm `suggestion` is present:

  ```bash
  gh issue view <N> --repo pdcarlson/Frapp --json labels -q '.labels[].name' | grep -qx suggestion \
    || { echo "issue #<N> is not Cursor-owned (no suggestion label) — SKIP, do not write"; }
  ```

  No `suggestion` label ⇒ **do not write**. This is non-negotiable; it is what protects the user's own
  project management from automated edits.
- **Duplicate across the boundary.** If a suggestion duplicates a human/internal (non-`suggestion`)
  issue, close **your suggestion** as a duplicate of the internal one — **never touch the internal
  issue** (at most one back-reference comment on it is allowed; nothing else).
- A plain comment that *references* a non-owned issue (e.g. "related to #123") is fine. Closing,
  relabeling, retitling, or editing its body is not.

---

## Run order: maintain first, then discover

1. **Phase 1 — Maintenance** over existing open `suggestion` issues (always first).
2. **Phase 2 — Discovery** across the three lenses, **budgeted by what Phase 1 found** (a large or
   freshly-pruned backlog tightens the net-new budget — see the budget rule).

Authenticate `gh` once at the very start (see "Authenticate `gh` first" below) before either phase.

---

## Phase 1 — Maintenance pass (existing `suggestion` issues)

Pull the open suggestion set and triage each one. Pick **exactly one** action per issue.

```bash
gh issue list --repo pdcarlson/Frapp --state open --label suggestion \
  --json number,title,labels,body,updatedAt --limit 200
```

For each issue, verify the `suggestion` label (pre-write gate) and check whether what the issue claims
still matches the **current code and `spec/`**:

| Situation (must be grounded in code/spec, not a hunch) | Action |
| --- | --- |
| The referenced file/behavior now **exists / is implemented** — the suggestion is **done** | **Close** `completed` + comment citing the proving file/path (and commit/PR if known) |
| The code/spec **moved on** so the suggestion is **moot / no longer applies** (feature cut, file deleted, approach superseded) | **Close** `not planned` + comment explaining why it's obsolete |
| **Duplicate** of another `suggestion` issue (same intent) | **Close the newer / worse-specified one** as a duplicate, linking the canonical (see below). Never edit the canonical beyond an optional back-link comment |
| Intent **still valid**, but file/line refs, snippet, or context have **drifted** | **Refresh the body** (fix paths, refresh the snippet/spec quote); keep the `fp=` marker. Leave open |
| **Aging / uncertain** — you **cannot prove** it's resolved, duplicate, or obsolete | **Add `stale` label + a short comment** ("no longer matches X as of <date>; confirm or close"). **Leave it open** for a human / `/triage` to decide |
| Still accurate and active | **Skip** — leave untouched |

**The bar for closing is "provable."** Only close as resolved/obsolete when you can point at the code or
spec that makes it so. If you're inferring or guessing, you **mark `stale`** instead and leave it open —
closing is reserved for the cases you can defend with a citation. When in doubt, do not close.

### How to close / link (Cursor uses `gh`; Claude-here uses the GitHub MCP)

```bash
# Resolved (implemented):
gh issue close <N> --repo pdcarlson/Frapp --reason completed \
  --comment "Resolved: implemented in \`path/to/file.ext\` (PR #NN). Closing the suggestion."

# Obsolete (no longer applies):
gh issue close <N> --repo pdcarlson/Frapp --reason "not planned" \
  --comment "Obsolete: <what changed> means this no longer applies. Closing."

# Duplicate — prefer GitHub's NATIVE duplicate so the issues are formally linked:
gh api -X PATCH repos/pdcarlson/Frapp/issues/<dupe> -f state=closed -f state_reason=duplicate >/dev/null \
  && gh issue comment <dupe> --repo pdcarlson/Frapp --body "Duplicate of #<canonical> — consolidating there."
# If this build's API rejects state_reason=duplicate, fall back to a linked not-planned close:
#   gh issue close <dupe> --repo pdcarlson/Frapp --reason "not planned" \
#     --comment "Duplicate of #<canonical> — <one-line why>. Consolidating there."

# Refresh an inaccurate body (keep the fp= marker intact):
gh issue edit <N> --repo pdcarlson/Frapp --body-file refreshed-body.md

# Mark stale (do NOT close):
gh issue edit <N> --repo pdcarlson/Frapp --add-label stale
gh issue comment <N> --repo pdcarlson/Frapp --body "Stale: no longer matches \`path/...\` as of $(date +%F). Confirm or close."
```

Claude-here equivalents (GitHub MCP): `issue_write method=update` with `state=closed` +
`state_reason=completed|not_planned|duplicate` (+ `duplicate_of:<canonical#>` for duplicates),
`add_issue_comment` for the comment, `issue_write` `labels` to add `stale`.

### Sub-issues — split a genuinely oversized suggestion

When one open `suggestion` issue really contains **several independently-executable pieces**, break it
into native GitHub **sub-issues** rather than leaving an un-actionable mega-issue (this is also a clean
way to reduce churn — one parent that fans out, instead of 3–4 loose new issues later).

- Only split when each child is **independently executable**; otherwise leave it whole.
- Each child is a normal suggestion: `suggestion` + inherited `area:<x>`/`severity:<x>` + its **own**
  `fp=<area>/<slug>` marker and body template. The parent keeps a checklist linking the children.

```bash
# Get node IDs (sub-issue links use GraphQL node IDs, not numbers):
PARENT=$(gh issue view <parent#> --repo pdcarlson/Frapp --json id -q .id)
CHILD=$(gh issue view <child#>  --repo pdcarlson/Frapp --json id -q .id)
gh api graphql -f query='mutation($p:ID!,$c:ID!){ addSubIssue(input:{issueId:$p, subIssueId:$c}){ subIssue{ number } } }' \
  -F p="$PARENT" -F c="$CHILD"
```

Claude-here equivalent: `sub_issue_write method=add issue_number=<parent#> sub_issue_id=<child node/id>`.

---

## Phase 2 — Discovery pass (three lenses) — budget-bound

Surface high-value work the project doesn't already track. **This is not a diff review**: if a merged PR
triggered the run, treat that PR as **one small signal** and look across the whole codebase, the spec,
and the user experience.

### Net-growth budget (this is what stops the backlog ballooning)

- **Maintenance first.** Spend the run pruning/consolidating before filing anything new.
- **Prefer fixing an existing near-match over filing new.** If a finding is ~the same as an open
  suggestion, **refresh that one** instead of creating a second.
- **Cap net-new, and tighten it when the backlog is already big.** File at most **~5** net-new
  suggestions per run; when there are **> 40 open `suggestion` issues**, cap at **~2** and spend the run
  consolidating instead. A run that **nets negative** (closes/merges more than it opens) is a great
  outcome, not a failure.
- **No quota, quality gate only.** Filing **zero** new issues remains valid and common. Never pad a run
  or manufacture findings to broaden coverage. Keep at most ~2 findings from the most-recently-changed
  files; spread genuine findings across areas rather than clustering.

### Lens 1 — Engineering gaps (concrete)

Reuse the audit playbook — read [`audit.md`](audit.md) and run its checks:

```bash
npm run check-types          # type holes, any, @ts-ignore
npm run lint                 # lint violations
npm audit                    # dependency vulnerabilities
npm run check:api-contract   # openapi.json / SDK drift
npm run check:migration-safety
```

On a **fresh sandbox**, build shared packages before type-checking or `check-types` fails on unresolved
workspace types:

```bash
npx turbo run build --filter=./packages/*   # then npm run check-types resolves
```

Plus what tools miss: weak/missing tests on complex logic, N+1 / in-memory aggregation, large unsplit
modules, auth-guard/RLS gaps, secret exposure, CI coverage holes.

### Lens 2 — Product & behavior gaps (grounded in `spec/`)

The spec is the source of truth — compare it against what's actually implemented:

- **`spec/product/`** (the core domains under `modules.md`: IAM, Backwork, Financials, Comms, Events,
  Polls, Service Hours, Tasks, Semester Rollover, Reports, Alumni, …) — which domains are **unbuilt or
  only partial**? Which **phased features** (v2 / v3+) are now ready to start? Which **user flows are
  missing across surfaces** (landing / web / mobile)?
- **`spec/behavior/`** — which **invariants, edge cases, role-lifecycle / presidency-transfer rules,
  anti-fraud, atomicity** aren't implemented or tested? Start at `behavior/README.md`.
- **`spec/architecture/README.md`** + the **`spec/ui/`** files — drift between intended and actual
  architecture; cross-surface inconsistency; missing resilience, empty, error, and loading states;
  accessibility gaps.

A spec'd capability with no or partial code is a **product gap**, not just a tech nit — file it.

### Lens 3 — Creative next steps & research (forward-looking)

Beyond fixing what's broken, propose where to go next — inventive but concrete:

- **Product next steps:** natural extensions of existing features, gaps a real user would hit,
  opportunities to increase value or stickiness.
- **Research & experiments:** metrics/instrumentation worth adding, questions to validate, A/B or
  prototype ideas, competitive/UX investigations.
- Frame each as an **actionable first step** (a spike, a short design doc, a prototype, a metric to add)
  — never a vague "consider improving X". Mark `type:idea` so they're easy to filter from must-fix work.

---

## Finding metadata

Capture for every new finding:

- **title** — short imperative, e.g. "Build member-directory export (spec 3.15)".
- **area** — one of the `area:` values below.
- **type** — `gap` (missing/broken) · `improvement` (make existing better) · `idea` (exploratory).
- **priority** — `critical` | `high` | `medium` | `low` (impact-based; for ideas, how promising).
- **location** — `path/to/file.ext:line` for code, or the relevant `spec/…` section.
- **description**, **rationale & impact**, **context** (snippet or spec quote), **suggested fix / first step**.

**Areas → `area:` label:**

| Area | `area:` value | Typical findings |
|------|---------------|------------------|
| Web / landing / mobile UI | `web` | untested components, large style blocks, a11y |
| NestJS API | `api` | missing guards, contract drift, service layering |
| Database / migrations | `db` | missing RLS, unsafe migration, missing index |
| Dependencies | `deps` | CVEs, majorly outdated, license risk |
| Security (cross-cutting) | `security` | auth bypass, secret exposure, injection |
| CI / CD | `ci` | workflow gaps, secret exposure in logs |
| Docs / spec | `docs` | spec drift, missing runbook |
| **Product / feature** | `product` | unbuilt or partial spec'd features, missing flows |
| **Behavior / UX** | `ux` | unhandled edge cases, empty/error states, confusing flows |
| **Research / next steps** | `research` | experiments, metrics, product investigations |

---

## Labels

Every issue this flow **creates** gets:

- `suggestion` — always (the **ownership + dedup + lifecycle anchor**; it is what marks an issue as
  Cursor-owned and therefore safe for this flow to modify).
- `area:<x>` — exactly one (table above).
- `severity:<critical|high|medium|low>` — exactly one (priority/impact).
- `agent-ready` — add when fully specified and safe to hand to an agent (see `AGENTS.md`).

Lifecycle labels this flow **applies** during maintenance:

- `stale` — an aging suggestion that no longer cleanly matches the code/spec but **can't be proven**
  resolved/obsolete; left open for a human / `/triage` to confirm or close.

If a label doesn't exist yet, create it (one-time). Colors:
[`docs/internal/ci-cd/CURSOR_AUTOMATIONS.md`](../../docs/internal/ci-cd/CURSOR_AUTOMATIONS.md).

---

## Deduplication (idempotent re-runs)

Each finding has a stable **fingerprint** built from values that survive edits:

```
fp = <area>/<slug(title)>            anchored to     file=<primary-file-or-spec-path>
```

- `slug(title)` = lowercase, non-alphanumerics → `-`, collapsed.
- **Do not** include the line number — lines drift across commits.
- When you **refresh** an issue in maintenance, keep the existing `fp=` marker unless the title changes
  materially; re-slug only then.

### Authenticate `gh` first (do not skip)

The Cursor sandbox pre-authenticates `gh` as **Cursor's GitHub App**, which can't manage labels or write
issues — it fails with `HTTP 403: Resource not accessible by integration`. Force `gh` to use the repo PAT
at the start of the run:

```bash
export GH_TOKEN="${GITHUB_PAT:?missing GITHUB_PAT secret}"   # gh reads GH_TOKEN, not GITHUB_PAT
gh api user -q .login   # must print YOUR username, not a bot/app
```

`GITHUB_PAT` is the repo's canonical fine-grained PAT (**Issues: Read and write** on `pdcarlson/Frapp`).
That single scope already covers **everything this skill does** — create, comment, relabel, close
(`completed`/`not planned`/`duplicate`), and add sub-issues. **No extra permission is needed.** If
`gh api user` still shows a bot/app, the secret isn't reaching the shell; fix it before continuing.

Before **creating** an issue:

1. Search existing issues **open and closed** with `label:suggestion` for the fingerprint string, e.g.
   `gh issue list --repo pdcarlson/Frapp --state all --label suggestion --search "fp=<area>/<slug>" --json number,title`.
2. If a match exists → **skip** (or, if the match is open and inaccurate, **refresh** it in Phase 1
   instead of filing a new one).
3. Only if no match exists → create it: `gh issue create --repo pdcarlson/Frapp --title "[suggestion] …" --body-file <file> --label suggestion --label area:<x> --label severity:<x>`.

The fingerprint is embedded as a hidden HTML comment so it's searchable but invisible:

```html
<!-- cursor-suggestion: v1 fp=<area>/<slug> file=<primary-file-or-spec-path> -->
```

---

## Issue body template

Keep every issue in this exact shape so the backlog reads consistently:

```markdown
### Summary
<one-sentence description>

### Category
`area:<x>` · `type:<gap|improvement|idea>` · `severity:<x>`

### Location
`path/to/file.ext:line`  (or `spec/product/<topic>.md` / `spec/behavior/<topic>.md` for product/behavior items)

### Description
<what's wrong, missing, or worth pursuing>

### Rationale & impact
<why it matters — tie product/behavior items back to the spec or the user>

### Context
```<lang>
<short code snippet, or a quoted spec excerpt>
```

### Suggested fix / proposed first step
<concrete next step; for ideas, the smallest experiment/spike to start>

### Acceptance criteria
- [ ] <objectively verifiable outcome>

---
<!-- cursor-suggestion: v1 fp=<area>/<slug> file=<primary-file-or-spec-path> -->
_Filed automatically by the Cursor "Suggestion Triage" automation. Edit freely; keep the marker above for dedup._
```

Title format: `[suggestion] <title>`.

---

## Guardrails

- **Ownership boundary is absolute** — only ever write to (`suggestion`-labeled) issues you own; run the
  pre-write label gate before every write/close. Never edit or close a human/internal issue.
- **Never** modify code, push branches, or open PRs from this flow — issues only.
- Treat every check as **read-only**. `npm run lint` runs `eslint --fix` and will modify source — discard
  any edits it makes (`git checkout -- .`) before finishing, or run eslint without `--fix`. Never commit
  or push.
- **Never** print secret values (follow `AGENTS.md`).
- Ground every maintenance **close** in code/spec you can cite; when you can't, mark `stale` instead.
  Ground product/behavior **findings** in the spec or code — don't invent features the project hasn't
  scoped. Ideas can be inventive, but say so (`type:idea`) and keep them in Frapp's domain.
- If a check can't run in the sandbox (e.g. Supabase down), note it in the relevant issue rather than
  guessing — and don't claim a verification you didn't run.
- A run that files **zero** new issues — or that **only** closes/merges/refreshes existing ones — is a
  success, not a failure. Do not lower the bar to produce output.

---

## After Linear lands (transitional note)

Frapp is adopting **Linear** as its canonical project-management system (see **ADR-16** in
`spec/architecture/README.md` and [`docs/internal/ci-cd/LINEAR_PM.md`](../../docs/internal/ci-cd/LINEAR_PM.md)).
Until the cut-over completes, **this flow is unchanged** — GitHub issues remain Cursor's intake surface and
Linear ingests them via its GitHub sync. The ownership boundary carries over verbatim: Cursor still only
touches `suggestion`-labeled items; human/internal Linear work is off-limits. Whether Cursor should file
directly into Linear post-cut-over is tracked as a separate follow-up — do not change this flow until that
issue is resolved.

---

## Updating this skill

- Keep the area table and label list in sync with [`audit.md`](audit.md) and the labels section of
  `AGENTS.md` / [`docs/internal/ci-cd/CURSOR_AUTOMATIONS.md`](../../docs/internal/ci-cd/CURSOR_AUTOMATIONS.md).
- If the fingerprint scheme changes, bump the `v1` marker version so old issues aren't mistaken for new.
- The dashboard prompt is thin and defers here; only re-paste it if the prompt block itself changes.
</content>
</invoke>
