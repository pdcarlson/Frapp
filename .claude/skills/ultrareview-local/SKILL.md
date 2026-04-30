---
description: Manual local multi-pass bug-finding review of the current branch (or a PR). Spawns parallel reviewer subagents for security, correctness, and contract/data integrity, then a verification pass before reporting. Complement to Anthropic's first-party /ultrareview, not a replacement.
argument-hint: "[pr-number-or-branch]"
disable-model-invocation: true
allowed-tools: Agent, Bash(git *), Bash(gh pr *), Read, Grep, Glob
---

# /ultrareview-local

> Manual command. Run it yourself when you want a multi-pass, find-then-verify bug review on the current branch or a specific PR. **This complements Anthropic's first-party `/ultrareview` (which spins up a multi-agent cloud review) — it does not replace it.** Use this one when you want the work done in-session, against your live working tree, without leaving the terminal.

## What it does

1. Captures the diff vs `origin/main` (or vs the PR's base branch when an argument is supplied).
2. Spawns **three reviewer subagents in parallel**, each focused on one lens:
   - **Security** — auth/permissions, RLS, secret leakage, IDOR, webhook signatures, input validation.
   - **Correctness / logic** — control flow, off-by-one, null/empty, race conditions, lifecycle leaks.
   - **Contract / data integrity** — controller/DTO ↔ `openapi.json` ↔ `api-sdk/types.ts` ↔ call-site drift, migration safety, RLS-on-new-tables, rollback docs.
3. Spawns a **fourth reviewer pass** that takes the union of the first three reports and **verifies each finding against the actual code** before promoting it. Anything that fails verification is dropped or downgraded.
4. Prints a single consolidated report grouped by severity (Important / Nit / Pre-existing), every finding citing `file:line` with a one-line failure scenario and the verification evidence.

## Inputs

- No argument → review the current branch vs `origin/main` (`git merge-base HEAD origin/main`).
- Argument is a PR number (e.g. `42`) → review the PR's diff via `gh pr diff <n>` and `gh pr view <n>`.
- Argument is a branch name → review `<branch>` vs `origin/main`.

## Captured context

The orchestrator should pass each reviewer subagent a self-contained brief that includes:

- The list of changed files (`git diff --name-only`):

  !`git diff --name-only $(git merge-base HEAD origin/main)..HEAD 2>/dev/null || echo "(merge-base not found; rerun with an explicit PR or branch argument)"`

- The diff itself (`git diff`):

  !`git diff $(git merge-base HEAD origin/main)..HEAD 2>/dev/null | head -2000`

- The branch name and short log:

  !`git log --oneline $(git merge-base HEAD origin/main)..HEAD 2>/dev/null | head -20`

(If the user supplies a PR number, the orchestrator should re-fetch the diff via `gh pr diff $1` and `gh pr view $1` and pass *that* as the canonical diff.)

## Orchestration plan (what the orchestrator must do)

1. **Resolve the target.** If `$1` is set, treat it as a PR number first (`gh pr view $1`), then as a branch. Otherwise default to current-branch-vs-`origin/main`.
2. **Fan out three reviewer subagents in parallel** using the `Agent` tool with `subagent_type: "reviewer"`. Send all three `Agent` calls in a single message so they run concurrently. Each subagent gets:
   - A **lens** (security / correctness / contract+data) with explicit "in scope / out of scope" for that lens.
   - The full diff and the file list.
   - A reminder that they must cite `file:line` and verify each finding against the actual code before reporting.
3. **Wait for all three.** Collect their findings into a single working set, de-duplicating by `file:line + one-line hypothesis`.
4. **Fan in: spawn a fourth `reviewer` subagent** with the verification brief: "Here are N candidate findings from three earlier passes. For each, re-read the relevant code and confirm or reject it. Drop anything you cannot reproduce a concrete failure scenario for. Re-grade severity (Important / Nit / Pre-existing)."
5. **Render the final report** to the user using the same Markdown shape the `reviewer` subagent uses. Include a one-line "Verified by independent pass" footer.

## Subagent prompts (copy verbatim into the `Agent` calls)

### Security lens

> You are reviewing the diff below for **security bugs only**. In scope: missing auth guard, missing `@RequirePermissions`, RLS gap on a new table, secret leakage in logs/output/errors, IDOR (operating on a row owned by another chapter/user), unvalidated user input reaching SQL/shell, broken Stripe webhook signature handling, public exposure of server-only data in Next.js client components. Out of scope: style, perf, refactoring, contract drift. Cite `file:line`. Verify each finding by reading the surrounding code before reporting. If clean, say so.

### Correctness / logic lens

> You are reviewing the diff below for **correctness/logic bugs only**. In scope: wrong condition, inverted boolean, off-by-one, null/undefined-not-handled, empty-array path, time-zone, race condition, non-atomic read-modify-write, unhandled promise rejection, lifecycle/subscription leak, retry/idempotency double-fire, `.single()` used where `.maybeSingle()` is required. Out of scope: security (covered separately), contract drift (covered separately). Cite `file:line`. Verify before reporting.

### Contract / data integrity lens

> You are reviewing the diff below for **contract and data-integrity bugs only**. In scope: controller/DTO change without matching `openapi.json` + `packages/api-sdk/src/types.ts` update; web/mobile call site that drifts from the SDK; new table without `ENABLE ROW LEVEL SECURITY`; destructive SQL without a rollback note in `docs/internal/DB_ROLLBACK_PLAYBOOK.md`; migration filename that doesn't match `{14-digit timestamp}_{snake_case}.sql`; missing docs/spec update for non-doc code changes (`scripts/check-docs-impact.mjs`). Out of scope: pure logic bugs and security. Cite `file:line`. Verify before reporting.

### Verification pass

> You are the verifier. The list below is the union of candidate findings from three earlier reviewer passes. For each candidate: re-open the cited file, read the surrounding code and any relevant `CLAUDE.md` (root, `apps/api/`, `apps/web/`, `apps/mobile/`, `packages/`, `.github/workflows/`, `supabase/migrations/`), and decide: **Confirm (Important)**, **Confirm (Nit)**, **Pre-existing (do not block)**, or **Drop (false positive)**. For every Confirm, write one sentence describing the exact failure scenario and one sentence describing the verification evidence. Output the same Markdown shape as a normal reviewer report.

## Notes

- This skill is intentionally **manual-only** (`disable-model-invocation: true`). It costs more tokens than a single review pass, so the user should opt in.
- It is a *complement* to Anthropic's first-party `/ultrareview`, which runs a multi-agent review in the cloud. Use whichever fits the situation; results often catch slightly different things, and that's fine.
- The reviewer subagent definition lives at `.claude/agents/reviewer.md` and is `model: claude-opus-4-7`, read-only.
