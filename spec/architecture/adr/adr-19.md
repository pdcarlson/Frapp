### ADR-19: Retire the `production` branch — deploy a named commit from `main` (2026-08-28)

**Decision:** Delete the `production` branch. Production is deployed by dispatching
`.github/workflows/deploy-production.yml` with an explicit commit SHA, gated by the
`production` GitHub Environment's Required reviewers.

**Context.** The two-branch model made a *branch tip* the deployable artifact, and nothing
in the flow ever named a commit. Three consequences, all measured rather than argued:

- `frapp-api-prod` was configured `autoDeploy: yes` / `autoDeployTrigger: commit`, so a
  push to `production` deployed **without waiting for CI**. `deploy-api.yml`'s green-CI
  gate governed only its own deploy hook.
- The human gates were both in the wrong place: the promotion PR's required review, and
  then the environment approval after merge on a click nobody was paged for. The second
  held a one-migration apply for 29m52s on 2026-08-28 (ADR-13 amendment, and
  `docs/internal/ci-cd/AGENT_INFRA.md` § GitHub environments and bootstrap secrets).
  Neither happened at a moment when anyone knew whether the migration would apply.
- A second long-lived branch cost `branch-policy`, a `[main, production]` filter on five
  workflows, an asymmetric branch-protection payload, and a `pr-base-guard` case — all to
  police a branch that carried **no unique file content**: `origin/production` (`95b489a`)
  had a tree byte-identical to `690aed9` on `main`.

**What replaced each piece.**

| Was | Is |
| --- | --- |
| `branch-policy` required check (PR into `production` must come from `main`) | `git merge-base --is-ancestor` in `scripts/ci/validate-deploy-sha.mjs` |
| Branch protection's required status checks on the promotion PR | The same `ALL_REQUIRED_CHECKS` list, asserted against the checks API for the exact SHA |
| Promotion PR's 1 required approving review | The `production` environment's Required reviewers, which pause the deploy itself |
| Render auto-deploy from `production` | `POST /v1/services/{id}/deploys` with `commitId` |
| Vercel Production Branch = `production` | `POST /v13/deployments` with `target: production` and a `gitSource` sha |
| `release.yml` on `push: [production]`, reading the merge-commit message | `workflow_call` from the deploy, reading `release:*` labels on every PR since the last tag |

**Consequences.**

- The deploy workflow's **shipping** path is a **single `environment: production` job**
  on purpose: every environment-scoped job costs its own Approve click, so splitting
  migrate / Render / Vercel / verify would silently turn one approval into four. SHA
  confirmation, trim, and validation run first in an unscoped `validate` job so a bad
  paste cannot consume that approval (run 34234768094). Do not put `environment: production`
  on `validate`. **Amended 2026-09-08.**
- A `v*` tag now means "this is live" — it is created after Render and Vercel report
  healthy, on the deployed SHA — where it used to mean "this merged and we hoped".
- Release labels moved from one promotion PR onto **every** PR. An unlabelled
  `release:major` change now ships as a patch.
- Two settings are load-bearing, dashboard-only, and **fail open**: Render auto-deploy
  must stay off, and neither Vercel project's Production Branch may be `main`. They cannot
  be enforced from this repository, only asserted — `scripts/ci/production-guardrails.mjs`
  does so on a schedule and again as a preflight before every deploy. Leaving Vercel
  pointed at the now-deleted `production` branch is the *safe* state.
- `migrate-production.yml` survives as the code-free escape hatch, and is now explicitly
  the weaker path: it does not rehearse the migration, where the deploy workflow does.
  - **Correction (2026-08-29), recorded rather than rewritten — this consequence was
    reversed.** `migrate-production.yml` has been **deleted**. Keeping a code-free path
    that skipped the rehearsal turned out to mean keeping the most dangerous workflow in
    the repository as a backup for the safest one: it took an arbitrary `ref` and skipped
    SHA validation, the provider guardrail preflight, the replay and the working-tree
    fence. Its stated reason for skipping the rehearsal — that reconstructing production's
    state is least dependable once something has gone wrong — does not hold: the state
    that cannot be reconstructed is a *foreign* migration, and a foreign migration blocks
    `supabase db push` outright anyway, so the rehearsal was not what would have failed,
    it was what would have said so first. The capability survives as
    `deploy-production.yml`'s `scope: migrations-only` input, which keeps every gate. What
    is genuinely given up is applying migrations from a ref that is not an ancestor of
    `main`, or from a commit whose CI was not green. Both were worth losing. The decision
    below stands as taken; only this consequence was reversed.
- ADR-13's consequence bullet ("the `production` environment's manual-approval pause is
  gone") and its 2026-08-28 correction both stand as written. This ADR does not revise
  them; it records that the pause was **kept deliberately** and is now the only human gate.

- **Amendment (2026-09-02) — the Vercel half of this ADR is superseded by ADR-21.** The owner
  disconnected both Vercel projects from Git — `frapp-landing` on 2026-09-01, `frapp-web` on
  2026-09-02 — so the "Vercel Production Branch = `production`" row above and the consequence that
  "neither Vercel project's Production Branch may be `main`" no longer describe anything the API
  exposes: with no Git link there is no Production Branch setting and no auto-deploy-from-push path
  at all, and Vercel's `list_projects` reports `link: null` for both projects. Of the two
  load-bearing, dashboard-only, fail-open settings, **one remains asserted** — Render auto-deploy
  must stay off. The Vercel one is not gone from the world, only from the API: the unlink is itself
  unversioned dashboard state that a re-link would undo, which is why the fix tracked in **#1579**
  is to **invert** `assertVercelProductionBranch` — a *present* Git link becomes the violation —
  rather than to delete it. Both statements stand as the record of what was true on 2026-08-28;
  ADR-21 is the canonical record of what replaces them and of the breakages the unlink left live.

**Trigger to revisit:** collaborators are added (a merge-time review may then be worth its
cost again), or a provider gains a writable API for the settings the guardrails can only
assert.
