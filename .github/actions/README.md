# Composite actions

Shared step sequences for this repo's workflows, called as:

```yaml
- name: Build shared packages
  uses: ./.github/actions/turbo-packages-build
```

A local `uses: ./…` path needs an `actions/checkout` earlier in the same job, or the
action file is not on disk yet when the runner resolves it.

| Action | What it does |
| --- | --- |
| [`turbo-packages-build`](./turbo-packages-build/action.yml) | ADR-15 lever (A): restores the `.turbo` cache and builds `packages/*`. One producer (`packages-build`, `save: "true"`) and seven consumers. |
| [`infisical-secrets`](./infisical-secrets/action.yml) | The credential preflight plus the `Infisical/secrets-action` injection for one environment. 11 call sites across 6 workflows. |
| [`supabase-cli`](./supabase-cli/action.yml) | Installs the Supabase CLI at the one pinned version. 4 call sites. Takes **no inputs** — see below. |

## Rules that are enforced, not just documented

- **A workflow must not hand-write anything an action here owns.** For
  `turbo-packages-build` that means the `turbo-pkgbuild-` cache key and the
  `packages/*` build command; `scripts/ci/__tests__/turbo-packages-build-action.test.mjs`
  fails if either reappears in a workflow *or* in another composite action.
- **`clean-checkout-typecheck` and `web-production-build` must never use
  `turbo-packages-build`.** Each exists to fail when the shared packages cannot build
  from a cold tree — `clean-checkout-typecheck` on a dev install, `web-production-build`
  under the pruned `npm ci --omit=dev` shape — and prebuilt `dist/` on disk hides
  exactly that. Same test enforces it.
- **Gate the filter, not just the workflow.** A job path-gated by `dorny/paths-filter`
  that builds through an action here needs `.github/actions/**` in *that* filter list.
  Without it a PR editing only the action skips the job, and a job skipped by a
  job-level `if:` reports **Success** — so a required check passes without running.

- **`infisical-secrets`'s input must stay named `env-slug`, and call sites must pass a
  quoted literal.** `scripts/check-env-slugs.mjs` finds Infisical environment names by
  matching `env-slug: "<slug>"` across `.github/workflows` and `.github/actions`. Inside
  the action the value is `${{ inputs.env-slug }}`, which that scan cannot match — the
  real literals survive only as the `with:` values at the call sites. Renaming the input,
  or passing an expression, moves slugs out of the gate's reach while it keeps exiting 0.
  That is the vacuous green its own section 0 exists to refuse.

- **`supabase-cli` takes no inputs on purpose.** A `version:` input would put the pin back
  at four call sites. The production apply and the `migration-replay` rehearsal exist to be
  *the same CLI code path*; a rehearsal on a different build than the apply proves nothing,
  and the drift is silent — both runs go green. Change the pin in the action, for everybody.

- **A local action needs a checkout in the same job — and must not run after the workspace
  moves.** `uses: ./…` resolves against the runner workspace *at step-execution time*, so a
  checkout earlier in the job is necessary but **not sufficient**. Both halves are enforced by
  `scripts/ci/__tests__/infisical-secrets-action.test.mjs`.

  The first half: `deploy-api.yml`'s `deploy-staging` job had no checkout at all — it only
  fires a deploy hook — and had to gain one. It runs on `workflow_run` after merge, so no PR
  would ever have caught the failure.

  The second half is the one that bites hardest. `deploy-production.yml` runs
  `git checkout --detach "$DEPLOY_SHA"`, so **any local action called after that point is
  loaded from the deployed commit's tree**: deploying a commit older than the action dies with
  `Can't find 'action.yml'` — that is the rollback path, failing exactly when it is reached
  for — and deploying a newer one silently uses *that commit's* copy of whatever the action
  pins. Call local actions before the tree moves; that also puts them on the trusted ref, which
  is what the job's own header argues for. A later `actions/checkout`, `git switch`,
  `git reset --hard` and `git worktree` all count as moving the tree, and the guard rejects a
  local-action call after any of them.

## Why this directory has a README

`scripts/check-env-slugs.mjs` scans `.github/actions` for Infisical `env-slug:` values
and treats a missing scan root as an error, so that a renamed directory cannot make the
gate pass vacuously. Git does not track empty directories, so without a committed file
here, removing the last composite action would fail that gate with a message about
Infisical slugs — which would be a long way from the actual cause.

Background: ADR-15's 2026-09-02 amendment in [`spec/architecture/README.md`](../../spec/architecture/README.md),
and the **Composite actions** row in [`AGENT_INFRA.md`](../../docs/internal/ci-cd/AGENT_INFRA.md).
