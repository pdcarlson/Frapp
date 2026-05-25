# Skill: Suggestion Triage

> Use when running the Cursor "Suggestion Triage" automation (or doing it by hand): perform a **broad, repo-wide product and engineering review** and file the findings as deduplicated, labeled GitHub issues. **Read-only on code — never edit files or open PRs from this flow.**

---

## What this skill does

Surfaces high-value work across the whole project — not just bugs and not just the last diff — and turns each item into a well-formed GitHub issue a fresh agent can execute cold. Findings span three lenses: **engineering gaps**, **product & behavior gaps**, and **creative next steps / research**. Re-runs are **idempotent**: an existing finding is never filed twice.

This skill is the behavior contract for the automation in [`docs/internal/CURSOR_AUTOMATIONS.md`](../../docs/internal/CURSOR_AUTOMATIONS.md). The dashboard prompt is intentionally thin — the real rules live here.

---

## Scope: review the whole product, not the last PR

This is **not** a diff review. If a merged PR triggered this run, treat that PR as **one small signal** — most findings should come from broad analysis across the entire codebase, the product spec (`spec/`), and the user experience.

To keep the backlog broadening over time rather than re-mining the same files:

- **Before starting, skim existing open `suggestion` issues** (`gh issue list --repo pdcarlson/Frapp --state open --label suggestion --json title,labels`) to see what's already covered, and deliberately explore **under-covered domains and surfaces**.
- **Vary your lens each run.** Rotate across the product domains and the three lenses below.
- **Balance guardrail per run:** at most ~2 findings from the most recently changed files; span **at least 3 different areas**; include **at least 2** product/behavior/UX or research items. Aim for **~6–10 findings** total — quality and breadth over volume.

---

## The three lenses

### Lens 1 — Engineering gaps (concrete)

Reuse the audit playbook — read [`audit.md`](audit.md) and run its checks:

```bash
npm run check-types          # type holes, any, @ts-ignore
npm run lint                 # lint violations
npm audit                    # dependency vulnerabilities
npm run check:api-contract   # openapi.json / SDK drift
npm run check:migration-safety
```

On a **fresh sandbox**, build shared packages before type-checking or `check-types` fails on unresolved workspace types:

```bash
npx turbo run build --filter=./packages/*   # then npm run check-types resolves
```

Plus what tools miss: weak/missing tests on complex logic, N+1 / in-memory aggregation, large unsplit modules, auth-guard/RLS gaps, secret exposure, CI coverage holes.

### Lens 2 — Product & behavior gaps (grounded in `spec/`)

The spec is the source of truth — compare it against what's actually implemented:

- **`spec/product.md`** (16 core domains: IAM, Backwork, Financials, Comms, Events, Polls, Service Hours, Tasks, Semester Rollover, Reports, Alumni, …) — which domains are **unbuilt or only partial**? Which **phased features** (marked v2 / v3+) are now ready to start? Which **user flows are missing across surfaces** (landing / web / mobile)?
- **`spec/behavior.md`** — which **invariants, edge cases, role-lifecycle / presidency-transfer rules, anti-fraud, atomicity** aren't implemented or tested?
- **`spec/architecture.md`** + the **`spec/ui-*.md`** files — drift between intended and actual architecture; cross-surface inconsistency; missing resilience, empty, error, and loading states; accessibility gaps.

A spec'd capability with no or partial code is a **product gap**, not just a tech nit — file it.

### Lens 3 — Creative next steps & research (forward-looking)

Beyond fixing what's broken, propose where to go next — be inventive but concrete:

- **Product next steps:** natural extensions of existing features, gaps a real user would hit, opportunities to increase value or stickiness.
- **Research & experiments:** metrics/instrumentation worth adding, questions to validate, A/B or prototype ideas, competitive/UX investigations.
- Frame each as an **actionable first step** (a spike, a short design doc, a prototype, a metric to add) — never a vague "consider improving X."

