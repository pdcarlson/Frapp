# Agent infrastructure and CI reference

Operational detail for AI agents and maintainers working on deploys, CI, secrets, and provider APIs. Day-to-day local setup lives in [`LOCAL_DEV.md`](../environment/LOCAL_DEV.md).

## Research-first workflow

When relevant credentials exist in the environment, prefer gathering **runtime truth** (CI, deploy health, schema, secret presence) via provider APIs/CLIs before changing code or docs.

1. Gather state from providers (GitHub, Supabase, Vercel, Render, Infisical as applicable).
2. Use those checks when validating infra or release-impacting work.
3. Align proposals to observed reality; avoid stale assumptions.
4. **Never print secret values** — only names and presence/absence.

**CLI recipes** (GitHub `gh`, Supabase, curl examples for Render/Vercel/Infisical): see [`.claude/skills/infrastructure-research/SKILL.md`](../../../.claude/skills/infrastructure-research/SKILL.md).

## Optional environment credentials

Provider/research credentials and cloud-sandbox runtime vars that may appear in cloud agent / automation sessions are listed canonically in [`../environment/AGENT_CREDENTIALS.md`](../environment/AGENT_CREDENTIALS.md) (including the canonical-name/alias discussion). Local development omits most of them; use Infisical login for app secrets instead. The GitHub PAT usage policy below stays here.

## GitHub PAT usage policy

The agent **may** use `GITHUB_PAT` for: creating/closing agent-owned PRs, labels, issues, branch protection script, GitHub environments/protection rules, reading PR/CI/branch state.

The agent **must not** use it to: merge without explicit approval, delete branches without approval, broaden repo settings beyond branch protection/environments, create/modify GitHub Secrets, force-push, or create releases/tags outside the automated release workflow.

Node scripts (e.g. `configure-branch-protection.mjs`) read `GITHUB_PAT` directly. For `gh`/git, export it as `GH_TOKEN` first — `gh` only auto-reads `GH_TOKEN`/`GITHUB_TOKEN`, not `GITHUB_PAT`. The value must be a PAT with the required repository permissions; do not assume the GitHub Actions runtime token has branch-administration scope.

```bash
export GITHUB_PAT=<token>
export GH_TOKEN="$GITHUB_PAT"   # required for gh / git
```

If only a legacy GitHub token alias is exposed in an older VM, copy it into `GITHUB_PAT` for the session; otherwise prefer the canonical name.

### Work status

