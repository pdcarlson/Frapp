# Quality gates

The four gates added in Wave 0 Phase 1, the Vercel-parity build gate added with #1371, plus the coverage tooling they sit alongside. Branch
protection and the docs/spec gate are documented separately, in
[`GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md) and
[`DOCS_CI.md`](DOCS_CI.md).

## The gates, and why each has the posture it does

**Posture is the load-bearing decision, not an afterthought.** A gate that is hard before its
backlog is grandfathered turns a required check red on every PR, and the reflex — mark it advisory
"for now" — is how a gate ends up enforcing nothing forever. Each gate below is as strict as its
baseline story actually supports.

| Gate | Command | CI job | Posture | Why that posture |
|---|---|---|---|---|
| dependency-cruiser | `npm run check:dep-cruiser` | `dependency-cruiser` | **Required** | Has a real baseline; 5 existing violations grandfathered (7 when it landed), new ones fail |
| oasdiff breaking changes | `npm run check:api-breaking` | step in `api-contract-check` | **Advisory** | Every consumer is in this repo and ships with the change |
| `nestjs-typed` response schema | `npm run lint -w apps/api` | step in `lint-and-typecheck` | **`warn`** | 142 findings and no ESLint baseline mechanism |
| jscpd duplication | `npm run check:duplication` | `duplicate-detection` | **Advisory** | No clone-level baseline exists; a repo-wide % is too coarse to block on |
| 375px responsive floor | `npm run test:floor -w apps/web` | `web-responsive-floor` | **Required** | No baseline at all — it reads one integer per route. Nothing to grandfather and nothing to drift |
| Vercel-parity production build | `npm ci --omit=dev` + `turbo run build --filter=web --filter=landing` | `web-production-build` | **Required** | Nothing to grandfather: the build either succeeds on a pruned tree or it does not, and it was already succeeding when the job landed. Advisory was never on the table — the two failures it catches (#1331, #1372) both reached production precisely because nothing blocked on them |

**The dashboard visual snapshot gate used to sit in this table and is gone.** `web-visual-regression`
shot each dashboard route at 1440×960 and compared it to one of sixteen committed PNGs. It was
**advisory**, because baselines
pinned to CI's Chromium build drift with it and are only regenerable on a matching machine. That
posture was honest about the tooling and is also the argument for deletion: a gate that cannot block,
and whose red X is normally answered by regenerating the fixture rather than fixing the page, taxes
every UI change without measuring one. The job, the spec, the baselines, and the `test:visual` script
were removed together. Pixel coverage, if it returns, belongs in a hosted service with per-PR
baseline review (Percy, Chromatic, Argos), not in the repo.

The floor gate is what survived, and its posture is the reason. Posture follows the **baseline
story**, not the tooling: both suites ran Playwright against the same dev server, but one compared
stored pixels and one compares a number. Until #1152 they shared a job, so the floor gate inherited
the snapshot gate's exemption and could not block.

Two things keep the required gate from passing vacuously, and both are load-bearing. `forbidOnly` is
set under `CI`, so a committed `test.only` cannot narrow the gate to one route while still exiting 0.
And Playwright exits **1** when a run collects no tests, so an emptied suite reddens the job rather
than silently asserting nothing. That was verified by running it, not assumed — against the 1.62.1
`npm ci` resolves today; `apps/web/package.json` asks for `^1.62.1`, so re-check on any upgrade that
moves the lockfile.

**That second guard narrowed when the snapshot suite went away, and the narrowing is the thing to
know.** `test:floor` now runs the whole `apps/web/tests/visual/` directory instead of `--grep @floor`.
Directory selection is the safer default for *adding* a spec — a new one joins the required job rather
than falling into no job at all, which is why a `--grep` filter must not come back without a second
job catching what it excludes. But it keys on the collected-test count, where the tag version fired
whenever the floor suite specifically went missing. Deleting today's only spec still reddens the job.
What stops being caught is the two-spec case: add a second spec, then delete or rename the floor spec,
and the run passes on the survivor while the floor goes unmeasured. Adding a second spec to that
directory means taking that on deliberately.

---

## dependency-cruiser — architectural boundaries

Enforces two things the codebase already asserted in prose and nothing checked:

- **The API's layer direction.** Interface → Application → Infrastructure → Domain; outer may import
  inner, never the reverse ([`api-development` skill](../../../.claude/skills/api-development/SKILL.md)).
  One rule per illegal edge, so a failure names the boundary that broke.
- **Monorepo separation.** A package must not import an app; apps share code through `packages/`,
  never directly.

Plus `no-circular`, `not-to-dev-dep`, `not-to-unresolvable`, and `no-deprecated-core`.

### `exclude` vs `doNotFollow` — the setting that silently disarms this gate

`node_modules` belongs in **`doNotFollow` only**, never in `exclude`. They are not interchangeable:
`exclude` drops the module *and every edge pointing at it*, while `doNotFollow` keeps the edge and
merely stops traversal. With `node_modules` excluded, the graph contained no `npm-dev` dependency
type at all and **zero** cross-workspace modules — so `not-to-dev-dep`, `packages-not-to-apps` and
`no-cross-app-imports` could never fire. Three of the rules were structurally inert while the gate
reported a confident green.

Nothing about the output reveals this: the violation count is *lower*, which reads as good news. If
you change either option, re-verify by introducing a deliberate violation per rule and watching it
fail — that is how this was caught, and each of the four rule families has been confirmed to fire.

### The baseline

`.dependency-cruiser-known-violations.json` holds the violations that existed when the gate landed —
7 then, 5 since #1549 re-recorded it after #1539 had moved
`apps/api/src/domain/constants/report-columns.ts` out of the interface layer without shrinking it
(all `api-application-not-to-interface` — services importing
DTOs from the interface layer). They are
grandfathered; anything new fails. **The baseline exists to shrink.** Re-record only after *fixing*
violations:

```sh
npm run check:dep-cruiser -- --update-baseline
```

Entries that no longer match are reported on every run as a nudge to shrink the file. That report is
never a failure — failing someone for having fixed a violation would be precisely backwards.

An entry is keyed on `rule + from + to`, deliberately **not** on line numbers: a line-keyed baseline
churns on every unrelated edit above an import, which is how a grandfather file rots into noise
nobody re-records.

### Why it runs once per workspace

`apps/web` and `apps/mobile` each map `@/*` to their **own** root, so no single alias table can
resolve both — and a tsconfig's `include` globs resolve against the **cwd**, not the tsconfig, so
`depcruise --ts-config apps/web/tsconfig.json` from the repo root fails outright with `TS18003`. The
only correct resolution is one run per workspace with that workspace as cwd, which is what
[`scripts/check-dep-cruiser.mjs`](../../../scripts/check-dep-cruiser.mjs) does.

**This is worth knowing because getting it wrong is silent, not loud.** Cruising everything from the
repo root "works" and reports **806 violations, 792 of them `not-to-unresolvable`** — purely `@/*`
failing to resolve, reproducible with `DEPCRUISE_WORKSPACE=apps/web npx depcruise . --config
.dependency-cruiser.cjs`. Baselining that run would have grandfathered 792 phantoms and left every
real rule asleep underneath them. Resolved per workspace, the true total is **7**.

Two consequences follow, and both are easy to trip over when editing
[`.dependency-cruiser.cjs`](../../../.dependency-cruiser.cjs):

- **Every path in the config is workspace-relative.** A root-anchored `^apps/api/src/…` silently
  matches nothing. Rules that only apply to one workspace are selected with `DEPCRUISE_WORKSPACE`
  rather than by path.
- **Each workspace answers only for its own files.** depcruise follows imports into `packages/*`, so
  cruising `apps/web` also evaluates rules against `packages/hooks`. The runner drops violations
  whose `from` lies outside the current workspace — otherwise one violation is reported once per
  consuming app. Nothing is lost: every workspace gets its own cruise.

### Pinned to 17.x — check `engines` before bumping

CI runs **Node 20**. dependency-cruiser **18.x** raised its floor to `^22||^24||>=26`, so it fails
there with `ERROR: Your node version (20.20.2) is not supported`. 17.4.3 accepts
`^20.12||^22||>=24`, which covers CI and a typical dev machine both.

**This one does not reproduce locally**, which is what makes it worth writing down: 18.x installs and
runs perfectly on a modern Node and only fails on the runner. Before bumping the major, compare its
`engines` against `node-version:` in [`ci.yml`](../../../.github/workflows/ci.yml) — or bump CI's
Node first, which is a separate decision with its own constraints (`apps/api` pins Node 20
deliberately; see the WebSocket note in `apps/api/src/infrastructure/supabase/supabase.provider.ts`).

`expo-server-sdk` 7.x is the same class of engines mismatch, with a different symptom. 6.0.0
went ESM-only; 7.0.0 raised `engines.node` to `>=22.12.0` (stable `require(esm)`). npm does not
fail `npm ci` on that (unlike undici 8.x, which is `EBADENGINE`-hard in
[`SECURITY_FIXES.md`](../security/SECURITY_FIXES.md)), so `api-docker-build` stays green on
`node:20-alpine`. Jest's CommonJS E2E runtime cannot parse the ESM entry, which is what turns
`api-tests` red — the stub in [`docs/guides/testing.md`](../../guides/testing.md) §6. Do not treat
a green Docker build as proof the major is Node-20-safe; lift Docker + CI Node together if a
future 7.x actually needs 22.12 APIs.

### Why the baseline is ours rather than `--ignore-known`

depcruise's native `--ignore-known` matches the paths a run reports, which here are
workspace-relative — so `src/index.ts` is ambiguous across 17 workspaces and one shared file cannot
express which it meant. Paths are normalised to repo-root-relative and matched in the runner instead,
which keeps one greppable baseline and makes the matching unit-testable
([`check-dep-cruiser.test.mjs`](../../../scripts/ci/__tests__/check-dep-cruiser.test.mjs)). The
rollout posture is exactly the one `--ignore-known` exists for.

---

## oasdiff — breaking API changes

### This is not an SDK-drift check, because that already existed

Worth stating plainly, because it is the kind of thing a plan assumes and nobody re-checks: a
"regenerate the SDK and `git diff --exit-code`" gate would have been **entirely redundant**.
[`check-api-contract-drift.mjs`](../../../scripts/check-api-contract-drift.mjs) already regenerates
**both** `apps/api/openapi.json` and `packages/api-sdk/src/types.ts` and fails on any diff, and
`api-contract-check` is **already a required check**. It replaced an older
did-you-touch-both-files heuristic some time ago.

What was missing is not drift but **compatibility**. Deleting an endpoint, removing a response field,
or making an optional parameter required all regenerate perfectly cleanly, pass the freshness check,
and break every existing client. That is the gap `oasdiff breaking` fills.

### Why advisory

Every consumer of this API — `apps/web`, `apps/mobile` — lives in this repo and regenerates from the
same commit, so a breaking change ships atomically with the clients that adapt to it. The project is
also mid-rebuild (Frapp → Signet), where removing endpoints is the intended work rather than an
accident. A hard gate would fire constantly on correct changes and need an escape hatch immediately.

It annotates the run (`::warning::`) so a finding is visible in the Checks UI rather than buried in a
green log. **Trigger to revisit:** an external or independently deployed consumer appears → switch to
`--fail-on-breaking`, which is already implemented.

### The gap this also closed

`isApiRelated` decided whether the contract check regenerated at all, and only fired for
`apps/api/src/`, `apps/api/openapi.json`, and `packages/api-sdk/`. Two categories could change the
generated output with nothing under `apps/api/src/` touched:

- **The generators themselves** — `openapi.json` comes from `@nestjs/swagger`, `types.ts` from
  `openapi-typescript`. A Dependabot bump touches only the manifests, so the check skipped the regen
  and a stale artifact merged.
- **Shared packages the API imports** — a value from `@repo/validation` and friends can reach a DTO
  decorator and therefore the emitted schema.

Both now trigger a regen.

### oasdiff is a pinned binary

Not an npm package (the `oasdiff` name on npm is a security placeholder).
[`scripts/install-oasdiff.sh`](../../../scripts/install-oasdiff.sh) fetches a pinned release into
`.cache/oasdiff/`, following the same reasoning as
[gitleaks](SECRET_SCANNING.md): local and CI run the identical version, and no third-party GitHub
Action enters the supply chain. It verifies the published SHA-256 checksum, retries transient
failures, and moves the binary into place only once complete.

Two details that are easy to get wrong:

- **macOS uses the `darwin_all` asset.** oasdiff publishes one universal Darwin binary, so deriving
  the asset name from the architecture produces a 404 on every Mac while Linux CI stays green.
- **`oasdiff breaking` exits 0 even when it reports breaking changes.** `--fail-on ERR` is what makes
  the exit status mean anything; without it a caller keying off exit status detects nothing, and one
  keying off "is stdout non-empty" cannot tell a WARN-level note from a real break.

### CI availability

Both oasdiff steps live in the **required** `api-contract-check` job and both carry
`continue-on-error: true`. That is deliberate: they fetch a binary from the GitHub releases CDN at
run time, and without it a rate limit or a 5xx would turn an advisory signal into a merge block on
every PR.

---

## nestjs-typed — the response-schema rule

`nestjs-typed/api-method-should-specify-api-response`, scoped to `src/**/*.controller.ts` in
[`apps/api/eslint.config.mjs`](../../../apps/api/eslint.config.mjs). A route with no declared
response generates `content?: never` in the SDK, so callers get no types for the body and the
contract silently claims the route returns nothing.

**Set to `warn`, and it must stay that way until the Wave 2 route-DTO backfill lands.** The rule
fires once per undecorated controller method and there are **142** today — measured, not estimated;
the planning docs guessed ~30, which is out by roughly 5x and is exactly the figure someone would use
to conclude the backfill was finished. ESLint has no native baseline mechanism, and `lint` is a
required check, so `error` now would mean red on every PR until all 142 are done. Warnings do not
fail ESLint, so `npm run lint` stays green and the backlog stays visible.

Only that one rule is enabled. The plugin's bundled `flatRecommended` preset turns on 20+ rules at
once, which is a separate and much larger decision.

**When the backfill clears:** flip to `error`, and delete the rollout paragraph in the config.

---

## jscpd — duplicate detection

Config: [`.jscpd.json`](../../../.jscpd.json). Report written to `.jscpd/` (gitignored) and uploaded
as a CI artifact.

**jscpd has no clone-level baseline**, unlike dependency-cruiser — there is no ignore-known file and
no way to grandfather individual clones. The only lever is a repo-wide duplication **percentage**
that fails when exceeded. So the ratchet is:

- Measured when this landed: **4.37%** duplicated lines (556 clones across 845 files).
- Threshold: **4.5%**, just above it.
- **The threshold only ever moves down.** Lower it as each consolidation lands; never raise it to
  make a red run green.

That mechanism is why this gate is advisory. A repo-wide percentage cannot distinguish one bad
copy-paste from ordinary drift, which is too coarse to block a merge on.

**Advisory here means the job is allowed to go red**, not that it is silenced. `duplicate-detection`
is deliberately absent from `CI_CHECKS`, so a failure reports loudly and blocks nothing —
`pglite-migrations` is advisory the same way. (`web-visual-regression` was a third, and was deleted
rather than kept red.) It must **not** carry `continue-on-error`: that key rewrites the
step's conclusion to success, so the job goes green and a breached threshold becomes invisible. An
advisory gate nobody can see is not advisory, it is off.

Locally, `npx jscpd --config .jscpd.json --reporters consoleFull` prints every clone; the CI job uses
the summary table plus the JSON artifact.

---

## Coverage

Both were broken; neither could measure anything.

### The minimatch / test-exclude collision (`apps/api`)

Real, and worth understanding before touching the root `overrides` block. The root override
`"minimatch": "^10.2.3"` (added to close audit findings) forces minimatch 10 into `test-exclude@6.0.0`,
which declares `minimatch@^3.0.4` and calls `require('minimatch')` **as a function**. minimatch 10
exports an object, so every instrumented suite died with `TypeError: minimatch is not a function`.

**Fix:** `coverageProvider: "v8"` in the API's Jest config, which takes `babel-plugin-istanbul`,
`test-exclude` and `minimatch` out of the coverage path entirely.

Resolving it through the dependency graph instead was attempted and rejected. A nested
`"test-exclude": { "minimatch": "^3.1.2" }` override and an outright `"test-exclude": "^8.0.0"` bump
both work in a clean project, but **npm will not apply a new override to a transitive-only package
without a full lockfile regeneration** — it treats the existing lockfile as authoritative, and
`--package-lock-only` produces no diff. Regenerating a 1M-line lockfile to fix a test-only tool is an
unreviewable diff and a much larger blast radius than the problem.

v8 is also what `@vitest/coverage-v8` uses, so both runners now report through one coverage engine.

### The missing Vitest provider

No workspace declared `@vitest/coverage-v8`, so `vitest run --coverage` failed with
`MISSING DEPENDENCY`. It is now a root devDependency, pinned **exact** at `4.1.11` because Vitest
declares it as an exact peer — the pin moves with every `vitest` bump.

### Running it

```sh
npm run test:cov              # every workspace, via turbo
npm run test:cov -w apps/api  # Jest + v8
npm run test:cov -w packages/hooks
```

There is **no coverage threshold and no coverage gate.** Coverage is a measurement here, not a
target — the point is to be able to see the refactor's real impact. Adding a threshold is a separate
decision.

### The spec's "minimum 80%" claim, resolved (#321)

`spec/architecture/README.md` used to state a flat "Minimum 80% line coverage for API modules" with
nothing in CI enforcing it. Measured 2026-09-01 on `main` with `npm run test:cov -w apps/api`
(`coverageProvider: "v8"`, `collectCoverageFrom: ["**/*.(t|j)s"]` — every file, including
zero-logic `*.module.ts` DI wiring): **80.05% lines**, 2506 tests across 136 suites. Excluding the 35
`*.module.ts` files (1,141 lines, each legitimately 0% since they carry no branches) raises it to
82.25% lines, but function coverage stays under 80% (79.80%) either way.

**Decision: keep coverage a measurement, not a gate — the spec was amended instead of adding a
threshold.** Two reasons, not one:

1. **No margin.** 80.05% against an 80% floor is not "meets the bar," it is "one refactor away from
   a red build with no code defect behind it." A threshold that thin fails on noise, not
   regressions — the exact "a check nobody can satisfy teaches people to route around it" failure
   the `migration-drift` demotion (ADR-20) exists to avoid elsewhere in this repo.
2. **No settled definition of the denominator.** `*.module.ts` wiring files are ~9% of tracked lines
   and always read 0% — they are not undertested code, they are DI glue with no branches to test.
   Whether they belong in the ratio at all is an unmade call, and picking one silently inside this
   fix would bake in an unreviewed answer to a question nobody was asked.

If a future PR wants to gate this, the honest path is: settle the denominator question first (most
likely `collectCoverageFrom` excluding `*.module.ts`/`main.ts`), then set the floor a few points
**below** the resulting measurement so it has room to absorb normal variance, and only ever raise it
— never lower it to make a red run green, same rule as the jscpd ratchet above.

`coverage/**` is ignored by the shared ESLint config
([`packages/eslint-config/base.js`](../../../packages/eslint-config/base.js)), and that line is
load-bearing rather than tidiness: istanbul's HTML report assets carry an `/* eslint-disable */`
header that suppresses nothing under the `react-internal` preset, so ESLint flags it as an unused
directive — a warning, which `--max-warnings 0` turns into a failure. Without the ignore, running
`npm run test:cov` in a workspace permanently breaks `npm run lint` there, pointing at a gitignored
file `git status` never shows.

---
