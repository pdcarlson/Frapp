# Redesign chunk PR — reviewer checklist

Run this against every chunk PR (as the author before opening, and as the reviewer before merging). It encodes the failure modes seen in real chunk reviews. **Verify against the diff and the running code — never trust the PR body's self-report.**

## 1. Verify, don't trust

- [ ] Read the actual diff / checked-out branch, not just the PR description. A PR body claims intent; the code is truth.
- [ ] Every verification checkbox the author ticked was actually _run_. Boxes for steps the sandbox couldn't run (Docker/Supabase, screenshots) must be marked blocked with a linked tracking issue — not silently checked.
- [ ] CI is green **and** the green checks actually cover the change (e.g. static `migration-safety` passing is **not** the same as migrations applying to a real DB).

## 2. Security (highest priority for backend chunks)

- [ ] **No service-role / RLS-bypassing write on client-supplied IDs without an authorization pre-check.** If a server/Edge Function uses the service-role client, it must independently verify the actor may touch the target chapter/channel/resource. Resolve ownership from a trusted DB lookup, never from client-supplied chapter/channel fields.
- [ ] Actor identity comes from the session/JWT, never the client payload (this is necessary but **not sufficient** — see the line above).
- [ ] Every endpoint returning protected chapter/user data has the expected guard + explicit permission (exception: deliberately public flows like onboarding directory search — confirm it's intentional and over non-personal data).
- [ ] RLS enabled on every new table; append-only tables deny UPDATE/DELETE at the policy level.

## 3. Data model & migrations

- [ ] Migrations were applied to a real database somewhere (local or CI). If not, a runtime-verification issue is linked and the risk is called out.
- [ ] FKs on audit/history tables use `set null` (or no cascade), not `on delete cascade` that erases history.
- [ ] Indexes exist for the primary query paths; uniqueness/idempotency is enforced by a **DB constraint**, not only function logic.
- [ ] Runbook entries (promotion/rollback) updated in the same PR when required by CI.

## 4. Idempotency & concurrency (hot path)

- [ ] Dedup is enforced by a unique constraint, and the write path is atomic (`on conflict do nothing` / catch the unique violation) — not a read-then-insert TOCTOU.
- [ ] A unique-violation on retry returns a dedup success, not a 5xx.

## 5. Engineering principles (master-plan)

- [ ] No hardcoded actor/ids; "mine" filters filter by viewer.
- [ ] Catalog lookups go through guarded helpers with fallbacks (no bare `MAP[key]`).
- [ ] Seeds deep-cloned on materialization; shared exports frozen; no `window.*` app state.
- [ ] Numeric inputs guard-parse (no `NaN`); divisions guard the denominator; `find()` undefined handled.
- [ ] Interactive elements semantic (`<button>`/`<a>`, not `<div onClick>`); empty states explicit.
- [ ] Money columns validated as `int().nonnegative()` cents.

## 6. Plan hygiene

- [ ] PR body links the chunk brief and attests to each "Engineering principles applied here" bullet.
- [ ] Spec docs updated in the same PR (doc-sync CI).
- [ ] Issue closed on completion via `Closes #N` in the PR body (solo project — no *In Review* stage and no Projects v2 board shuffle; the issue's open/closed state is the status).
- [ ] Visual baselines: only the affected ones regenerated, listed with reasons + Chromium revision.
- [ ] Plan divergences edited into the brief / `spec/redesign-context.md` in the same PR.
- [ ] **ADR discipline.** Architecturally significant decisions — persistence layer, hot-path topology, agent infrastructure, security posture, anything that future sessions will need to know "why" about — land as a sequentially numbered ADR in `spec/architecture.md` in the same PR. Not as a code comment, not as a STATUS note, not as a PR-body paragraph that gets buried. Each ADR includes a **Trigger to revisit** clause naming the conditions under which the next session should reopen it.

## 7. CodeRabbit triage

- [ ] Each CodeRabbit thread is resolved or skipped with a stated reason. Beware **stale** threads (flagged on an earlier commit, fixed since but not marked resolved) and **wrong** suggestions (verify before applying — e.g. lowercasing case-sensitive font names).
- [ ] Critical/Major threads about SQL, RLS, auth, idempotency, or data integrity are not left silently open.