There is **no GitHub Projects board** in this workflow. Work status lives in **GitHub Issues** on
`pdcarlson/Frapp` — the single source of truth (Linear was retired 2026-08-08; record in
[#680](https://github.com/pdcarlson/Frapp/issues/680)). Board states are label conventions
(`triage` / priority `P1`–`P4` / `in-progress` / `in-review`); PRs close linked issues natively
with `Fixes #N` on merge. In cloud sandboxes the GitHub MCP is the only *sanctioned* tracker path — the PAT/`gh` recipes
above are for Actions and laptops; sandbox shell access to `api.github.com` is session-dependent
(observed both proxy-blocked and working, 2026-08-08), so tracker workflows must not depend on
it. Design + policy: [`GITHUB_PM.md`](GITHUB_PM.md).


## CI/CD summary

| Item                | Location / notes                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI                  | `.github/workflows/ci.yml` — parallel jobs (`lint-and-typecheck` includes `nest build` for `apps/api` + landing, `@repo/validation`, `@repo/color`, `@repo/formatting`, `@repo/chapter-theme`, and `@repo/api-sdk` unit tests; `api-tests` runs `apps/api` Jest unit + E2E suites (`test` then `test:e2e`); `web-tests` runs `apps/web` Vitest plus the `packages/hooks`, `packages/chat-core`, and `packages/chat-integrations` suites; `api-docker-build` runs `apps/api/Dockerfile`) |
| API deploy          | `.github/workflows/deploy-api.yml` — after CI (`workflow_run`)                                                                                        |
| Deploy outcome      | `.github/workflows/deploy-api.yml` → terminal `deploy-outcome` job — the only job in that workflow with a write scope (job-scoped `issues: write`; the workflow-level grant stays `contents: read`). Writes a step summary + annotation saying whether the run **deployed** or **declined to deploy**, and upserts one `routine-state` alert issue on failure, closing it on the next successful deploy. Logic in `scripts/ci/deploy-alert.mjs` (tests: `scripts/ci/__tests__/deploy-alert.test.mjs`). **Not** a required check. See "Deploy visibility" below. |
| Deploy verification | `.github/workflows/verify-deployments.yml` — post-push Render + Vercel state polling                                                                  |
| Migration drift     | `.github/workflows/check-migration-drift.yml` — **scheduled** (daily 07:00 UTC) + `workflow_dispatch`. Compares each deployed database's `schema_migrations` against `supabase/migrations/` and upserts one `routine-state` alert issue, closing it when every environment is back in sync. Job-scoped `issues: write`; workflow-level grant stays `contents: read`. Logic in `scripts/ci/check-migration-drift.mjs` (tests: `scripts/ci/__tests__/check-migration-drift.test.mjs`). **Not** a required check. See "Schema drift detection" below. |
| Staging conformance | `.github/workflows/staging-conformance.yml` — **scheduled** (daily 07:00 UTC) + `workflow_dispatch`. Asserts live `frapp-staging` state rather than a push: project `ACTIVE_HEALTHY`, `custom_access_token_hook` enabled *and* pointed at the right function, every Infisical secret sync succeeded, and an end-to-end sign-in whose JWT carries `active_chapter_id`. **Migration parity is deliberately NOT checked here** — `check-migration-drift.yml` above owns it end to end; see "Scheduled conformance" below. Upserts its own `routine-state` alert issue on drift and closes it on recovery. Logic in `scripts/ci/staging-conformance.mjs` (tests: `scripts/ci/__tests__/staging-conformance.test.mjs`). **Not** a required check — it verifies an environment, not a diff. |
| Release tags        | `.github/workflows/release.yml` — main → production merge                                                                                             |
| Docs                | `.github/workflows/docs.yml` — PR docs/spec sync (`check-docs-impact.mjs`)                                                                            |
| CI wake             | `.github/workflows/ci-wake.yml` — `workflow_run` on CI / Docs spec sync / Links completion (PR runs only): classifies infra-vs-code failure, auto-requeues infra failures (≤3 total attempts), and upserts one PR wake comment **only for an outcome the PR-activity webhook does not already carry** — a cancelled or timed-out run, or an infra failure the re-queue could not absorb. Success and real failures clear the stale wake and say nothing. Logic in `scripts/ci/ci-wake.mjs` (tests: `scripts/ci/__tests__/ci-wake.test.mjs`). **Not** a required check. See "PR babysitting" below. |
| PR base sync        | `.github/workflows/pr-base-sync.yml` — `push` to `main`: sweeps open PRs targeting it (cap 20, logged); behind + clean PRs are auto-updated via the update-branch API **only when the base-sync GitHub App token mints** (default-token pushes trigger no CI). Conflicts and per-PR update failures upsert one `<!-- frapp-base-sync -->` wake comment telling the watching agent to merge `main` itself; a missing or rejected token is repo-wide, so it raises **one** `routine-state` alert issue instead of the same comment on every PR. Logic in `scripts/ci/pr-base-sync.mjs` (tests: `scripts/ci/__tests__/pr-base-sync.test.mjs`). **Not** a required check. See "Base-branch sync" below. |
| PR base guard       | `.github/workflows/pr-base-guard.yml` — the **only** workflow with no `on.pull_request.branches` filter, so it runs on every PR whatever the base. Fails when the base is not `main` or `production`, which is the one check a stacked PR would otherwise never get. No checkout, no npm, no third-party action; reads `pull_request.base.ref` off the event payload. Fires on `edited` too, so retargeting a base cannot leave a stale green. **Not** yet a required check — see "CI branch filters" below. |
| PR CI branch filter | `ci.yml` / `docs.yml` / `links.yml` set `on.pull_request.branches: [main, production]`. GitHub matches that list against the PR **base**. A PR whose base is a feature branch skips every required check. See "CI branch filters" under PR babysitting. |
| Branch protection   | `npm run configure:branch-protection` (prefers `GITHUB_PAT`); see `CONTRIBUTING.md`                                                                   |
| AI code review      | **Local pre-push gate**, not CI — `.claude/hooks/pre-push-review-gate.sh` blocks pushing a HEAD until that HEAD has been reviewed (keyed on a `.cache/diff-review/<SHA>` marker, not on attempt count) — `/diff-review` (always agent-invocable; writes the marker) or `/code-review` (richer, but model-invocable only when the turn's prompt carries `/code-review` whitespace-delimited on both sides, which backticks and trailing punctuation defeat; does not write the marker) (ADR-14 2026-06-04 amendment; the `claude-review.yml` CI workflow was removed). See `AI_CODE_REVIEW_RUNBOOK.md` |
| Dependency updates  | `.github/dependabot.yml` — one root `npm` entry (the workspaces share the root lockfile), **weekly** on Monday 09:00 UTC. Minor+patch collapse into a single grouped PR; majors stay individual. The React/React Native/Expo families are ignored — they move only via a planned SDK upgrade. **Not** a required check (it opens PRs, it doesn't gate them). See "Dependency updates (Dependabot)" below. |
| Vercel              | Deploys from `main` / `production` only (PR previews disabled via repo config)                                                                        |

**PR review policy:** `main` — no required human approval; `production` — required approval + resolved conversations.

**Branch protection script (dry run / apply):**

```bash
npm run configure:branch-protection -- --dry-run
npm run configure:branch-protection
```

Deeper deploy architecture: [`../ops/DEPLOYMENT.md`](../ops/DEPLOYMENT.md).

## Infisical sync map

| #   | Infisical env | Destination                         |
| --- | ------------- | ----------------------------------- |
| 1   | staging       | Render → frapp-api-staging          |
| 2   | production    | Render → frapp-api-prod             |
| 3   | staging       | Vercel → frapp-web (Preview)        |
| 4   | production    | Vercel → frapp-web (Production)     |
| 5   | staging       | Vercel → frapp-landing (Preview)    |
| 6   | production    | Vercel → frapp-landing (Production) |
| 7   | per-env       | GitHub Actions (OIDC)               |

Project ID is documented in [`SECRETS_MANAGEMENT.md`](../environment/SECRETS_MANAGEMENT.md) and root `.infisical.json`.

## GitHub environments and bootstrap secrets

| Environment  | Protection        | Purpose                             |
| ------------ | ----------------- | ----------------------------------- |
| `staging`    | None              | Staging deploys (`main`)            |
| `production` | Promotion-PR gate | Production deploys + migrations |

> **Environment-protection note — premise corrected 2026-08-21.** This note used to read "GitHub *environment* required-reviewer protection rules are Enterprise-only on private repos, so they do **not** gate this (private, Pro) repo." **The repo is public**, verified 2026-08-21 by fetching the README over raw.githubusercontent.com with no credentials: HTTP 200, against a 404 control for a nonexistent repo. So the private-repo exemption that sentence rested on does not apply, and the conclusion no longer follows from its stated reason.
>
> Nothing was changed on the strength of that, and the gate is unchanged: production is gated by the `main` → `production` promotion PR (branch protection: CI + an approving review + conversation resolution), with the `production` environment existing for job scoping. Whether environment required reviewers are actually available on this plan, and whether to add them on top of the promotion-PR gate, is an **open question for the owner** — check the repo's environment settings rather than trusting either version of this note. Found while reviewing the base-sync App credential, which needed to know the repo's visibility for a different reason.

Repository secrets for Infisical bootstrap: `INFISICAL_MACHINE_IDENTITY_ID`, `INFISICAL_CLIENT_SECRET`, `INFISICAL_PROJECT_ID`.

Additional repo-level secrets used by the deploy-verification workflow: `RENDER_API_KEY`, `VERCEL_API_KEY`. These are read-only API keys used only by `.github/workflows/verify-deployments.yml` to poll deploy state — they never carry runtime values.

Deploy workflow resolves all runtime secrets (including `SUPABASE_ACCESS_TOKEN`) from Infisical at workflow time via `Infisical/secrets-action`. No GitHub environment-scoped runtime secrets are required beyond the Infisical bootstrap listed above.

## Release labels

| Label           | Effect on version bump |
| --------------- | ---------------------- |
| `release:major` | Major                  |
| `release:minor` | Minor                  |
| `release:patch` | Patch (default)        |

## Lint, test, build (repo root)

- `npm run lint` — turbo lint (read-only)
- `npm run lint:api` — API only (read-only)
- `npm run lint:api:fix` — applies ESLint auto-fixes; the only lint script that writes; see [contributing.md §5](../../guides/contributing.md#5-linting-types-and-tests)
- `npm run test -w apps/api` — Jest
- `npm run build` — turbo build
- `npm run check-types` — turbo TypeScript
- `npm run check:api-contract` — OpenAPI / SDK drift
- `npm run check:migration-safety` — migrations + promotion docs
- `npm run check:npm-audit` — npm audit gate: non-allowlisted high/critical advisories fail (CI `dependency-audit`; `-- --soft-network` for offline dev)

`lint` and `check-types` both depend on `^build` in root `turbo.json`, so they build the shared
packages themselves and need no `npx turbo run build --filter='./packages/*'` beforehand — a bare
`npm install && npm run check-types` works on a cold clone. The CI job **`clean-checkout-typecheck`**
exists solely to keep that true: it runs `npm ci`, `npm run check-types` and `npm run lint` with no
`needs:`, no turbo cache restore, and no prebuild step. Every other Node job prebuilds the packages
(ADR Lever A), which makes them all blind to this regression — so do not "optimize" a build or cache
step into that job.

**That guarantee stops at the turbo tasks.** `^build` applies to `build`, `lint` and `check-types`
only; the root `check:*` scripts above are plain node scripts turbo never schedules, so they cannot
inherit it. `check:api-contract` is cold-clone-safe for a *different* reason — it builds
`./packages/*` itself before regenerating (`scripts/check-api-contract-drift.mjs`), because its
OpenAPI export type-checks `apps/api` against those packages and fails with `TS2307` on `@repo/*`
without them. Do not remove that build on the grounds that turbo or CI already covers it: CI's
prebuild step is what would mask the regression, exactly as above. `npm audit` and
`check:migration-safety` need no build at all. Conflating these three cases is what caused #683.

Testing workflows and CI parity: [`.claude/skills/testing/SKILL.md`](../../../.claude/skills/testing/SKILL.md).

## Dependency updates (Dependabot)

Config: [`.github/dependabot.yml`](../../../.github/dependabot.yml). This is the automated half of
the supply-chain story; the blocking half is `npm run check:npm-audit` (above), which fails CI on any
non-allowlisted high/critical advisory.

**One ecosystem entry, at the root.** `apps/*` and `packages/*` are npm workspaces resolving through
a single root `package-lock.json`, so one `npm` entry covers all sixteen. Per-workspace entries would
open duplicate PRs against the same lockfile — don't add them.

**Schedule and noise floor.** Weekly, Monday 09:00 UTC, `open-pull-requests-limit: 5`. Minor and
patch updates are grouped into **one** PR (`npm-minor-and-patch`); majors are deliberately left
ungrouped so each arrives as its own reviewable diff. Every Dependabot PR costs a babysit cycle under
the [Autonomous PR lifecycle](../../../AGENTS.md), which is why grouping is aggressive.

**Who babysits.** Nobody special — Dependabot PRs flow through the normal lifecycle: CI runs (`npm
ci`, lint, type-check, `api-tests`, `web-tests`, `api-docker-build`) plus the audit gate, and an
agent triages red checks infra-vs-code exactly as for a human-authored PR. Commits land as
`chore(deps): …` / `chore(deps-dev): …`; PRs are labelled `area:deps` and carry no release label, so
they take the default `release:patch` bump.

### The ignore list is a runtime constraint, not a preference

`react`, `react-dom`, `react-test-renderer`, the `react-native*` family and the Expo client packages
are ignored. React is pinned to an **exact** `19.1.0` in every workspace plus a root `overrides`
entry: React Native 0.81.5 bundles `react-native-renderer` 19.1.0, which asserts exact version
equality with `react` at runtime, while its peer range (`^19.1.0`) does not express that. npm will
therefore accept a newer React silently, hoist it, and kill `apps/mobile` on first render with
"Invalid hook call" — a failure **only booting the app on a device catches**, never CI. See
[`AGENTS.md` § Gotchas](../../../AGENTS.md) and PR #842. These packages move as a version-locked set
through a planned Expo SDK upgrade (#289), never as isolated bumps.

**The membership rule**, since the list is not simply "everything RN-shaped": a package belongs in it
if it is either (a) exact-version-locked to React (`react`, `react-dom`, `react-test-renderer`) or
(b) a native module whose binary must match the Expo SDK's prebuilt set (`react-native*`, the
`expo-*` client packages, `@expo/*`, `@react-native-async-storage/*`). JS-only libraries on caret
ranges stay updatable even when they look RN-adjacent — `@react-navigation/native` and
`@gorhom/bottom-sheet` are deliberately **not** ignored, because a bad bump there fails
`check-types` or a test rather than dying silently on a device.

Two traps for whoever edits that list next:

- **Do not collapse the Expo entries into `expo-*`.** That glob also matches `expo-server-sdk`, an
  `apps/api` dependency (the push-delivery client) with no relationship to the mobile SDK lock.
  Globbing it would freeze the API's push library silently and indefinitely. The client packages are
  listed individually for exactly this reason; if an SDK upgrade adds a new one, append it.
- **Ignore conditions also suppress Dependabot _security_ updates.** A CVE in React, React Native or
  an Expo client package will **not** open a PR automatically. This is an accepted trade — an
  isolated security bump in that set breaks the runtime — but it is a real gap, so it is written down
  rather than left implicit. `check:npm-audit` still fails CI on such an advisory, so it surfaces
  loudly; carrying the fix means doing an SDK-aligned upgrade, not a one-package bump.

`@types/react` is deliberately **not** ignored: it is types-only, carries no runtime equality
assertion, and a bad bump fails `npm run check-types` in CI — which is precisely the safety net that
makes auto-updates tolerable.

**Dependabot does not manage the root `overrides` block.** Those entries (`handlebars`, `undici`,
`path-to-regexp`, … — added by #861 to force patched versions of *transitive* dependencies) are
invisible to it, so they neither get bumped nor get cleaned up as the direct dependencies that pulled
them in move on. Reviewing that block is a manual job; `npm run check:npm-audit` is what tells you an
override is no longer doing its work.

### Dependabot PRs are exempt from the docs/spec sync gate

`check-docs-impact.mjs` runs from **one** workflow — `.github/workflows/docs.yml` (the required
`docs-spec-sync` check) — and skips when the PR author is `dependabot[bot]`.

Without that exemption Dependabot would be unusable here, not merely noisy: its PRs change
`package.json` / `package-lock.json` and nothing else, `check-docs-impact.mjs` fails any PR that
touches non-`docs/` files without touching `docs/`, and **`docs-spec-sync` is a required status check**
(`scripts/configure-branch-protection.mjs`) under `enforce_admins: true`. Every Dependabot PR would
therefore have been permanently unmergeable — blocked, with no admin override.

Two things to preserve if you ever edit that condition:

- **Skip the step, never the job.** A skipped job never reports its check run, so the PR would block
  forever on a required check that never arrives — worse than the failure being replaced. The
  step-level `if` keeps the job, and therefore `docs-spec-sync`, green.
- **Key on `github.event.pull_request.user.login`, not `github.actor`.** The actor changes when a
  human re-runs the workflow, which would silently flip the exemption off mid-PR.

`check-docs-structure.mjs` needs no exemption — it only inspects newly *added* paths under `docs/`
and `spec/`, of which a dependency bump has none, so it passes trivially.

**There used to be a second copy, and keeping two in sync is exactly what failed.** `ci.yml` ran the
same script as the last step of `lint-and-typecheck`, unguarded, so every Dependabot PR went green on
`docs-spec-sync` and red on `lint-and-typecheck` for the identical reason the exemption exists — the
exemption was real but inert, and the PRs were just as unmergeable. It was given the same condition
(#1011) and then **removed entirely** when the `no-doc-change-needed` waiver landed: honouring a label
in `ci.yml` would have meant re-running the whole suite, Docker build included, on every label
mutation on every PR. **The gate now has exactly one home. Do not add a second** — the drift above is
what a second copy buys you. Full contract: [`DOCS_CI.md`](DOCS_CI.md).

One caller outside CI: [`scripts/run-local-ci-gate.mjs`](../../../scripts/run-local-ci-gate.mjs) runs
the script locally. It needs no Dependabot exemption (a human runs it), and it inherits
`PR_LABELS_JSON` from the shell, so the waiver works there too — see
[`DOCS_CI.md`](DOCS_CI.md#the-no-doc-change-needed-waiver).

### `colorjs.io` is ignored: it is a vendored-generator pin, not a dependency

`packages/chapter-theme/src/vendor/generate-radix-colors.ts` is upstream Radix source held
byte-for-byte, and its runtime deps are pinned to match upstream's own `package.json`. `colorjs.io`
sits at an exact `0.5.2`, so Dependabot read `0.7.1` as a *minor* under 0.x semver and swept it into
the grouped PR — where its new `Coords` type (`[number | null, …]`, for CSS Color 4 `none`
components) produced 24 type errors in a file that must not be hand-edited, taking `packages-build`,
`clean-checkout-typecheck` and `api-docker-build` down with it (#1003).

That is the gate doing its job: the `noUncheckedIndexedAccess: false` note in that package's
`tsconfig.json` says outright that typechecking the vendored file is what surfaces "a breaking change
in `colorjs.io`'s API, found on resync". Moving the pin means re-vendoring the generator from an
upstream commit that also moved and re-running `signet.spec.ts` — a resync, not a bump. The ignore
entry keeps that a human decision instead of a weekly red PR. The generator's other two pins stay
under Dependabot; the reasoning for each is in
[`packages/chapter-theme/src/vendor/README.md`](../../../packages/chapter-theme/src/vendor/README.md).

### The ESLint 10 major is held on a plugin, not on our code

`eslint` and `@eslint/js` ignore **major** updates only; 9.x minors and patches still flow. The
blocker is `eslint-plugin-react`: 7.37.5 is its newest published release and its peer range still
ends at `^9.7`. ESLint 10 removed the deprecated `context` methods the plugin calls, so it throws
`contextOrFilename.getFilename is not a function` out of its React-version detection path and takes
React workspace lint (`apps/web`, `apps/landing`) down with it.

The two packages move as a set — `@eslint/js@10` peer-requires `eslint@^10`, so bumping either alone
fails `npm ci` with `ERESOLVE`. That is why both carry the ignore rather than just one.

What makes this a *hold* rather than an open question: it was measured. Pinning
`settings.react.version` in `packages/eslint-config/{next,react-internal}.js` skips the detection
path entirely, and the whole monorepo then lints clean under ESLint 10 — the plugin has no other
v10 incompatibility we trip. That workaround was rejected for now because it runs a core plugin
outside its declared peer range and hardcodes a React version that has to be hand-synced with the
real pin. When `eslint-plugin-react` declares v10 support, drop these two ignore entries and the
upgrade should be close to a no-op. Original PRs: #943 (`eslint`), #944 (`@eslint/js`).

### eslint-plugin-react-hooks 7 compiler rules

`eslint-plugin-react-hooks` 7.x enables React Compiler rules on top of the two classic
Rules of Hooks. We do not run `babel-plugin-react-compiler`. Shared presets
([`packages/eslint-config/react-hooks.js`](../../../packages/eslint-config/react-hooks.js))
**opt in** to a named allowlist at upstream severity; any rule the plugin ships that is
missing from that allowlist is forced `"off"`, so a later plugin bump cannot re-open
`--max-warnings 0`. The allowlist is the gate — not the upstream config it derives
severities from, which is `recommended-latest` (as of 7.1.1 a strict superset of
`recommended`: the same 16 rules at identical severities, plus `void-use-memo`).

**Enabled at upstream severity** (re-measured 2026-08-20 on `117e0c5`: 0 findings on
`apps/web`, `apps/mobile`, `apps/landing`, `packages/hooks` and every other preset
consumer, after the area cleanups — chat #1122, auth #1123, realtime #1124, forms
follow-up): **every rule v7 ships** — all 16 in `recommended`, including
`set-state-in-effect`, `refs`, `preserve-manual-memoization` and `use-memo`, plus the one
`recommended-latest` extra, `void-use-memo` (#1134). No v7 rule is held off. Intentional
effect-synced drafts (dialog/form reset, invite-token seed, network-banner slide-out) use
scoped `eslint-disable-next-line` / tight block disables with a reason, never
a rule-level `"off"`.

#1108 is the bump that introduced the original hold; #1134 closed the last gap in that
rollout. Adopting a *new* compiler rule that appears in a later plugin bump is still a
dedicated cleanup (fix or scoped disable each finding, then add the rule to the
allowlist), not a Dependabot follow-through.

### TypeScript 7 is native `tsc` plus a TypeScript 6 compiler API

TypeScript 7.0 is a native Go compiler. The npm `typescript@7` package ships `tsc` and a
version stub — `require('typescript').createProgram` is `undefined`. Tools that import the
JavaScript compiler API therefore cannot use it as the `typescript` package:

| Tool | Constraint |
| --- | --- |
| Nest CLI (`nest build`) | Needs `createProgram`; errors telling you to install TypeScript 6 until 7.1 |
| `typescript-eslint` 8.67 | Peer `typescript: >=4.8.4 <6.1.0` |
| `ts-jest` 29 | Peer `typescript: >=4.3 <7` |
| `openapi-typescript` 7.13 | Peer `typescript: ^5.x` — **invalid** against the 6.x alias; regen still uses the compiler API. Do not flatten to 5.x to silence `npm ls`. Revisit when upstream ships a 6.x peer ([openapi-ts#2774](https://github.com/openapi-ts/openapi-typescript/pull/2774)). |

Microsoft's layout, which this repo follows, is two aliases in the root manifest (and the
same `typescript` alias in every workspace that lists it):

```json
{
  "devDependencies": {
    "@typescript/native": "npm:typescript@7.0.2",
    "typescript": "npm:@typescript/typescript6@6.0.2"
  }
}
```

`npx tsc` is TypeScript 7.0.2. The `typescript` package is the 6.0.2 wrapper
(`@typescript/typescript6`); it re-exports `@typescript/old` (`npm:typescript@^6`), which is
what `require('typescript').version` and `npx tsc6 --version` report (currently 6.0.3). Root
`overrides` pin `@typescript/old` to `npm:typescript@6.0.3` so a `^6` float cannot land 6.1
while the wrapper still looks like 6.0.2 (`typescript-eslint`'s peer is `<6.1.0`). `@nestjs/cli`
still nests its own `typescript@5.9.3`; ESLint, ts-jest, and Next's API mode load the project
alias. TypeScript 7 also stopped inferring `rootDir` from the common source directory — emitting
packages set `"rootDir": "src"` in their own `tsconfig.json` (not in
`@repo/typescript-config/base.json`: TypeScript resolves `rootDir` relative to the file that
declares it, so a shared `./src` would point at `packages/typescript-config/src`). The emitting
set is `@repo/validation`, `@repo/hooks`, `@repo/color`, `@repo/formatting`, `@repo/chapter-theme`,
`@repo/org-archetypes`, `@repo/chat-integrations` (each `"build": "tsc"`), and `@repo/api-sdk`
(`outDir` is set even though `check-types` passes `--noEmit` and there is no `build` script —
do not add a build as a side effect of this pin). Non-emitting packages (`@repo/theme`,
`@repo/chat-core`) and the Next / Expo apps stay `noEmit`. `apps/api` sets `"rootDir": "./src"`
on `tsconfig.build.json` only, so `nest build` emits the API entry at dist/main.js. Do not set
`rootDir` on `apps/api/tsconfig.json`: `"."` would let a stray `tsc -p tsconfig.json` emit
dist/src/main.js instead of failing TS5011, and `"./src"` would hide `test/` from ESLint's
project service.
`baseUrl` is a hard error under native tsc, and it is gone from every in-repo tsconfig
(`apps/api`, `apps/web` `paths` without `baseUrl`, `apps/mobile` `paths` without `baseUrl`).
Expo's `tsconfig.base` also does not set it. `apps/api` also sets `"strict": false` explicitly:
TypeScript 6/7 default `strict` to true, and this app had only opted into `strictNullChecks` /
`noImplicitAny` / `strictBindCallApply` — Nest DTO class fields would otherwise be hundreds of
`TS2564`s. Do not flip it to `true` as cleanup. TypeScript 6 also treats many mock `as never` /
`as Member` assertions as unnecessary, which `@typescript-eslint/no-unnecessary-type-assertion`
now flags as errors. Remaining `as never` / `as unknown as` in specs are load-bearing (smuggled
DTO keys, incomplete Express/Sentry/Stripe mocks) — do not strip them as a TS-version leftover.

Next.js 16 defaults `experimental.useTypeScriptCli` to `true`, then looks for
`typescript/bin/tsc`. That file does not exist on `@typescript/typescript6` (it ships `tsc6`).
`apps/web` and `apps/landing` therefore set `useTypeScriptCli: false` so `next typegen` /
`next build` use the TypeScript 6 compiler API instead. Do not flip it back while `typescript`
is the 6.x alias — Next will try to `npm install typescript` (which resolves to 7) and fail.

Every ts-jest project overlays `"rootDir": "."` and `"ignoreDeprecations": "6.0"`: the unit
suite in `apps/api/package.json`, plus `apps/api/test/jest-e2e.json`,
`apps/api/test/integration/jest-integration.json`, and
`apps/api/test/ai-evals/jest-ai-evals.json` (those three also keep the CommonJS `module` /
`moduleResolution` / `resolvePackageJsonExports` overlay that needs `ignoreDeprecations` for
`TS5107`; see [`docs/guides/testing.md`](../../guides/testing.md) §6). The unit overlay does
not set `moduleResolution: "node"`; it still carries `ignoreDeprecations` so the four configs
share the same two keys if a later overlay adds a 6.0-deprecated option.

**Do not flatten this back to `typescript@7`.** That is what Dependabot's first 5.9.2 → 7.0.2
bump did (#1031), and it failed `packages-build` / `clean-checkout-typecheck` / `api-docker-build`
on `packages/validation` (`TS5011` missing `rootDir`) before Nest, ESLint, and Jest could even
run. Re-evaluate when TypeScript 7.1 ships a stable programmatic API *and* those three peers
widen; until then the aliases move independently — native 7.x patches on `@typescript/native`,
6.0.x patches on the `typescript` alias (stay below 6.1 for `typescript-eslint`).

### Alerts and security updates are a repo Settings toggle

Dependabot **alerts** and **security updates** live in repo Settings → Advanced Security, not in this
file, and an agent session cannot read or flip them: `GET /repos/pdcarlson/Frapp/vulnerability-alerts`
returns `403` through the agent proxy, and the GitHub MCP exposes no repo-security-settings tool.
Confirming those toggles is tracked as a `[human]` issue (#921).

## Claude Code project settings

`.claude/settings.json` ships repo-wide config for Claude Code sessions (cloud and local). Current contents:

| Key               | Value  | Effect                                                                                                                                                                                                                                                           |
| ----------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doneMeansMerged` | `true` | The session is not "done" when code is pushed — it's done when the PR is green and review-clean. Drives the babysit-until-merge loop — the six-step contract in AGENTS.md § "Autonomous PR lifecycle": open PR → subscribe → **read the wake comments** (the self-wake step was retired 2026-08-08 — it prompts and cannot be allowlisted; see "Wake coverage") → **triage infra-vs-code** → fix until merge-ready (or a self-contained next step). |
| `permissions.allow` | `Workflow` + GitHub MCP babysit/tracker tools | Auto-approves the multi-agent **Workflow** tool so `/next ultracode` fan-outs don't stall on a prompt. Lists the **GitHub MCP** tools the babysit loop and tracker need (`subscribe`/`unsubscribe_pr_activity`, issue/PR reads and writes, `actions_run_trigger`). The 21 `Claude_Code_Remote` / kebab-case / connector-UUID entries for `send_later` and the trigger family were **removed** — they were inert on the cloud surface (ceiling rule) and were being misread as permission. Do not re-add them to "allowlist" `send_later`; it still prompts. `merge_pull_request`, `enable_pr_auto_merge`, `push_files`, `create_or_update_file`, and `delete_file` stay unlisted — merging and direct repo-content writes are not repo-sanctioned (the harness `mcp__github__*` wildcard may still auto-approve them on cloud; the merge gate is policy — see "Applied permission allows"). Linear allows were removed with the retirement (#680). |
| `skipWorkflowUsageWarning` | `true` | Marks the multi-agent workflow usage warning as accepted. Per the settings schema (an `@internal` key, read out of the 2.1.220 build — re-verify on newer builds): "Until set, auto permission mode prompts before running a workflow." Set so unattended sessions don't stall on that prompt; a launch that prompts anyway on some build falls back to inline checks (see `/next`). |
| `hooks` | PreToolUse + SessionStart | Wires [`pre-push-review-gate.sh`](../../../.claude/hooks/pre-push-review-gate.sh) (Bash matcher — the single pre-PR review gate) and [`session-start.sh`](../../../.claude/hooks/session-start.sh) (cloud-sandbox bringup). A second PreToolUse hook (`linear-autoallow.sh`, PR #676) auto-approved Linear's write tools; it was deleted with the Linear retirement — see "Applied permission allows" below. Details: [`AI_CODE_REVIEW_RUNBOOK.md`](AI_CODE_REVIEW_RUNBOOK.md) and the "Claude Code web sandbox" section of [`AGENTS.md`](../../../AGENTS.md). |

Authoring contract for the loop (what an agent must do) lives in [`AGENTS.md`](../../../AGENTS.md) under "Autonomous PR lifecycle". Keep the two in sync when changing either.

## PR babysitting: wake signals and CI-failure triage

Why the babysit loop needs more than `subscribe_pr_activity`, and what each layer covers. Root
cause on record: during the 2026-08-06 GitHub Actions outage, PR #659's `secret-scan` job died in
runner setup ("Failed to resolve action download info. Error: Service Unavailable" — the job's only
step was "Set up job"), six sibling jobs were cancelled without ever getting a runner, and the
watching session was never woken — the PR sat silent for ~2h until a human noticed.

### CI branch filters: never target a feature branch

`on.pull_request.branches` on `ci.yml`, `docs.yml`, and `links.yml` is `[main, production]`.
GitHub matches that list against the PR **base**, not the head. A PR whose base is another
feature branch therefore never runs CI, docs-spec-sync, or Links. GitHub still allows a
squash-merge; the UI shows MERGED; the commits exist only on the base feature branch.
`origin/main` is unchanged. `pr-base-sync.yml` only sweeps PRs targeting `main`, and
`ci-wake.yml` never fires because CI never ran — the babysit loop is blind.

Incidents: #1120 and #1123–#1125 were squash-merged into stacked feature branches. GitHub
marked each MERGED; none reached `main`; CI never ran. Recovery is cherry-pick onto current
`origin/main` and a new PR whose base **is** `main` (the #1122 / #1127 / #1128 pattern).

**Playbook** (GitHub MCP down, opening area PRs, or any PR-opening path):

1. **Never open a PR whose base is not `main` or `production`.** Feature work → `main`.
   Promotion → `production` from `main` only. There is no sanctioned third base.
2. **Never squash-merge into a feature branch** to "land" a stacked slice. GitHub's MERGED
   badge is not evidence the work is on `main`.
3. **If it already happened:** cherry-pick the slice onto current `origin/main` and open a
   new PR targeting `main`. Do not restack onto another feature branch. Confirm the new PR
   actually runs CI (required checks present, not all skipped or missing).

**The mechanism (2026-08-20): `pr-base-guard.yml`.** The playbook above is a rule agents
must remember, and #1124 and #1125 landed the same way #1120 and #1123 did *after* the
first two were noticed — so the rule alone demonstrably does not hold. The guard is a
single job on `on: pull_request` with **no** `branches:` filter, which is what lets it see
the PRs every other workflow is blind to. It passes on `main` / `production` and fails
otherwise, with the retarget instructions in the log.

Why this and not the alternatives:

- **Widening `ci.yml`'s filter to all branches** would make CI *run* on a stacked PR, but
  running CI was never the actual protection — GitHub would still show MERGED, and the
  commits would still not be on `main`. It also re-runs the full matrix (Docker build
  included) on every stacked push, for PRs that must not be merged at all. Wrong lever,
  real cost.
- **A scheduled sweep for "MERGED but not an ancestor of `main`"** detects the damage after
  it is done and needs its own alert-issue plumbing and a window to be wrong about. The
  guard refuses the PR before anyone can press the button.

Known limit, deliberately not papered over: a red check does not *block* a merge unless it
is a required check, and branch protection on `main` cannot make a check required on a PR
whose base is a feature branch. So the guard converts a **silent** failure into a **loud**
one — a PR that used to carry zero checks now carries one red X — but a determined merge
can still override it. Making `PR base guard / base-branch` required on `main` is a
branch-protection change and is tracked separately; it is not what closes this gap.

**Not the same check as `branch-policy`, and do not merge them.** `ci.yml`'s `branch-policy`
job guards the *head* of a `production` PR (`base_ref == 'production'` → head must be
`main`); `pr-base-guard` guards the *base* of every PR. `branch-policy` also lives inside
`ci.yml`, so it inherits the `[main, production]` filter and structurally cannot see the
feature-base PRs this guard exists for — which is why it shows as `skipped` on a normal
`main` PR. They compose; deleting either as a "duplicate" reopens a gap.

Verifying the guard: it is pure shell over one payload field, so it is exercised by the
four incident bases directly — `main` and `production` exit 0; `cursor/...`, `main-ish`,
`release/1.0`, and an empty ref all exit 1 (fails closed on anything unrecognised). It
also passed on its own PR (#1132, check run `base-branch`), which is the end-to-end proof
that a no-`branches` workflow does fire.

#962 is adjacent and **not** this bug:
GitHub honours `Fixes #N` only on merge into the **default** branch, so a stacked PR can
ship via its parent and still leave issues open. This section is the worse case — the work
never reaches `main` and CI never ran.

### Wake coverage

| Signal | Fires on | Misses |
| ------ | -------- | ------ |
| PR-activity webhook (`subscribe_pr_activity`) | CI **failure**, **successful check-suite rollups** (observed 2026-08-21 — see below), comments, reviews | cancelled, timed-out, merge-conflict — all silent |
| `CI wake` watchdog comment (`ci-wake.yml`) | exactly two things, and it is worth being precise because most of this list is *silent* on attempts 1-2: (a) a **deliberate** cancellation — a run cancelled after some job had started, or with the jobs/runs API down so it cannot be told from an infra one; (b) an **infra failure the auto-requeue did not absorb**, i.e. the re-queue call failed or the 3-attempt cap is spent. `timed_out`, `startup_failure`, `stale`, and a cancel where no job ever started all classify as infra-failure and are requeued first, so they say nothing until that runs out | outages that kill the watchdog run itself; merge-conflict; review-state changes. **Deliberately silent:** success and real failures (the webhook carries both), any infra failure that WAS requeued (the fresh attempt's own completion is the wake), `skipped`/`neutral`/`action_required`, and superseded runs |
| `PR base sync` wake comment (`pr-base-sync.yml`) | `main` moving while this PR is conflicted with it, or behind it and un-updateable for a reason specific to this PR (a fork head, a one-off API error) — the comment says which and what to do | base moves while the sweep run itself dies; PRs past the sweep's 20-PR cap this round (logged; the sweep processes least-recently-updated first, so deferred PRs rotate to the front of a later sweep); unknown mergeability (skipped fail-safe, deliberately silent) |
| `PR base sync` alert issue | a missing or rejected app token — the one cause that is repo-wide rather than per-PR | anything per-PR (those comment); a sweep where nothing was behind, which proves nothing either way and deliberately leaves an open alert open |
| Retired — do not call `send_later` | — | Entire layer. Unusable unattended on the cloud surface (prompts the owner every call). Do not re-add it to `permissions.allow`. |

Layered conclusion: the webhook is the fast path for CI outcomes and human comments, the watchdog
comment covers the terminal states the webhook has no event for once a re-queue has stopped being an
option, and the base-sync comment is the fast path for base moves and merge conflicts. **Arm those
three; they never prompt.**

> **The success half of that webhook row was OBSERVED on 2026-08-21, on PR
> [#1171](https://github.com/pdcarlson/Frapp/pull/1171) itself.** It began as a docs-verified claim
> about the Claude Code harness's `subscribe_pr_activity` contract, and it is load-bearing — the sole
> justification for `shouldComment: false` on the `success` verdict in `scripts/ci/ci-wake.mjs` — so
> it was written down with a confirmation trigger rather than asserted. The trigger fired on the
> first push:
>
> - The session watching #1171 received **four** `check_suite.completed` envelopes for head
>   `29b5a45`, each carrying `"conclusion":"success"` — one per workflow suite. Green CI does wake a
>   subscribed session.
> - Those arrived as their own events, distinct from the `issue_comment.created` envelopes carrying
>   the three `CI wake` comments on the same head, so the success delivery does **not** depend on
>   this watchdog's comments. That independence is the part that matters, because it is what survives
>   this change removing them.
>
> **The silent half was confirmed on the first push after the merge**, PR
> [#1172](https://github.com/pdcarlson/Frapp/pull/1172), 2026-08-21. Three `CI wake` runs fired for
> that push — one per watched workflow — and all three completed `success` while the PR ended with
> **zero comments**. The watchdog did not fail to run; it ran and chose silence, in its own words
> ([run 1934](https://github.com/pdcarlson/Frapp/actions/runs/32506252734)):
>
> ```
> [ci-wake] CI #32505950228 attempt 1: success → success (All jobs green.)
> [ci-wake] no wake needed on #1172
> ```
>
> Same repo, hours apart, the comparison is clean: on #1171 the old build put a comment on the
> thread within ~10s of each of those same suites reporting green, three per push. The three
> comments still on #1171 are the last ones this watchdog will ever post for a green run.
>
> Rollback, should the webhook's success coverage ever regress: restore `shouldComment: true` for
> the `success` verdict in `classifyRun`. Keep the clear-stale path either way — it is what stops a
> red wake outliving the failure it described.

The webhook's success coverage is the reason the watchdog stopped commenting on green runs. Before
that, every push put three fresh comments on the PR (CI, Docs spec sync, Links) restating what the
checks UI and the webhook had both already said, and the delete-then-create cadence re-notified on
each one — so the wake that *was* worth reading arrived indistinguishable from two that were not.
A watchdog whose output gets skimmed is not a watchdog. Silence is now the signal that nothing
needs a human or an agent.

One consequence to keep in mind when reading a thread: a wake comment that is *gone* does not mean
nobody looked. Success and real failures both clear this workflow's wake, so an empty thread is the
normal state of a healthy PR — check the checks UI, not the comment history, for what CI did. The self-wake would be the only *complete*
net — it is the one layer that misses nothing — but it prompts the owner on every call, so on the
cloud surface it is not usable unattended and is deliberately not armed (below). The coverage it
would have added is a known, accepted gap, not an oversight.
Sandbox shell access to `api.github.com` is session-dependent (the org-connect 403 was observed
2026-08-08; a 200 was observed the same day in another session), so background polling of GitHub
cannot be relied on — treat GitHub as reachable only through MCP tools, only while awake.

**Do not call `send_later` on the cloud surface, and do not try to fix it from the
repo.** Directly observed (2026-08-08): it **still prompted the owner** through every allow-list
spelling then present. Those 21 entries were later removed so they would stop being misread as
permission. The likely mechanism is the ceiling rule
([below](#applied-permission-allows)) — the harness's `--allowed-tools` snapshot contains no
`mcp__Claude_Code_Remote__*` entry at all — but that rule is a working hypothesis, and the
practical conclusion does not depend on it: **more allow entries have already been tried and did
not work.** Do not re-add them.

Two earlier claims about this tool are corrected: on this surface the call does **not** dead-end in
`-32003`, and approval is **not** converted to a denial — the owner approved and the call succeeded,
returning a live trigger id. It simply *asks*, and asking is what disqualifies it from unattended
runs — not failing. Owner's standing preference (2026-08-08): don't call it. The other three layers
carried PR #743 unaided — three `CI wake` comments (CI, Docs spec sync, Links) plus the merge
notification, none of which prompted. Anything genuinely needing a schedule is a real Routine
created in the UI, which works fine. If a session does call it and it prompts, say so once, never
re-arm, and never ship a settings change to "fix" it — that would be the fourth attempt at a fix
that has already failed three times.

### What the watchdog does (`scripts/ci/ci-wake.mjs`)

- **Classifies** the completed run. *Infra failure*: every failed job died before its first
  repo-defined step (runner-phase steps only — the outage signature); a `cancelled` run counts
  only when **no job ever started a step** (never got a runner), so a deliberate human/agent
  cancellation of a running job is commented but never resurrected; `timed_out` /
  `startup_failure` / `stale` count too. *Code failure*: any job failed in a real step —
  classified, logged, and then deliberately **not** commented on, because `failure` is the one
  conclusion the PR-activity webhook has always delivered.
  *Superseded*: a newer run of the same workflow exists for the branch (repush; `ci.yml`'s
  `cancel-in-progress` cancels the old run on every push) — stays fully silent, no re-run, no
  comment. Classification **fails closed**: if the jobs or runs API errors mid-classification,
  the run is reported as unclassified and never called "infra", never requeued — an API blip
  must not relabel a real code failure as infrastructure.
- **Auto-requeues infra failures** via `rerun-failed-jobs` (falling back to plain `rerun` for
  cancelled-only runs), capped at **3 total attempts** per run id. The cap is mandatory: per
  GitHub's documented `workflow_run` semantics, a re-run creates a new attempt of the same run
  and fires `workflow_run: completed` again when it finishes, and GITHUB_TOKEN's recursion guard
  does **not** stop this loop (it only blocks *creating* new runs) — so an uncapped loop would
  retry to GitHub's 50-attempt ceiling. Prior art: vercel/next.js `retry_test.yml` uses exactly
  this trigger + `run_attempt` guard. These are docs-verified claims (2026-08-06), not yet
  observed in this repo — confirm on the first post-merge firing.
- **Upserts one wake comment per workflow** on the open PR — but only for a deliberate cancellation,
  or for an infra failure (from any of `failure` / `cancelled` / `timed_out` / `startup_failure` /
  `stale`) that the auto-requeue did **not** absorb. Note the `failure`-conclusion infra case is in
  that set: the webhook did fire, but only this watchdog knows the failure was the 2026-08-06
  "Failed to resolve action download info" shape and that the automatic retry is not coming. It deletes that workflow's previous marker comments
  (`<!-- frapp-ci-wake:<workflow name> -->`) and posts a fresh one, so a green `Links` wake can
  never erase a red `CI` wake. Open-state is checked via the pulls API (a merged/closed PR gets no
  wake), and the head-owner comes from the run's head repo so fork PRs resolve. Delete-then-create,
  never edit-in-place — comment edits deliver webhook `action=edited`, which created-only listeners
  (the agent wake path) never see.
- **Clears its own wake on every other informative verdict.** Success, a code failure, an
  unclassified failure and a requeued infra failure all delete this workflow's marker comment
  without posting anything. This half is load-bearing and easy to lose: while success always
  commented, the fresh success comment is what *overwrote* the previous red one. Take the comment
  away without taking the delete with it and a "cancelled" wake sits on a PR that has been green
  for a week. `ignored` conclusions (`skipped` / `neutral` / `action_required`) and superseded runs
  clear nothing — they carry no verdict, so erasing a live wake on their say-so would be a guess.
- Runs with minimal action surface (checkout only, preinstalled runner Node, no `npm ci`) so the
  watchdog itself has the least possible exposure to the action-download infra failures it absorbs.
  It is best-effort by design. Nothing now covers the case where the watchdog run itself dies —
  the self-wake that used to backstop it prompts and was retired (see "Wake coverage"), so that
  gap is accepted and a human notices instead. Keeping this workflow's surface minimal is
  therefore load-bearing, not just tidy.
- Scope note vs. ADR-14: the "no inline GitHub comments" trade-off recorded for AI *review*
  (see `AI_CODE_REVIEW_RUNBOOK.md`) is unchanged — the wake comment is machine signaling about CI
  state, not review commentary, and a healthy PR now carries none at all.

Because `workflow_run` executes the **default branch's** copy of the workflow and script, changes
to either take effect only after merging to `main` — they cannot be exercised from the PR that
introduces them (unit tests + this doc are the pre-merge verification).

### Base-branch sync (`scripts/ci/pr-base-sync.mjs`)

Branch protection on `main` sets `strict: true`, so every merge to `main` outdates every other
open PR. `pr-base-sync.yml` fires on each push to `main` and sweeps open PRs targeting it —
sequentially, capped at 20 per sweep with the remainder logged (never silently truncated), and
listed **least-recently-updated first**: acting on a PR bumps its `updated_at` to the back of the
next sweep's order, so a deferred PR rotates to the front instead of being starved behind the same
busy twenty. Per PR, after bounded polling of GitHub's lazily-computed `mergeable` flag:

- **Conflicted** → one `<!-- frapp-base-sync -->` wake comment telling the watching agent session
  to `git fetch origin main && git merge origin/main`, resolve, and push. Conflicts always go to
  an agent — no API call can resolve them.
- **Behind and clean** (measured with the compare API's `behind_by`, not `mergeable_state`, which
  reports `blocked` over `behind`) → auto-updated via `PUT …/update-branch` with
  `expected_head_sha`, **only when the base-sync app token minted**. Pushes made with the default
  `GITHUB_TOKEN` do not create workflow runs (GitHub's recursion guard), so an update through it
  would strand required checks at "Expected" with no CI ever running — strictly worse than not
  updating. On a fork head, or when the update call fails for a reason specific to that PR, the
  wake comment asks the agent to merge `main` itself — the agent's own push triggers CI normally.
  GitHub invalidates `mergeable` lazily, so a sweep racing the base push can read a stale `true`
  for a freshly-conflicted PR; when the update-branch call then fails with a conflict message, the
  sweep posts the **conflict** wake (not the behind one), so the agent always gets resolution
  guidance when it will need it.
- **Behind, and auto-update is off repo-wide** (no token minted, the API rejects it with 401/403, or
  update-branch is 5xx-ing / unreachable) → the PR **still gets its wake**, and the *diagnosis* goes
  to one `routine-state` alert issue instead. The distinction is the whole point: the wake carries
  "merge `origin/main` yourself", which is what unblocks that PR and is its session's only signal
  that the base moved; the diagnosis ("no app token was minted") is a repo-level fact its reader
  cannot act on, and repeating it on twenty threads is the noise. So the per-PR reason for these
  cases just points at the issue. The alert is **P2, not P1**: PRs still merge, they just need
  `Update branch` pressed by hand — where the repo was before this sweep existed.
  - A **secondary rate limit** is deliberately not in that set. GitHub answers it with 403, the same
    status as a dead token, and a sequential twenty-push sweep is exactly the shape to trip one — so
    a rate-limited 403 skips fail-safe rather than filing a P2 accusing a working credential.
  - The alert is written **only on a state change**: an already-open one is left alone. `raiseAlert`
    comments on every raise, which suits `deploy-alert.mjs` (it fires per failed deploy) and not this
    sweep (it fires per merge to `main`), so raising unconditionally would relocate the fan-out from
    N PRs to one issue rather than remove it.
  - It closes on a real `update-branch` success, or on a sweep that held a token and blocked on
    nothing. That second condition is deliberate: this repo merges about one PR at a time, so the
    usual sweep has no *other* open PR to update, and an alert gated on a same-sweep success would
    stay open for weeks after the fix. A sweep with **no** token and nothing behind proves nothing
    and never closes it (the "a no-op run never closes an open alert" rule under Deploy visibility).
- **Already in sync** → any stale base-sync wake comment is deleted and the sweep stays silent.
  Unknown mergeability (API error, `mergeable` never resolves) is skipped fail-safe: never
  blind-updated, never falsely accused of conflicts; the next base move re-sweeps.

Comment mechanics match `ci-wake.mjs` (shared helpers): delete-then-create so created-only webhook
listeners fire on every base move, one live comment per PR. Like the CI wake watchdog it is
best-effort and **not** a required check; a successful auto-update posts no comment at all — CI
runs on the updated head, and a failure there reaches the watching session through the webhook.

#### The token

`PR_BASE_SYNC_TOKEN` is a **GitHub App installation token**, minted per run by
`actions/create-github-app-token@v3` in `pr-base-sync.yml` from two repository secrets:
`PR_BASE_SYNC_APP_CLIENT_ID` and `PR_BASE_SYNC_APP_PRIVATE_KEY`. An App was chosen over the
fine-grained PAT this originally specified for two reasons: an installation token has no expiry
for a human to renew on a calendar reminder (it is minted fresh each run and expires in an hour),
and it is not tied to one person's account, so it survives that person's PAT policy, their token
cleanup, and their leaving. The cost is one more action download on a workflow whose header
otherwise claims a checkout-only surface — an accepted, deliberate widening, kept as small as it
can be.

Setup was human-only and is closed as [#689](https://github.com/pdcarlson/Frapp/issues/689): the
App is created under the `pdcarlson` account with repository permissions **Contents: Read and
write** and **Pull requests: Read and write** (nothing else), installed on `pdcarlson/Frapp` only,
with its client ID and a generated private key stored as the two secrets above. To rotate the key:
generate a new one on the App, update `PR_BASE_SYNC_APP_PRIVATE_KEY`, delete the old key — no PR,
and nothing tied to a personal account changes. The mint step carries `continue-on-error: true` on
purpose — with the secrets absent it fails, and a red workflow would be exactly the noise this sweep
exists to remove; instead the token comes out empty and the alert issue explains why.

**Confirmed end to end on 2026-08-21T17:28Z**, on the first behind PR the sweep ever encountered.
This closes the one claim the design rested on and could not check from a session: that an App
installation token's pushes **create workflow runs**, where `GITHUB_TOKEN`'s do not (GitHub's
documented recursion guard). `docs.github.com` is blocked by the cloud sandbox's egress proxy, so
that half stayed docs-verified until a real sweep exercised it. It has now been observed directly:

```
17:27:53  #1174 merges to main → PR base sync run 157 fires
17:28:02  Mint base-sync app token — success
17:28:09  [pr-base-sync] #1172: behind by 1 — auto-updated via update-branch
17:28:10  Token revoked
17:28:15  CI run 32508320750 starts on the new head          ← the load-bearing observation
17:28:24  check suites begin reporting success on 2fb22e4
```

The resulting head commit `2fb22e4` is authored by `frapp-base-sync[bot]` ("Merge branch 'main'
into …") with no human, no agent and no comment on the thread, and CI ran on it. Under
`GITHUB_TOKEN` those required checks would have sat at "Expected" indefinitely — strictly worse than
not updating, which is why the pre-App code refused to try. An earlier sweep
([run 156](https://github.com/pdcarlson/Frapp/actions/runs/32504830354)) had already shown the mint
half: `PR_BASE_SYNC_TOKEN: ***`, `(auto-update enabled)`, and `Token revoked` at cleanup.

**If this ever regresses** — a sweep reports `auto-updated via update-branch` and the PR's required
checks then sit at "Expected" with no run — the fallback is a fine-grained PAT (contents +
pull-requests write) stored directly as `PR_BASE_SYNC_TOKEN`, replacing the mint step. Nothing else
in the sweep changes; the script reads one env var either way.

#### Why the App is safe on a public repo

Reviewed 2026-08-21, because this repo is public and the App holds `contents: write`. No finding;
the App is a net improvement on the PAT route it replaced — a one-hour token, revoked at job end and
scoped to one repository, against a credential bound to a person's account at the 90-day expiry
[#689](https://github.com/pdcarlson/Frapp/issues/689) specified. (That PAT was never created, so
this compares against a design, not against something that ran.) What makes it safe:

- **`pr-base-sync.yml` triggers only on `push` to `main`**, so it runs only on commits that already
  reached the default branch. A fork PR cannot trigger it, and untrusted code never executes in a
  job holding the App credentials.
- **No `pull_request_target` exists anywhere in `.github/`** — the trigger that would hand full
  secrets to a job running untrusted PR code.
- **No script-injection surface.** The workflow has exactly four `${{ }}` interpolations: three
  secrets and `steps.app-token.outputs.token`. None is event data, `run:` is a fixed command with
  no interpolation at all, and no workflow in this repo puts `github.event.*` inside a `run:`.
  Neither `pr-base-sync.mjs` nor `ci-wake.mjs` shells out (no `exec`, `spawn`, or `child_process`,
  transitively through their only imports); all network I/O is `fetch`, and the sole other host
  call is `readFileSync` on `GITHUB_EVENT_PATH`.
- **The token reaches exactly one API call in the whole repo**: `PUT /repos/{repo}/pulls/{n}/
  update-branch` (`updatePrBranch` in `scripts/ci/pr-base-sync.mjs`). Every other write in these
  watchdogs — wake comments, the alert issue — goes through the job's own `GITHUB_TOKEN`, not the
  App. So the credential's blast radius is "merge a PR's base into that PR's head"; **no code path
  writes to `main`**, and that is a property of the code, checkable by grepping for `updateToken`,
  rather than a property of live settings. Fork heads are skipped explicitly, and the token is
  scoped to this repository, so it could not push to a fork either way.
- Branch protection is a second layer, deliberately **not** the argument, because none of it is
  verifiable from a session. `scripts/configure-branch-protection.mjs` declares `enforce_admins:
  true` and `restrictions: null`, but: (a) that script only ever `PUT`s, never reads, so it is
  *intent*, and `docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md` records live `main` having
  drifted from it as recently as 2026-08-19; (b) `restrictions: null` means the push-restriction
  allowlist is **disabled**, which is not the same as "nothing can bypass"; and (c) `bypass_actors`
  live in repository **rulesets**, a layer nothing in this repo configures or inspects — a ruleset
  naming this App would defeat the claim and nothing here rules that out. Treat "the App cannot
  reach `main`" as resting on the bullet above, which is a property of the code.

The residual risk is the private key. One protection is GitHub not passing repository secrets to
fork-triggered `pull_request` runs; the other, weaker one is that adding a workflow that simply
echoes the key requires write access — which, per the paragraph below, requires no approval. **Four
changes would break the first, and none should ever be made:**

1. Adding a `pull_request_target` workflow that checks out PR-head code.
2. Adding a `workflow_run` workflow that carries the App key. `workflow_run` also runs base-repo
   code with secrets off a fork-PR-derived event; today `ci-wake.yml` uses it with no fork guard,
   which is safe only because it carries `GITHUB_TOKEN` and never the key (`deploy-api.yml` does
   guard, on `head_repository.full_name`).
3. Interpolating untrusted event data (a PR title, branch name, or comment body) into a `run:`
   block in any workflow that holds secrets.
4. Widening the App beyond `pdcarlson/Frapp` or beyond its two permissions.

One exposure this review does not eliminate: `pr-base-sync.yml` pins `actions/checkout@v4` and
`actions/create-github-app-token@v3` by **mutable major tag**, and the second is the action that
receives the private key. A compromised tag executes in exactly the job that holds it. Both are
`actions/*` and mutable tags are the convention across all eleven workflows here, so this is not a
deviation — but it is the shortest path to the key, and SHA-pinning at least the token minter is
the cheapest hardening available if that trade is ever revisited.

One pre-existing property this rests on: `main` requires **zero** approving reviews (only
`production` requires one — the PR review policy near the top of this file, and
`docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md`). So "only reviewed code runs with the App
token" is really "only code merged by someone with write access" — fine for a single-maintainer
repo, and the thing to revisit first if collaborators are ever added.

### Deploy visibility (`scripts/ci/deploy-alert.mjs`)

`Deploy API` failed **44 of 44 executing runs** between 2026-05-30 and 2026-08-08 and nobody
noticed for 71 days ([#763](https://github.com/pdcarlson/Frapp/issues/763); the credential defect
itself is [#696](https://github.com/pdcarlson/Frapp/issues/696)). Three things compounded, and the
first and third are what the `deploy-outcome` job fixes:

1. **A skipped run is a green run.** The `check-changes` path gate skips all four migrate/deploy
   jobs when a push touches neither `apps/api/`, `packages/validation/`,
   `packages/typescript-config/` nor `supabase/migrations/`. 46 of the last 90 runs were
   green-because-empty, so the Actions list read "mostly healthy" while the deploy path was
   100% dead.
2. **`workflow_run` failures land on no commit and no PR** the way `CI` does — nothing turns red
   anywhere a human normally looks. (Unfixed by design: this is how `workflow_run` works.)
3. **No notification of any kind.** A failed staging migration was indistinguishable from a quiet
   afternoon.

The terminal `deploy-outcome` job `needs` every prior job and runs `if: always()`, so it sees the
whole run's shape. Per run it does two things:

- **Says what happened.** A step summary and a `::notice::`/`::error::` annotation state plainly
  whether the run **deployed** something, **failed**, or **declined to deploy**, with a per-job
  result table — so a green run no longer requires opening four skipped jobs to learn it deployed
  nothing. `cancelled` and `timed_out` count as failures, not as benign.
- **Raises or clears one alert issue.** On failure it upserts a single tracking issue titled
  *"Deploy API is failing — pushes are not reaching the environment"* (`routine-state`, `area:ci`,
  `P1`): created if absent, reopened if closed, otherwise commented — never a fresh issue per
  failure, because alert spam is how alerting gets muted. A later **successful** deploy closes it
  as `completed`. So an open alert issue means "the deploy path is broken right now".

A **no-op run never closes an open alert** — skipping every job proves nothing about whether
deploys work, and no-op runs are the majority. `routine-state` is what keeps `/next` from claiming
the alert as backlog work (§0.2 treats that label as never-claimable).

Channel choice matches the two sibling watchdogs: GitHub itself, via a dependency-free `.mjs` on
`GITHUB_TOKEN` with an injectable `fetch`. `Deploy API` is push-driven with no PR to comment on,
so an issue is the equivalent of their PR comment — no new service and no new token. The job holds
the workflow's only write scope, job-scoped, leaving every other job on `contents: read`. Like the
other watchdogs it is best-effort and **exits 0 on every handled outcome**: the underlying deploy
job is already red, and a watchdog that reds the run creates the noise it exists to remove. If the
issues API is unreachable the summary and annotation still land.

### Schema drift detection (`scripts/ci/check-migration-drift.mjs`)

CI proves the code compiles and the tests pass. Until
[#833](https://github.com/pdcarlson/Frapp/issues/833) nothing verified that a **deployed database**
still matched `supabase/migrations/` — so a database could be dozens of migrations behind, or carry
migrations that exist nowhere in the repo, with every workflow green. Two modes, both observed for
real:

- **Behind.** `frapp-staging` held 2 rows in `schema_migrations` against 39 repo files (~5.5 months
  / 38 migrations). Public tables 29 vs 44, functions 1 vs 15, storage buckets 0 vs 7. Remediated
  2026-08-10. `frapp-prod` was measured in the same state on 2026-08-14 — 37 pending, remediation
  owned by [#832](https://github.com/pdcarlson/Frapp/issues/832).
- **Foreign.** The history carried `20260228000000_enable_rls_on_remaining_tables`, a version that
  has never existed in this repository (hand-applied in February). `supabase db push` refuses to
  run at all in that state, and the error's suggested fix (`migration repair --status reverted`) is
  destructive if applied without first reading what the row did — see
  [`../ops/DB_PROMOTION_RUNBOOK.md`](../ops/DB_PROMOTION_RUNBOOK.md) § reconciling a foreign
  migration row.

**Why scheduled and not post-deploy.** `Deploy API` failed 44 of 44 executing runs for 71 days
(#763). A check that only ran after a successful deploy would have been silent for exactly the
period it was needed — a dead pipeline must not be able to hide drift. The schedule is what would
have caught February.

**Classification.** `pending` (repo, not applied) · `foreign` (applied, not in repo) · `matched`.
Foreign rows are never graced: a version the repo has never contained is wrong the moment it
appears. Pending rows are tolerated for `PENDING_GRACE_HOURS` (default 24) measured from the
migration's **own 14-digit version timestamp**, which is the only "when was this authored" signal
available without a git or API round-trip — so a migration merged minutes ago is not an alert, and
a back-dated one alerts immediately (deliberately conservative: this check may cry wolf, it may not
stay silent).

**Three verdicts, and the reason there are three.** `drift` raises the alert; `clean` closes it;
`unknown` — a target the Management API could not be read — does **neither**. An API blip must not
close a live alert (that is how a real outage gets silenced) and must not open one either (nothing
was observed to be drifting). `unknown` still exits non-zero, so a check that cannot run is a red
run rather than a quiet pass. Along with `staging-conformance.mjs` it is one of the two watchdogs
in `scripts/ci/` that exit non-zero at all — both *are* the check, so green has to mean "it was
checked and it matched". The rest (`deploy-alert`, `ci-wake`, `pr-base-sync`) only annotate a run
that is already red, and deliberately exit 0 so a watchdog never adds noise of its own.

**Read-only by construction.** It calls the Management API's migration-history endpoint
(`GET /v1/projects/{ref}/database/migrations` — the stable endpoint, not the Beta `database/query`
ones) and sends no SQL, so it cannot mutate a database even if its logic is wrong. It reports drift
and never repairs it; reconciliation is a human, E2-class action.

Project refs are **not** committed — they come from Infisical (`SUPABASE_PROJECT_REF`, the same
source `run-migration.mjs` uses), which is why the job injects twice and captures each ref before
the second injection overwrites it. The Infisical slug for production is **`prod`**, not
`production`. Like the deploy alert, the tracking issue carries `routine-state` so `/next` §0.2
never claims it as backlog work.

### Scheduled conformance (`scripts/ci/staging-conformance.mjs`)

Deploy visibility above fixes *"a push failed and nobody noticed."* This fixes the other half:
**nobody pushed, and the environment rotted anyway.** Until this workflow, every verification in the
repo was push-triggered, so a quiet week and a healthy week produced identical evidence. The four
incidents that motivated it ([#838](https://github.com/pdcarlson/Frapp/issues/838)) all share that
shape:

- `frapp-staging` sat **38 migrations / ~5.5 months** behind with every workflow green.
- The Infisical credential was invalid for **71+ days** (#696/#763).
- Both Vercel staging secret syncs were pointed at a git branch named `preview` that has never
  existed in this repository, and failed on that for months with nothing reporting it. Read
  [`SECRETS_MANAGEMENT.md`](../environment/SECRETS_MANAGEMENT.md) §5 before drawing conclusions from
  that: it records "staging received nothing, so the breakage was accidentally protective" as a
  **misreading not to repeat** — `frapp-web` was read directly on 2026-08-12 and does hold the
  backend store — while also marking `frapp-landing` as *expected-but-unconfirmed*, since it was
  never inspected variable-by-variable. Neither "staging is empty" nor "both projects are
  confirmed full" is supported; confirm before relying on either.
- `custom_access_token_hook` was never enabled after #643 shipped, so `ChapterGuard` silently fell
  back to the client-supplied `x-chapter-id` header — the pre-#643 trust model (#805).

Runs daily at 07:00 UTC (`workflow_dispatch` for on-demand), asserting four properties of live
`frapp-staging`. Scope is **staging only**: `frapp-prod` is intentionally `INACTIVE` while production
is deferred, and alerting on that would be alerting on a decision (#814).

**Three outcomes, and the third is the point.** A check that cannot run must never look like a check
that passed:

| Outcome | Meaning | Effect |
| --- | --- | --- |
| `pass` | asserted against live staging, and it held | counts toward health |
| `fail` | asserted, and it did not hold | reds the run, raises the alert |
| `skipped` | could not assert (missing credential, or not yet built) | reported separately, **never** folded into the pass count |

Two rules follow from that, both about **not closing an alert on weak evidence**:

1. A run where *everything* skipped classifies as **`inconclusive`**, not healthy, and cannot close
   an open alert — a run that proved nothing is not evidence of recovery. Same rule the
   `deploy-alert` no-op draws, for the same reason.
2. Recovery is judged **per assertion, not by counting**. The alert body carries a visible
   `` `conformance-failing: <ids>` `` marker naming what it was raised for, refreshed on every
   raise, and the alert closes only when those exact assertions **PASS** again. Without this, an
   alert raised by `auth-hook` would close as "recovered" on a later run where `auth-hook` merely
   *skipped* — its credential deleted or renamed — and unrelated checks passed. Deleting a secret
   would resolve the alert. A run in that state reports **`unproven-recovery`**: green (nothing
   failed), but the alert stays open and the summary says why.

The marker is a visible backticked line rather than an HTML comment on purpose: #800 established
that HTML comments do not survive the GitHub MCP round-trip agents read issues through.

⚠️ **GitHub disables `schedule:` triggers after 60 days of repository inactivity**, emailing the
owner only. That ceiling is exactly backwards for this workflow — a long quiet stretch silently
turns off the thing that watches quiet stretches, and it is the only workflow here affected (every
other one is push- or `workflow_run`-triggered). If the repo goes dormant, re-enable it from the
Actions tab.

Two assertions ship degraded on purpose, each saying so in the step summary:

- **Migration parity is owned by `check-migration-drift.yml`, not by this workflow.**
  [#833](https://github.com/pdcarlson/Frapp/issues/833) was expected to land as a plain
  `npm run check:*` script this workflow would call. It landed as a **complete sibling
  watchdog** instead: its own daily schedule, its own `routine-state` alert issue, and coverage
  of production as well as staging. Calling its script from here would run the same comparison
  twice a day, let one real drift open two P1 alerts, and — because that script upserts and
  closes its own alert as a side effect — have this workflow mutating another watchdog's
  incident state. So the row is reported, not run: it shows as SKIPPED with a pointer, which
  asserts nothing and cannot close this workflow's alert. Deleting the row instead would have
  been worse; the table is meant to be a complete inventory of what is watched.
- **End-to-end sign-in** — the only row that exercises behaviour rather than configuration, covering
  migration, grants, RLS, and hook resolution in one probe — needs `STAGING_SMOKE_USER_EMAIL` /
  `STAGING_SMOKE_USER_PASSWORD`, which are not provisioned (#893). **The smoke user must have
  exactly one chapter membership:** a correctly-working hook returns a token with *no* claim when
  the user resolves to no chapter, so a zero-membership user is indistinguishable from a disabled
  hook. The check resolves that ambiguity in the safe direction — a claimless token is reported as
  **FAIL** naming both possible causes, never as a pass — so provisioning a zero-membership user
  produces a red run and a P1 blaming the hook on a healthy environment. Give it exactly one.

The Infisical injection step runs with `continue-on-error: true`, which is load-bearing rather than
lax: a revoked machine identity is the single most likely drift class, and failing the job at that
step would kill the run *before* the script could report it and raise the alert — a red run with no
issue, for the exact incident this workflow was built for.

Note what a green Infisical row does and does not mean. Its classification is three-way and closed
at both ends: any sync reporting `failed` is a FAIL; **every** sync reporting `succeeded` is a PASS;
anything else is SKIPPED. Infisical's status enum is `pending | running | succeeded | failed` plus
null before a sync has ever run — read from the open-source backend, **not observed against the live
API**, which is precisely why an unrecognised status skips rather than passes. The middle case cuts
both ways: calling "not succeeded" broken would open a P1 for a sync caught mid-window, while
calling it green would hide a sync wedged in `pending` because its destination token was revoked —
the #834 signature going undetected. A skip asserts nothing, reds nothing, and cannot close an open
alert, which is the honest answer to "we do not know yet."

Even a PASS does **not** assert the destinations hold the right values;
[`SECRETS_MANAGEMENT.md`](../environment/SECRETS_MANAGEMENT.md) records the hard-won rule that "a
sync that reports Failed today tells you nothing about what it delivered before it broke — check the
destination, not the sync status." An unrecognised Infisical response shape **fails closed**, because
reading an unparseable response as "no failing syncs" would rebuild the silent green.

The alert issue is titled *"Staging conformance is failing — frapp-staging has drifted"*
(`routine-state`, `area:ci`, `P1`) and follows the same upsert contract as the deploy alert: created
if absent, reopened if closed, otherwise commented, and closed on the next clean run. It shares
`scripts/ci/lib/alert-issue.mjs` with the deploy alert. (`check-migration-drift.mjs` landed
concurrently carrying its own copy of that upsert logic — consolidating it onto the shared lib is
tracked in [#909](https://github.com/pdcarlson/Frapp/issues/909), not done here, so this PR does not
rewrite a watchdog that merged hours ago.) Unlike the deploy watchdog this script **is** the check,
so a confirmed drift exits non-zero and reds the run.

### Applied permission allows

Originally applied by a human paste in PR #667 (2026-08-07): at the time, the Claude Code
auto-mode classifier was observed to hard-block an agent editing `.claude/settings.json`
(2026-08-06/07; later sessions' edits went through, so treat that behavior as build-dependent, not
settled). Self-granting permissions is a boundary user intent does not clear — permission-prompt
fatigue is fixed by a human merging the allowlist, never by the agent mid-session. What the list
carries and why:

> **The ceiling rule (working hypothesis) — check this before writing any permission fix.**
> `.claude/settings.json` `permissions.allow` appears to operate only *within* the cloud harness's
> `--allowed-tools` launch snapshot: an allow entry for a tool the harness did not launch with looks
> inert, making the harness grant a ceiling rather than a floor. **Check the snapshot before
> theorising** — one command, any session:
>
> ```sh
> tr '\0' '\n' < /proc/<claude-pid>/cmdline | grep -A1 '^--allowed-tools$' | tail -1 | tr ',' '\n'
> ```
>
> **Status: strongly supported, not proven — and deliberately labelled that way.** Supporting
> evidence (2026-08-08): `mcp__Claude_Code_Remote__send_later` is absent from the snapshot, was
> allowlisted under three spellings, and still prompts (owner-observed); every `mcp__github__*` call
> is covered by the snapshot's wildcard and ran prompt-free across a whole `/next` run
> (owner-observed). It is also retrodictive — it would explain all three failed Linear attempts
> (#667, #669, #676), whose common feature was adding allow entries for tools the snapshot omitted.
>
> **What it does not establish.** Two data points, one absent tool. The older theory — that these
> tools are independently flagged as requiring live user interaction — predicts the same
> observations and is **not excluded**. The clean falsifier: a tool that *is* in the snapshot,
> *is* allowlisted, and still prompts. If you meet one, this rule is wrong; say so here rather than
> hunting a harness bug. Either way the operational advice is unchanged and is the part that
> matters: **when a tool is absent from the snapshot, do not spend a PR on a settings fix** — that
> is the loop that cost #667, #669 and #676. The snapshot observation was already recorded below in
> the Linear post-mortem; no general rule was drawn from it, which is how three PRs were spent
> guessing. See [#744](https://github.com/pdcarlson/Frapp/issues/744).

- **The Linear era ended here (2026-08-08).** Three shipped attempts to stop Linear MCP permission
  prompts in cloud sessions — server-level allows (`mcp__Linear`/`mcp__linear`, PR #667),
  connector-UUID allows (PR #669), and a `PreToolUse` auto-allow hook (`linear-autoallow.sh`,
  PR #676) — all failed to verifiably stop the prompts, and each shipped with a verification claim
  an agent cannot actually make: **an agent cannot observe permission prompts** (an auto-approved
  call and a manually-approved call return identical results — only the human watching the session
  knows whether it prompted). Root cause was never established; the cloud harness's own
  `--allowed-tools` launch snapshot (readable live from `/proc/<pid>/cmdline`) omitted Linear's
  eight write tools while carrying the `mcp__github__*` wildcard, which is why GitHub Issues was
  viable as the replacement tracker. Rather than keep guessing, Linear was retired and work
  tracking moved to GitHub Issues — full decision record, probe table, and evidence policy in
  [#680](https://github.com/pdcarlson/Frapp/issues/680). The four Linear allow entries and the
  hook (plus its `mcp__.*__(save_.*|get_workspace)` PreToolUse wiring) were removed in the
  migration PR. Lesson that outlives the code: **never write a permission-behavior claim that
  isn't backed by the owner reporting what they saw.**
- GitHub MCP reads: `get_me`, `pull_request_read`, `list_pull_requests`, `search_pull_requests`,
  `actions_get`, `actions_list`, `get_job_logs`, `get_check_run`, `get_commit`, `list_commits`,
  `list_branches`, `get_file_contents`, `issue_read`, `list_issues`, `search_issues`, `get_label`,
  `list_issue_types`, `list_issue_fields` (each as `mcp__github__<tool>`).
- GitHub MCP tracker writes (added 2026-08-08 with the GitHub Issues migration, at the owner's
  request that agents "interact freely with GitHub issues"): `issue_write`, `sub_issue_write`.
  GitHub Issues is now the work tracker, so these are the same class of write Linear's `save_issue`
  was — on cloud sandboxes the harness `mcp__github__*` wildcard already covers them; these
  entries extend the grant to surfaces that honor project `permissions.allow`. Whether any given
  surface actually stops prompting is, as always, owner-observable only.
- GitHub MCP writes the babysit loop needs: `actions_run_trigger` (re-run infra-failed CI),
  `add_issue_comment`, `add_reply_to_pull_request_comment`, `resolve_review_thread`,
  `create_pull_request`, `update_pull_request`, `update_pull_request_branch`.
- **The `Claude_Code_Remote` trigger entries were removed from `permissions.allow`.** Twenty-one
  spellings (`send_later` / `create_trigger` / `update_trigger` / `delete_trigger` /
  `list_triggers` / `subscribe_pr_activity` / `unsubscribe_pr_activity` × server name, kebab-case,
  connector UUID) were inert on the cloud surface — `send_later` still prompted through all three
  (2026-08-08); the ceiling rule above is the likely why. They were misread as permission, so they
  came out. Do not re-add them to "allowlist" a tool the harness snapshot does not grant.
  `subscribe_pr_activity` that actually works is the **GitHub MCP** spelling, which stays listed.
  If the harness ever adds the trigger family to `--allowed-tools`, that is a new ADR, not a
  reason to restore dead allow-lines.
- Deliberately **excluded from the project allows**: `merge_pull_request`, `enable_pr_auto_merge`,
  `push_files`, `create_or_update_file`, `delete_file` — merging and direct repo-content writes
  are not repo-sanctioned, per the PAT policy above. **Know the limit of that exclusion:** on
  cloud sandboxes the harness's own `--allowed-tools` carries the `mcp__github__*` wildcard
  (agent-observed, 2026-08-08), which by its shape covers these five tools too — so on that
  surface the human merge gate is **policy, not an enforced prompt**. No one has verified whether
  these five prompt anywhere (only the owner can observe prompts). Agents must treat the
  exclusion as a standing instruction — never call them without explicit human direction —
  rather than trusting a prompt to stop the call.
- Permission allow-lines are exact string matches. An unmatched spelling is silently inert.
  Adding a spelling is only worth doing for a tool the harness `--allowed-tools` snapshot
  actually carries (the ceiling rule). The trigger family is absent from that snapshot, so
  no spelling of `send_later` belongs in `permissions.allow`.

Also verified: an "always allow" click in one session/surface does not propagate to fresh cloud
containers — only rules committed to `.claude/settings.json` travel with the repo, and even those
are bounded by the ceiling rule above.

The in-session trigger family (`send_later` / `create_trigger` / `list_triggers` …) is a
**dead end for unattended use on the cloud surface — do not chase it.** Not an account-side
Routines gate (disproven 2026-08-08: the owner's Routines page was healthy and scheduled Routines
fired normally) and not a permissions-file miss (three spellings were allowlisted, and the family is
absent from the harness `--allowed-tools` snapshot — see the ceiling rule above).

**Symptoms differ per tool; record what you actually saw.** `send_later`, 2026-08-08: prompted the
owner, and **on approval succeeded**, returning a live trigger id — so for this tool the earlier
"`-32003` dead-end" and "approval is converted to a denial" descriptions no longer hold. That is
still disqualifying for unattended runs, but for a different reason: it stops and waits for a human.
The earlier `-32003` reports for `create_trigger` and the read-only `list_triggers` were **not**
re-tested in that session and stand as last observed — do not assume `send_later`'s newer behavior
generalises to them, in either direction.

## Agent dev stack (cloud sessions)

Decision is recorded in [**ADR-12** (`spec/architecture/README.md`)](../../../spec/architecture/README.md) (extending ADR-11): PGlite-backed NestJS tests are the **default substrate** (Paths C+D), a per-session Supabase branch is the **opt-in escape hatch** (Path A), and a rootless in-sandbox stack (Path B) is rejected. Track program-level state in **GitHub Issues** (the agent-infrastructure epic and its sub-issues). This section is the operating doc — what's in the stack today, how to bring it up, what's still blocked.

### What the stack is

Two layers, both runnable from a sandbox with no Docker and no privileged tooling:

1. **Hot-path code is testable in NestJS.** Per ADR-11, chat hot-path writes (`chat-send`, `chat-react`) live in the existing `apps/api` NestJS service alongside cold reads and the in-process push worker (ADR-09). Standard Jest + supertest covers integration; the `SupabaseAuthGuard` and `SUPABASE_CLIENT` provider that the push worker already uses are reused for auth and Realtime emit. Since #416 shipped, `supabase/functions/chat-*` is retired and chat-adjacent chunks no longer carry the "Runtime checks BLOCKED" disclaimer.
2. **Migration validation + RLS smoke run on PGlite.** `scripts/check-pglite-migrations.mjs` applies every `supabase/migrations/*.sql` to a fresh in-process Postgres-in-WASM and asserts the schema landmarks reviewers care about, plus an **RLS smoke tier** (ADR-12): every `public` table enables RLS (Frapp's default-deny invariant, #360), the chat hot-path tables hold their posture (`chat_channels`/`chat_messages` default-deny with no policies; `chat_message_actions` reaction policies stay scoped to `auth.uid()`), and `chapter_audit_log` stays append-only. It verifies policy *presence and shape*, not enforcement as the `authenticated` role — that (`SET ROLE` + real JWT) is tracked in #423 and the NestJS Jest tier. Always-on, runs in CI as `pglite-migrations`, and runs identically from any cloud-agent sandbox. No real DB required.

### How to bring it up at session start

Nothing to provision. Both layers run from the repo as plain `npm` scripts:

```bash
# Run the API test suite, including chat-related tests
npm run test -w apps/api

# Run the PGlite migration validator
npm run check:pglite-migrations
```

The agent does not need `SUPABASE_URL` / `SUPABASE_ANON_KEY` / service-role keys to run any of these. The PGlite harness instantiates Postgres directly in-process; the NestJS tests use the existing Jest mocks.

### When you need a real Supabase

For end-to-end verification that touches Realtime, Presence, push fanout, or RLS as GoTrue enforces it, the agent still depends on the hosted `frapp-staging` project. **This requires the Supabase MCP write tools (`create_branch`, `apply_migration`) to be allowed in the session's `.claude/settings.json` permissions.** They are not allowlisted by default — the committed file has never carried a deny rule; the enforcement is the permission prompt, which unattended sessions cannot approve. See the [#411 spike comment](https://github.com/pdcarlson/Frapp/issues/411#issuecomment-4559934654) for the failure mode if you call them without that change.

Per **ADR-12** this is the **sanctioned opt-in escape hatch** (not a hypothetical). It is off by default: a session must explicitly opt in and acknowledge cost. When opted in, a SessionStart hook would:

1. Confirm cost via `mcp__f9f5eb7a-…__get_cost` / `confirm_cost`.
2. `create_branch` against the staging project (one branch per session, never shared).
3. Apply every migration in chronological order via `apply_migration`.
4. Write `SUPABASE_URL` / `SUPABASE_ANON_KEY` / a scoped, short-lived service-role JWT to `apps/*/.env.local`. Never commit — it is gitignored (`.gitignore` + `apps/web/.gitignore`), and the backstop is the pre-commit **gitleaks** scan (`.githooks/pre-commit` → `scripts/scan-secrets.mjs`, default ruleset per `.gitleaks.toml`), whose `jwt` rule has fired on real JWT material in this repo's history ([`SECRET_SCANNING.md`](SECRET_SCANNING.md)). There is no `*.supabase.co` rule — a project URL is not secret material, so do not rely on one catching a pasted config.
5. SessionEnd hook calls `delete_branch` (idempotent) and confirms via `list_branches`.

This hook does not exist yet — the SessionEnd teardown + scoped MCP write allowlist are tracked as **#532**. Until it lands, the MCP write tools stay un-allowlisted in `.claude/settings.json` (they prompt, so headless sessions can't use them) and the branch path is unavailable; do not work around it in a chunk PR. (Note: post-#416 there are no Edge Functions in this repo, so `deploy_edge_function` is not part of the bring-up.)

### "Runtime checks BLOCKED" protocol

The disclaimer ADR-11 was written against (chat-adjacent chunks gated on a live Supabase Edge Functions runtime) **retired with #416**. The hot path is now NestJS code that runs in the same Jest tier as the rest of the API, and migrations validate via PGlite — both run in any sandbox.

**If** the environment's network allowlist carries the **live staging egress** lines, the remaining reach is narrower than this section assumes: live Realtime / Presence and RLS-as-enforced-by-GoTrue can be exercised against hosted `frapp-staging` from a sandbox, provided the environment carries those lines *and* a staging smoke credential is available — which today it is not, per the open human-action ask in #893, so budget an authenticated check as blocked until that lands. Check `.cloud-sandbox-capabilities.json` first (written by `scripts/cloud-sandbox-egress-probe.sh` in the first seconds of bringup) rather than probing by hand — and read [`.claude/skills/live-verification/SKILL.md`](../../../.claude/skills/live-verification/SKILL.md) before touching the deployed environment. Push fanout is not one case but two: **APNS is unreachable** (`api.push.apple.com` fails the policy check; no Apple host is proposed for the allowlist), while **`fcm.googleapis.com` is already reachable** through the default Trusted entry `*.googleapis.com`. Reachable transport is not a runnable test — delivery still needs service-account credentials and a real device token — so end-to-end push stays blocked, but do not report FCM as network-blocked when it is not.

If a chunk crosses a boundary the sandbox still can't reach (push fanout; anything needing production; anything needing Realtime/GoTrue where the egress or the credential is in fact absent):

- **Do not check the verification box.** Mark it blocked.
- File or link a tracking issue (`#401` is the agent infra parent; #235 closed-as-subsumed by ADR-11 and should not be reopened — file a fresh issue scoped to the new gap).
- In the chunk PR body, list each blocked step + the linked issue + which class of verification is missing.
- Record the same on the tracking issue — work status lives in **GitHub Issues**, not in a
  status doc ([`../DOCUMENTATION_CONVENTIONS.md`](../DOCUMENTATION_CONVENTIONS.md) rule 4,
  [`GITHUB_PM.md`](GITHUB_PM.md)).

### Sandbox-blocked tooling — known list

- **Docker / `supabase start` / `supabase db reset`:** the daemon is not started by default. In a **Claude Code web sandbox configured per [`CLOUD_SANDBOX.md`](../environment/CLOUD_SANDBOX.md)** (setup script + Full/Custom network), `scripts/cloud-sandbox-up.sh` brings up Docker + local Supabase and writes `apps/api/.env.local` plus `apps/web/.env.local`, so the full stack and `npm run start:dev -w apps/api` work with no Infisical, and `npm run build -w apps/web` prerenders instead of dying on the missing `NEXT_PUBLIC_SUPABASE_*` vars (#1156). Where that wiring is absent (unconfigured env, plain CI), there is still no daemon: use the PGlite harness for migration validation.
- **Supabase MCP write tools (`create_branch`, `apply_migration`, `delete_branch`) and most read tools (`list_branches`, `get_project`, `get_cost`):** not granted by `.claude/settings.json` (its allow rules cover only the Workflow tool and the claude-code-remote scheduling and PR-watch tools — no Supabase entries), so they prompt — and unattended sandboxes cannot approve the prompt. `list_projects` has been observed to go through. Do not assume any MCP tool works until you've tried it.
- **Outbound HTTP to arbitrary hosts:** governed by the sandbox's network policy. Through the agent proxy the failure shape is `curl: (56) CONNECT tunnel failed, response 403`; `curl -sS "$HTTPS_PROXY/__agentproxy/status"` names the refused host under `recentRelayFailures`. Note `supabase start` pulls images from **AWS ECR Public** (`public.ecr.aws`) + **CloudFront** (`*.cloudfront.net`), which the **Trusted** policy does not reliably allow — add those hosts to a Custom allowlist. **Deployed staging** (`staging.frapp.live`, `*.staging.frapp.live`, `api-staging.frapp.live`, and the `frapp-staging` Supabase ref) is reachable *if and only if* the environment carries those lines. **Do not probe by hand and do not assume — read `.cloud-sandbox-capabilities.json`,** which `scripts/cloud-sandbox-egress-probe.sh` writes at the repo root within seconds of bringup starting, long before its `.done` sentinel. The SessionStart hook summarises it too, but only on a fire that finds it already written — never on a fresh container's first session, nor on any fire that starts a bringup — so read the file rather than waiting for the line. Its `warnings` array distinguishes *blocked* from *inconclusive*, which a hand-rolled `curl` will not. See [Live staging egress](../environment/CLOUD_SANDBOX.md#live-staging-egress) and [`.claude/skills/live-verification/SKILL.md`](../../../.claude/skills/live-verification/SKILL.md). **Production is never allowlisted** — the probe asserts that negatively, and a reachable prod host is reported as a SECURITY warning rather than as extra capability. Provider APIs (Render, Vercel, Infisical, Sentry, PostHog) stay blocked to direct `fetch` and are reached via **MCP**, which bypasses the allowlist entirely.
- **System packages requiring `apt-get` / root:** unavailable. The PGlite WASM bundle is npm-installable and needs none.

When you hit a new block, add it here in the same PR you discovered it in.
