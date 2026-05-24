# Skill: Suggestion Triage

> Use when running the Cursor "Suggestion Triage" automation (or doing it by hand): audit the codebase for high-value improvements and file them as deduplicated, labeled GitHub issues. **Read-only on code — never edit files or open PRs from this flow.**

---

## What this skill does

Reproduces the kind of findings you'd see in a "suggestions" panel (missing tests, code-health, performance, security, dependency, contract/DB/CI risks) and turns each into a well-formed GitHub issue that a fresh agent can execute cold. Re-runs are **idempotent**: an existing finding is never filed twice.

This skill is the behavior contract for the Cursor automation documented in [`docs/internal/CURSOR_AUTOMATIONS.md`](../../docs/internal/CURSOR_AUTOMATIONS.md). The automation prompt is intentionally thin — the real rules live here.

---

## Where findings come from

Reuse the existing audit playbook — do not reinvent it. Read [`audit.md`](audit.md) and run the checks it lists, prioritizing **recently changed and high-risk areas**:

```bash
npm run check-types          # type holes, any, @ts-ignore
npm run lint                 # lint violations
npm audit                    # dependency vulnerabilities
npm run check:api-contract   # openapi.json / SDK drift
npm run check:migration-safety
```

Then review for things tools don't catch: missing/weak tests on complex logic, N+1 / in-memory aggregation, large unsplit modules, auth-guard/RLS gaps, secret exposure.

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

---

## Finding metadata (mirror the panel fields)

Capture for every finding:

- **title** — short imperative, e.g. "Add unit tests for EventDetailSheet".
- **area** — one of the `area:` values above.
- **severity** — `critical` | `high` | `medium` | `low`.
- **location** — `path/to/file.ext:line` (best-effort line).
- **description** — what's wrong / missing.
- **rationale & impact** — why it matters (the panel's "Rationale").
- **code context** — a short snippet at the location.
- **suggested fix** — concrete next step.

**Volume guard:** at most ~8 findings per run. Prefer a few high-impact items over noise; bias toward `critical`/`high` and the code that changed in the triggering PR.

---

## Labels

Every issue this flow creates gets:

- `suggestion` — always (this is the dedup/lifecycle anchor).
- `area:<x>` — exactly one (table above).
- `severity:<critical|high|medium|low>` — exactly one.
- `agent-ready` — add when the issue is fully specified and safe to hand to an agent (see `AGENTS.md`).

If a label doesn't exist yet, create it (one-time). Color guidance is in [`docs/internal/CURSOR_AUTOMATIONS.md`](../../docs/internal/CURSOR_AUTOMATIONS.md).

---

## Deduplication (idempotent re-runs)

Each finding has a stable **fingerprint** built from values that survive edits:

```
fp = <area>/<slug(title)>            anchored to     file=<primary-file-path>
```

- `slug(title)` = lowercase, non-alphanumerics → `-`, collapsed.
- **Do not** include the line number — lines drift across commits.

Before creating an issue:

1. Search existing issues **open and closed** with `label:suggestion` for the fingerprint string (it lives in the body marker). Example query: `repo:<owner>/<repo> is:issue label:suggestion "fp=<area>/<slug>"`.
2. If a match exists → **skip** (do not comment, do not reopen). 
3. Only if no match exists → create the issue.

The fingerprint is embedded as a hidden HTML comment so it's searchable but invisible:

```html
<!-- cursor-suggestion: v1 fp=<area>/<slug> file=<primary-file-path> -->
```

---

## Issue body template

Keep every issue in this exact shape so the backlog reads consistently:

```markdown
### Summary
<one-sentence description>

### Category
`area:<x>` · `severity:<x>`

### Location
`path/to/file.ext:line`

### Description
<what's wrong or missing>

### Rationale & impact
<why it matters>

### Code context
```<lang>
<short snippet at the location>
```

### Suggested fix
<concrete next step; helpers to reuse; gotchas>

### Acceptance criteria
- [ ] <objectively verifiable outcome>

---
<!-- cursor-suggestion: v1 fp=<area>/<slug> file=<primary-file-path> -->
_Filed automatically by the Cursor "Suggestion Triage" automation. Edit freely; keep the marker above for dedup._
```

Title format: `[suggestion] <title>`.

---

## Guardrails

- **Never** modify code, push branches, or open PRs from this flow — issues only.
- **Never** print secret values (follow `AGENTS.md`).
- If a check can't run in the sandbox (e.g. Supabase down), note it in the relevant issue rather than guessing — and don't claim a verification you didn't run.
- If nothing new is found, take no action and report "no new suggestions".

---

## Updating this skill

- Keep the area table and label list in sync with `.cursor/skills/audit.md` and the labels section of `AGENTS.md`.
- If the fingerprint scheme changes, bump the `v1` marker version so old issues aren't mistaken for new ones.
