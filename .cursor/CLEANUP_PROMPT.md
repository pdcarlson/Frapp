# Frapp / Cursor Cloud cleanup (Prompt 2)

You are running in a **later Cursor Cloud chat**, after Paul **Saved** the environment from Prompt 1 (`/env setup`, PR **#2029**). Confirm the GitHub remote with `git remote -v` (this Frapp checkout).

**Your job:** land the Cursor-primary **cleanup** — skills home, strip-not-prescribe `AGENTS.md`, review-gate adapter, ADR-16, paste-ready Automations docs — by **reworking parked draft PR #2030**, not by merging it as-is and not by opening a parallel cutover that duplicates it.

This prompt is self-contained. Re-verify every claim against the checkout and against live `environment-info`.

---

## 0. Preconditions (STOP if unmet)

1. Call **`environment-info`** (and `list-environment-builds` if useful). Prompt 1 succeeded only if the Saved environment is **this** repo’s healthy Cursor Cloud env: Docker + local Supabase + generated `.env.local` + api/web/landing terminals. Recurring SYSTEM builds of the *old* snapshot (`environmentVersionId` `1265931` on env `b91a291a-8c6a-486c-adb7-f5a7a1773ddc`) are **not** Prompt 1 completion.
2. Wait for **`.cloud-sandbox-up.done`**. Stop on **`.cloud-sandbox-up.failed`**. If the failed sentinel contains `(dependencies)`, run `npm ci` in this VM; report only if `npm ci` cannot reach the registry. Log: `/tmp/cloud-sandbox-up.log`.
3. If the environment is still the pre–Prompt 1 contract (JIT `build: null`, terminals that do not wait on the sentinel, no successful Build of the proposed JSON) **and** Paul has not Saved: **do not invent a Save**. Tell Paul to paste Prompt 1 (`/.cursor/ENV_SETUP_PROMPT.md`) and Save. Do **not** run `/env setup` yourself. Do **not** `trigger-environment-build` unless `environment-info` shows Paul already started `/env setup` and the env-setup skill requires follow-through you can actually complete.
4. Do **not** merge PR **#2030** as-is. Do **not** restore Linear / `LINEAR_API_KEY`. Do **not** run live `npm run configure:branch-protection` (the `:verify` variant is fine). Do **not** delete `.claude/**` until the gated last step.

Tracker writes: **GitHub MCP only** (`issue_write`, `issue_read`, `add_issue_comment`, …). Never `gh` or raw REST for issues/PRs. Labels: **read-modify-write the full set** (the API replaces). Owner/repo: this checkout's `origin`.

---

## 1. Hard constraints (do not violate)

- **Strip, don’t prescribe.** `AGENTS.md` stays abstract. The harness owns concrete tool names (`subscribe_*`, MCP function names, `send_later` bans). Do not freeze this session’s catalog into the repo.
- **Review gate = `/diff-review` (abstract).** Same evidence marker: `.cache/diff-review/<HEAD_SHA>`. **Do not make Bugbot canonical.** Cursor built-ins `/review` and `/review-bugbot` may exist; they are not Frapp’s gate.
- **Hooks:** Cursor Cloud **does** load project `.cursor/hooks.json` command-based hooks ([docs](https://cursor.com/docs/hooks) — verified 2026-09-09). `beforeShellExecution` is supported on cloud agents. Default is **fail-open** on crash/timeout/invalid JSON; set `failClosed: true` for this gate. `sessionStart` is still **deferred** on managed cloud agents — do not use it for stack bringup (`environment.json` `start` already does).
- **#2030 hooks are the right shape** (fail-closed adapter, always-valid Cursor JSON, reuse the matcher/marker/livelock — do not fork that logic). **Rework/rebase that PR**; do not duplicate a second gate. If anything over-specifies (babysit tool names in `AGENTS.md`, Claude-fallback novels, `/next` wrappers that name `subscribe_github_pr`), strip those — keep the thin adapter.
- **Skills:** move `.claude/skills/` → `.cursor/skills/` (**move, not copy** — no duplicate trees). Cursor loads `.cursor/skills/` natively ([docs](https://cursor.com/docs/skills)); `.claude/skills/` is compatibility-only and must not remain after the move.
- **Never restore Linear.** Work tracking is GitHub Issues.
- **Do not put secrets** in `environment.json`, Dockerfiles, committed scripts, logs, or chat.
- **Do not enable Hygiene Scan** as a Cursor Automation until this stack has been observed healthy (`.cloud-sandbox-up.done`, API/web terminals). Overlap with Claude Routines during transition is **fine** — do not silently claim Automations are live (#2024 / #2027).
- **Do not rewrite `package-lock.json`**, widen the React `19.2.3` pin, or flatten TypeScript 7.

---

## 2. Reuse parked #2030 (rebase/rework, don’t duplicate)

Parked draft: PR **#2030** (use that PR's head branch; do not paste a GitHub login that collides with the Docker Hub username secret).

It already has useful facts (keep, then strip the rest):

| Keep | Strip or rework |
| --- | --- |
| `.cursor/hooks.json` `beforeShellExecution` + `failClosed: true` | `AGENTS.md` babysit/`subscribe_*`/`send_later` catalog |
| `.cursor/hooks/pre-push-review-gate.sh` adapter + tests in `scripts/ci/__tests__/cursor-review-gate.test.mjs` | `.cursor/commands/next.md` wrapper that hard-codes this harness’s tool names |
| ADR-16 **amendment 8** (Cursor Cloud is primary) + dated in-place correction of amendment 4 | “Cursor loads `.claude/skills`; do not copy” — **obsolete after the move** |
| ROUTINES.md paste-ready Cursor Automation specs, **not live** | Dual “Claude fallback” operating novel once deletion is allowed |
| Linear stays retired (amendment 5) | Bugbot / Marketplace automations as policy |

**How:** rebase #2030's head onto updated `origin/main`, then rework on that branch (or a new branch from `main` using this session's required prefix/suffix that cherry-picks the keepers). Do not merge #2030 first. Do not land a second hooks/ADR PR alongside it.

If #2030 cannot rebase cleanly, take the keepers as patches onto a fresh-from-`main` branch and close #2030 as superseded (comment why; do not delete the branch until the replacement PR exists).

---

## 3. Skills and commands (no duplicate trees)

Move, then sweep references in the **same** change:

1. `git mv .claude/skills .cursor/skills` (or equivalent). Keep each skill folder’s `SKILL.md` identity. Cursor skill identity is the folder containing `SKILL.md`.
2. Move `.claude/commands/next.md` to `.cursor/commands/next.md` as the **procedure**, not a pointer at `.claude/commands/next.md`. Delete the #2030 wrapper-that-names-tools. `/next` stays the claim-work command; babysit language inside it must be **abstract** (“subscribe with this harness’s PR/CI subscription tools”).
3. Sweep: `AGENTS.md`, `docs/`, `spec/`, `ROUTINES.md` paste prompts, skill-internal links, `file-follow-up`, `.github/`. Every `.claude/skills/` path becomes `.cursor/skills/`.
4. `.gitignore` already ignores `.cursor/*` except named files. Un-ignore `.cursor/skills/`, `.cursor/hooks.json`, `.cursor/hooks/`, `.cursor/commands/` the same way #2030 did for hooks/commands — **read-modify-write** the ignore file; do not drop the prompt exceptions (`ENV_SETUP_PROMPT.md`, `CLEANUP_PROMPT.md`).

Do **not** leave `.claude/skills/` behind. Compatibility loading of `.claude/skills/` is not a reason to keep a second tree.

---

## 4. Rewrite `AGENTS.md` (Cursor-primary, strip-not-prescribe)

Target: short enough to load every session (ADR-18). Recurring rules only.

**Must say (abstract):**

- Cursor Cloud is the primary agent environment. Public contract: `.cursor/environment.json`. Wait for `.cloud-sandbox-up.done`; stop on `.cloud-sandbox-up.failed`; `(dependencies)` → `npm ci`. Link `docs/internal/environment/CLOUD_SANDBOX.md` for the symptom table. On bringup failure, stop and report dashboard/egress/secrets — do not paper over it.
- Skills live under `.cursor/skills/`. Read the matching skill before deep work (table of names + paths, not MCP function names).
- Review before push: `/diff-review`. Project hooks fail-closed on the evidence marker. Not Bugbot.
- Tracker: GitHub Issues via the harness GitHub MCP. Never `gh` / raw REST for tracker writes. Labels are replace-the-set.
- Autonomous PR lifecycle: open against `main`; keep the PR ready to merge; subscribe using **this harness’s** PR/CI tools (do not name them); triage CI vs infra; babysit until green; stop when green/review-clean, out of scope, or the user says stop. Point at `AGENT_INFRA.md` for wake-path *facts* (CI wake comments, base-sync), not for a tool catalog.
- Linear stays retired.
- Do not live-apply branch protection.

**Must not say:**

- Concrete `subscribe_github_pr` / `subscribe_github_ci` / `subscribe_pr_activity` / `unsubscribe_pr_activity` / `send_later` / `actions_run_trigger` as *the* Frapp policy.
- “Claude Code web sandbox” as a live primary or required fallback **after** the deletion gate.
- A second copy of ports, allowlist hosts, or Infisical grids (those stay in `LOCAL_DEV.md` / `CLOUD_SANDBOX.md` / `ENV_REFERENCE.md`).

Until the deletion gate fires, a **one-liner** is enough: Claude files remain in-tree until teardown; Cursor `start` owns bringup. No dual operating manual.

Canonical homes: `DOCUMENTATION_CONVENTIONS.md`. Convert restatements in `CLOUD_SANDBOX.md`, `GITHUB_PM.md`, `AGENT_INFRA.md`, `AI_CODE_REVIEW_RUNBOOK.md`, `CONTRIBUTING.md` to links after you change the fact.

---

## 5. Review gate (fail-closed hooks, `/diff-review` abstract)

Verified against Cursor hooks docs (2026-09-09): cloud agents pick up `.cursor/hooks.json` from the repo; `beforeShellExecution` input is `{command, cwd, sandbox}`; output `{permission, user_message, agent_message}`; `failClosed` default `false`.

Therefore:

1. Keep `.cursor/hooks.json` with `failClosed: true` on `beforeShellExecution`.
2. Relocate the **decision** script into `.cursor/hooks/` (today the #2030 adapter calls `.claude/hooks/pre-push-review-gate.sh`). After the skills move, `.claude/hooks/` must not be load-bearing. Thin Cursor JSON adapter + shared matcher is fine; two copies of the matcher is not.
3. Always emit valid Cursor JSON. Empty-allow stdout under fail-closed would deny every command.
4. Keep/extend `scripts/ci/__tests__/cursor-review-gate.test.mjs` and existing `review-gate.test.mjs`.
5. Runbook `AI_CODE_REVIEW_RUNBOOK.md`: primary path is `/diff-review` + Cursor hooks. Claude PreToolUse is leftover until deletion. **Bugbot is not the gate.**
6. Do not add Marketplace “Fix bugs” / Security Agents as a substitute.

---

## 6. ADR-16

Keep **amendment 8** (2026-09-09): Cursor Cloud is primary; amendment 5 (Linear retired) stays; amendment 4’s “Cursor retired” remains a **dated in-place correction**, not a restore of the old sentence.

Update amendment 8’s *facts* that Prompt 2 changes:

- Skills home is `.cursor/skills/` (delete the “do not copy into `.cursor/skills`” line).
- `/next` lives at `.cursor/commands/next.md` (procedure, not a Claude pointer).
- Review gate lives entirely under `.cursor/hooks*` after the move.
- Babysit: harness-owned; do not list tool names in the ADR either (the ADR records the *decision*, not the catalog).
- Claude files stay only until the deletion gate / #2028.

Date the correction. Sweep citations of ADR-16 headings before renaming anything (`DOCUMENTATION_CONVENTIONS.md` § When a doc turns out to be wrong).

---

## 7. Automations vs Claude Routines (docs + paste-ready; do not silently claim live)

Canonical file: `docs/internal/ci-cd/ROUTINES.md`. Human paste: **#2024**. Observe a run before claiming live: **#2027**. Hygiene Scan **last**. Overlap with Claude Routines is OK until #2027.

Cursor Cloud MCP `get-automation` is **read-only**. You cannot create Automations. Put paste-ready specs in `ROUTINES.md` (update skill paths to `.cursor/skills/…`). Cron Automations **default to no repository** — every automation must attach **this** GitHub repository (`environment-info` `repos[]`).

**Keep (paste later; do not enable Hygiene Scan yet):**

| Name | Cadence (ET) | UTC cron (EDT) | Notes |
| --- | --- | --- | --- |
| Issue Curator | daily 08:00 | `0 12 * * *` | GitHub MCP; no product code. |
| Issue Triage | daily 09:00 | `0 13 * * *` | After Curator. |
| PR Follow-ups | weekly Mon 07:00 | `0 11 * * 1` | GitHub MCP. Marketplace “triage failed Actions” is adjacent, not a replacement. |
| Docs Upkeep | weekly Wed 07:00 | `0 11 * * 3` | Needs git push / PR. |
| Hygiene Scan | daily 06:00 | `0 10 * * *` | **Keep, enable last.** Needs this healthy full stack. |

Shift +1h when ET is EST (already in `ROUTINES.md`).

**Drop / do not canonicalise:**

- Cursor Marketplace: Assign PR reviewers / PR Routing & Approval, Find vulnerabilities / Security Agents, Summarize changes daily, Fix bugs reported in Slack.
- **Bugbot** — experiment only; not the review gate.
- Linear Automations / `LINEAR_API_KEY` — retired. Old issue #740 is leftover, not a template.
- Claude Routines — keep running until a Cursor Automation run is **observed**, then Paul disables them (#2027).

Docs: https://cursor.com/docs/cloud-agent/automations

---

## 8. Last step (gated): delete `.claude/**`

**Do not do this unless Paul said, in this chat, that the Prompt 1 `/env setup` chat is finished** (the conversation that ran Prompt 1 — not this cleanup chat). If he has not said that, **stop after skills are moved and Claude leftovers that are not the skill tree** (settings, SessionStart hook, empty `.claude/` dirs) remain, and file/leave **#2028** for teardown after Automations are observed (#2027).

When the gate **is** open:

1. Confirm no remaining references to `.claude/skills` or `.claude/commands`.
2. Confirm the review-gate implementation no longer execs `.claude/hooks/pre-push-review-gate.sh`.
3. Delete `.claude/**` (settings, SessionStart, leftover hooks). Cutover deletes what it replaces (`signet-cutover` skill).
4. Keep `scripts/cloud-sandbox-up.sh` until Cursor `start` does not call it. Prompt 1 was supposed to extract a Cursor-owned entrypoint that may still `exec` that script — do not delete shared bringup.
5. Sweep docs that still say “Claude fallback” as a live path.
6. Do not restore Linear.

If Paul did **not** open the gate, say so in the PR: skills moved; `.claude/**` deletion deferred to #2028 / owner confirmation.

---

## 9. Tracker, PR, issues

Implementation PR (the reworked #2030 or its replacement):

```
Part of #2017

Fixes #2021
Fixes #2022
Fixes #2023
Fixes #2019
```

GitHub closing keywords close on merge; put them in the **PR body**, one line per issue. Do **not** write `Does not close #2024` (GitHub still matches `close`). Safe leftover wording: human dashboard issues **#2024–#2027** stay human; teardown **#2028** waits until Automations are observed (#2027) and, if this chat did not open the deletion gate, until Paul confirms the Prompt 1 chat is finished.

- **#2023 rework:** acceptance is “`/next` works on Cursor with procedure under `.cursor/commands/`”, **not** “docs name `subscribe_github_pr`”. Update the issue body if it still demands tool-name porting.
- **#2022 rework:** Cursor-primary + ADR-16, **strip-not-prescribe**.
- **#2019:** ROUTINES.md paste-ready; skill paths `.cursor/skills/`; prose must not claim Automations are running.

Do not `Fixes` **#2017** while children remain — `Part of #2017` only.

Do not start product-code work, Expo, Infisical-for-Boots, or environment Dockerfile churn in this PR.

---

## 10. Validate

1. `.cloud-sandbox-up.done` present (or you reported the failed sentinel honestly).
2. `git grep -n '\\.claude/skills' -- AGENTS.md docs spec .cursor .github` is empty after the move (except historical ADR sentences you dated).
3. `node --test scripts/ci/__tests__/cursor-review-gate.test.mjs scripts/ci/__tests__/review-gate.test.mjs` (or the repo’s equivalent).
4. Unreviewed `git push` Cursor payload → `permission: deny`; marker present → allow.
5. No secrets in the diff. No live branch-protection apply.
6. `/diff-review` on this PR’s diff.
7. Push; GitHub MCP for PR body updates (no ManagePullRequest in some harnesses — then `update_pull_request` for body only).

---

## 11. Out of scope (still Paul / later)

| Item | Issue |
| --- | --- |
| Paste/enable Cursor Automations in the dashboard | #2024 (human) |
| Apply production-withholding egress allowlist | #2025 (human) |
| Re-auth Granola / Supermemory MCP | #2026 (human) |
| Disable Claude Routines after an observed Cursor Automation run | #2027 (human) |
| Remaining `.claude/**` teardown if this chat did not open the deletion gate | #2028 |
| Docker Hub **environment/team** secrets for Builds | request if missing; do not commit |

Debt spotted: end the PR with one line per leftover plus the issue number (or “none found”).