These are exploratory: set priority by impact, and mark `type:idea` so they're easy to filter from must-fix work.

---

## Finding metadata

Capture for every finding:

- **title** — short imperative, e.g. "Build member-directory export (spec 3.15)".
- **area** — one of the `area:` values below.
- **type** — `gap` (missing/broken) · `improvement` (make existing better) · `idea` (exploratory/research).
- **priority** — `critical` | `high` | `medium` | `low` (impact-based; for ideas, how promising).
- **location** — `path/to/file.ext:line` for code, or the relevant `spec/…` section for product/behavior items.
- **description**, **rationale & impact**, **context** (snippet or spec quote), **suggested fix / proposed first step**.

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

Every issue this flow creates gets:

- `suggestion` — always (the dedup/lifecycle anchor).
- `area:<x>` — exactly one (table above).
- `severity:<critical|high|medium|low>` — exactly one (priority/impact).
- `agent-ready` — add when fully specified and safe to hand to an agent (see `AGENTS.md`).

If a label doesn't exist yet, create it (one-time). Colors: [`docs/internal/CURSOR_AUTOMATIONS.md`](../../docs/internal/CURSOR_AUTOMATIONS.md).

---

## Deduplication (idempotent re-runs)

Each finding has a stable **fingerprint** built from values that survive edits:

```
fp = <area>/<slug(title)>            anchored to     file=<primary-file-or-spec-path>
```

- `slug(title)` = lowercase, non-alphanumerics → `-`, collapsed.
- **Do not** include the line number — lines drift across commits.

### Authenticate `gh` first (do not skip)

The Cursor sandbox pre-authenticates `gh` as **Cursor's GitHub App**, which can't manage labels or write issues — it fails with `HTTP 403: Resource not accessible by integration`. Force `gh` to use the repo PAT at the start of the run:

```bash
export GH_TOKEN="${GITHUB_PAT:?missing GITHUB_PAT secret}"   # gh reads GH_TOKEN, not GITHUB_PAT; this overrides Cursor's App auth
gh api user -q .login   # must print YOUR username, not a bot/app
```

`GITHUB_PAT` is the repo's canonical GitHub PAT (fine-grained, **Issues: Read and write** on `pdcarlson/Frapp`, which also covers `gh label create`) and is distinct from Cursor's injected `GITHUB_TOKEN`/App token — so exporting it as `GH_TOKEN` cleanly overrides the App. If `gh api user` still shows a bot/app, the secret isn't reaching the shell; fix it before continuing. No MCP server needed.

Before creating an issue:

1. Search existing issues **open and closed** with `label:suggestion` for the fingerprint string (it lives in the body marker), e.g.
   `gh issue list --repo pdcarlson/Frapp --state all --label suggestion --search "fp=<area>/<slug>" --json number,title`.
2. If a match exists → **skip** (do not comment, do not reopen).
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
`path/to/file.ext:line`  (or `spec/product.md §3.x` for product/behavior items)

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

- **Never** modify code, push branches, or open PRs from this flow — issues only.
- Treat every check as **read-only**. `npm run lint` runs `eslint --fix` and will modify source — discard any edits it makes (`git checkout -- .`) before finishing, or run eslint without `--fix`. Never commit or push.
- **Never** print secret values (follow `AGENTS.md`).
- Ground product/behavior claims in the spec or code — don't invent features the project hasn't scoped. Ideas can be inventive, but say so (`type:idea`) and keep them relevant to Frapp's domain.
- If a check can't run in the sandbox (e.g. Supabase down), note it in the relevant issue rather than guessing — and don't claim a verification you didn't run.
- If nothing new is found, take no action and report "no new suggestions".

---

## Updating this skill

- Keep the area table and label list in sync with `.cursor/skills/audit.md` and the labels section of `AGENTS.md`.
- If the fingerprint scheme changes, bump the `v1` marker version so old issues aren't mistaken for new ones.
