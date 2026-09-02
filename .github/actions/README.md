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

## Why this directory has a README

`scripts/check-env-slugs.mjs` scans `.github/actions` for Infisical `env-slug:` values
and treats a missing scan root as an error, so that a renamed directory cannot make the
gate pass vacuously. Git does not track empty directories, so without a committed file
here, removing the last composite action would fail that gate with a message about
Infisical slugs — which would be a long way from the actual cause.

Background: ADR-15's 2026-09-02 amendment in [`spec/architecture/README.md`](../../spec/architecture/README.md),
and the **Composite actions** row in [`AGENT_INFRA.md`](../../docs/internal/ci-cd/AGENT_INFRA.md).
