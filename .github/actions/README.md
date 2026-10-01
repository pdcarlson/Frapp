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
| [`node-setup`](./node-setup/action.yml) | `actions/setup-node` at the one pinned `node-version`, then the install the required `install:` input names: `ci` (`npm ci`), `omit-dev` (`npm ci --omit=dev`) or `none`. The two installing modes restore the `~/.npm` download cache, never `node_modules`. Every job that sets up Node calls it, except the three exceptions in the rules below (#1541). |
| [`turbo-packages-build`](./turbo-packages-build/action.yml) | ADR-15 lever (A): restores the `.turbo` cache and builds `packages/*`. One producer (`packages-build`, `save: "true"`); the consumers are `CONSUMERS` in its test. |
| [`infisical-secrets`](./infisical-secrets/action.yml) | The credential preflight plus the `Infisical/secrets-action` injection for one environment. Optional `preserve-nonempty` restores named env vars this injection left empty (production backup `prod` inject only). Call-site roster: `EXPECTED` in `scripts/ci/__tests__/infisical-secrets-action.test.mjs`. |
| [`db-offsite-backup`](./db-offsite-backup/action.yml) | Dump one Supabase project with the Supabase CLI, upload to the offsite bucket under `<environment>/<label>/`, read it back, prune past retention. Asserts the injected `SUPABASE_PROJECT_REF` against `.github/environments.json` before linking. 2 call sites (staging, production) in `db-backup.yml`. |
| [`storage-offsite-backup`](./storage-offsite-backup/action.yml) | Mirror one project's Storage objects to a per-environment prefix, or run the restore rehearsal. Asserts the injected `SUPABASE_URL` against `.github/environments.json`. 2 call sites in `db-backup.yml`. |
| [`supabase-cli`](./supabase-cli/action.yml) | Installs the Supabase CLI at the one pinned version. Its call sites are counted in `scripts/ci/__tests__/infisical-secrets-action.test.mjs`. Takes **no inputs** — see below. |
| [`download-migration-snapshot`](./download-migration-snapshot/action.yml) | Fetches the newest migration snapshot `migration-snapshot.yml` published from `main`, with `GITHUB_TOKEN` (the job needs `actions: read`), and exports its path, plus a staging-deploy state that `migration-drift` reads; the action's header defines both. How the credential-free PR gates learn what each database has applied (#2518). 3 call sites in `migration-drift-gate.yml`. |

## Rules that are enforced, not just documented

- **A workflow must not hand-write anything an action here owns.** For
  `turbo-packages-build` that means the `turbo-pkgbuild-` cache key and the
  `packages/*` build command; `scripts/ci/__tests__/turbo-packages-build-action.test.mjs`
  fails if either reappears in a workflow *or* in another composite action.
- **No workflow or other action hand-writes `actions/setup-node` or the install, except
  `_deploy.yml`, `release.yml` and `_mobile-build.yml`.** Those three check out another commit
  before Node is set up (the commit being deployed, tagged, or built for the stores), so a
  local action there would load from that tree (see the workspace rule below), and they keep
  a hand-written step pinned to `node-setup`'s: the same `actions/setup-node` ref, Node
  version and `package-manager-cache: false`. `scripts/ci/__tests__/node-setup-action.test.mjs`
  fails on any other copy, on an exception whose ref, version or cache opt-out differs or that
  no longer checks out another commit first, on an `install:` value the action doesn't
  accept, on any step added to the action or line added to its mode check, and on an
  installing mode in a job that holds a secret, directly or through a composite action it
  calls (those jobs run dependency-free scripts, so no `node-setup` call runs `npm ci`'s
  lifecycle scripts beside a credential).
  `_deploy.yml` and `_mobile-build.yml` are outside that rule: each hand-written `npm ci`
  runs in a job that holds its environment's secrets, before any step that uses them
  (`_deploy.yml`'s Infisical injection, `_mobile-build.yml`'s `EXPO_TOKEN` steps), and #2824
  tracks isolating `_deploy.yml`'s.
- **`clean-checkout-typecheck` and `web-production-build` must never use
  `turbo-packages-build`.** Each exists to fail when the shared packages cannot build
  from a cold tree — `clean-checkout-typecheck` on a dev install, `web-production-build`
  under the pruned `npm ci --omit=dev` shape — and prebuilt `dist/` on disk hides
  exactly that. Same test enforces it.
- **Gate the filter, not just the workflow.** A job path-gated by `dorny/paths-filter`
  that calls an action here needs `.github/actions/**` in *that* filter list.
  Without it a PR editing only the action skips the job, and a job skipped by a
  job-level `if:` reports **Success** — so a required check passes without running.
  `scripts/ci/__tests__/infisical-secrets-action.test.mjs` checks it for every local
  action call in `ci.yml`.

- **`infisical-secrets`'s input must stay named `env-slug`, and call sites must pass a
  quoted literal.** `scripts/check-env-slugs.mjs` finds Infisical environment names by
  matching `env-slug: "<slug>"` across `.github/workflows` and `.github/actions`. Inside
  the action the value is `${{ inputs.env-slug }}`, which that scan cannot match — the
  real literals survive only as the `with:` values at the call sites. Renaming the input,
  or passing an expression, moves slugs out of the gate's reach while it keeps exiting 0.
  That is the vacuous green its own section 0 exists to refuse.

- **A third-party action in a job that holds a secret is pinned by commit SHA** (#2647),
  including inside every local action such a job calls, however deep, and a Docker
  action's registry image by digest. A tag or branch is the publisher's to move, and the
  moved code would run with the job's credentials unreviewed. Write
  `uses: owner/action@<40-hex sha> # v1.2.3`, resolving the SHA with `git ls-remote` (for
  an annotated tag, the `^{}` line). Enforced by rule D in
  `scripts/ci/__tests__/workflow-secrets-scope.test.mjs`. Jobs holding only the
  per-run `GITHUB_TOKEN` are outside it.

- **Every action runs on a release that runs on Node 24** (#3108), in every workflow and
  every action here. GitHub forces a `runs.using: node20` action onto Node 24 with a
  deprecation warning on each run, and is removing Node 20 from its runners.
  `scripts/ci/__tests__/action-runtime-floor.test.mjs` records each action's oldest
  release verified on node24 and fails on a ref below it, on an action with no recorded
  floor, on a floor no ref uses any more, and on a ref that pins neither a version tag nor
  a commit with its `# vX.Y.Z` comment (a branch, or a bare SHA). Adding an action means
  reading `runs.using` in its `action.yml` at the tag you pin, not its release notes, and
  recording the floor there; a forward bump needs no edit.

- **`supabase-cli` takes no inputs on purpose.** A `version:` input would put the pin back
  at every call site. The production apply and the `migration-replay` rehearsal exist to be
  *the same CLI code path*; a rehearsal on a different build than the apply proves nothing,
  and the drift is silent — both runs go green. Change the pin in the action, for everybody.
  Enforced by `scripts/ci/__tests__/infisical-secrets-action.test.mjs` — one file guards both
  of the actions this stage extracted, so a `version:` input fails a test named after the
  other one. It also pins the version's two deliberate shell copies to this same pin:
  `scripts/db-backup.sh`'s no-CLI-on-PATH fallback, and `scripts/lib/supabase-cli.sh`'s
  `FRAPP_SUPABASE_CLI_PIN`, which the sandbox and laptop bootstraps resolve.

- **A local action needs a checkout in the same job — and must not run after the workspace
  moves.** `uses: ./…` resolves against the runner workspace *at step-execution time*, so a
  checkout earlier in the job is necessary but **not sufficient**. Both halves are enforced by
  `scripts/ci/__tests__/infisical-secrets-action.test.mjs`, for every local action's call site
  in a workflow, and in a composite action, which must not move its caller's workspace before
  calling another (since #1541; it used to check only `infisical-secrets` and `supabase-cli`
  calls in workflows). The state machine is `workspaceTrust` in
  `scripts/ci/__tests__/helpers/workflow-yaml.mjs`.

  The first half: `deploy-api.yml`'s `deploy-staging` job (the staging deploy, now
  `deploy-staging.yml`'s `deploy` job) had no checkout at all — it only fired a deploy hook
  then — and had to gain one. It runs on `workflow_run` after merge, so no PR
  would ever have caught the failure.

  The second half is the one that bites hardest. The deploy job both environments share
  (`_deploy.yml`) runs `git checkout --detach "$DEPLOY_SHA"`, so **any local action called after
  that point is loaded from the deployed commit's tree**: deploying a commit older than the action
  dies with `Can't find 'action.yml'` — that is the rollback path, failing exactly when it is
  reached for — and deploying a newer one silently uses *that commit's* copy of whatever the action
  pins. Call local actions from the trusted ref, which is what the job's own header argues for. A
  later `actions/checkout`, a first one with a `ref:`, `git switch`, `git reset --hard` and
  `git worktree` all count as moving the tree, and the guard rejects a local-action call after any
  of them. The one move back it accepts is `_deploy.yml`'s: `git checkout --force --detach
  "$TRUSTED_SHA"` with `TRUSTED_SHA: ${{ github.sha }}`, which that job uses to install on the
  deployed commit before any secret and then run its local actions trusted (#2805).

## Why this directory has a README

`scripts/check-env-slugs.mjs` scans `.github/actions` for Infisical `env-slug:` values
and treats a missing scan root as an error, so that a renamed directory cannot make the
gate pass vacuously. Git does not track empty directories, so without a committed file
here, removing the last composite action would fail that gate with a message about
Infisical slugs — which would be a long way from the actual cause.

Background: ADR-15's 2026-09-02 amendment in [`spec/architecture/adr/adr-15.md`](../../spec/architecture/adr/adr-15.md),
and the **Composite actions** row in [`agent-infra.md`](../../docs/ci-cd/agent-infra.md).
