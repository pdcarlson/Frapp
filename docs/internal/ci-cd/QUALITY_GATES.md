# Quality gates

The four gates added in Wave 0 Phase 1, plus the coverage tooling they sit alongside. Branch
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
| dependency-cruiser | `npm run check:dep-cruiser` | `dependency-cruiser` | **Required** | Has a real baseline; 7 existing violations grandfathered, new ones fail |
| oasdiff breaking changes | `npm run check:api-breaking` | step in `api-contract-check` | **Advisory** | Every consumer is in this repo and ships with the change |
| `nestjs-typed` response schema | `npm run lint -w apps/api` | step in `lint-and-typecheck` | **`warn`** | 142 findings and no ESLint baseline mechanism |
| jscpd duplication | `npm run check:duplication` | `duplicate-detection` | **Advisory** | No clone-level baseline exists; a repo-wide % is too coarse to block on |

---

## dependency-cruiser — architectural boundaries

Enforces two things the codebase already asserted in prose and nothing checked:

- **The API's layer direction.** Interface → Application → Infrastructure → Domain; outer may import
  inner, never the reverse ([`api-development` skill](../../../.claude/skills/api-development/SKILL.md)).
  One rule per illegal edge, so a failure names the boundary that broke.
- **Monorepo separation.** A package must not import an app; apps share code through `packages/`,
  never directly.

Plus `no-circular`, `not-to-dev-dep`, and `no-deprecated-core`.

### The baseline

`.dependency-cruiser-known-violations.json` holds the 7 violations that existed when the gate landed
(all `api-application-not-to-interface` — services importing DTOs from the interface layer). They are
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
repo root "works" and reports **792 unresolvable-module violations** that are purely `@/*` failing to
resolve. Baselining that run would have grandfathered 792 phantoms and left every real rule asleep
underneath them. Resolved properly, `apps/web` cruises completely clean.

Two consequences follow, and both are easy to trip over when editing
[`.dependency-cruiser.cjs`](../../../.dependency-cruiser.cjs):

- **Every path in the config is workspace-relative.** A root-anchored `^apps/api/src/…` silently
  matches nothing. Rules that only apply to one workspace are selected with `DEPCRUISE_WORKSPACE`
  rather than by path.
- **Each workspace answers only for its own files.** depcruise follows imports into `packages/*`, so
  cruising `apps/web` also evaluates rules against `packages/hooks`. The runner drops violations
  whose `from` lies outside the current workspace — otherwise one violation is reported once per
  consuming app. Nothing is lost: every workspace gets its own cruise.

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
Action enters the supply chain.

---

## nestjs-typed — the response-schema rule

`nestjs-typed/api-method-should-specify-api-response`, scoped to `src/**/*.controller.ts` in
[`apps/api/eslint.config.mjs`](../../../apps/api/eslint.config.mjs). A route with no declared
response generates `content?: never` in the SDK, so callers get no types for the body and the
contract silently claims the route returns nothing.

**Set to `warn`, and it must stay that way until the Wave 2 route-DTO backfill lands.** There are
**142** findings today, ESLint has no native baseline mechanism, and `lint` is a required check — so
`error` now would simply mean red on every PR until the entire backfill is done. Warnings do not fail
ESLint, so `npm run lint` stays green and the backlog stays visible.

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
`MISSING DEPENDENCY`. It is now a root devDependency, pinned **exact** at `4.1.10` because Vitest
declares it as an exact peer.

### Running it

```sh
npm run test:cov              # every workspace, via turbo
npm run test:cov -w apps/api  # 1911 tests, Jest + v8
npm run test:cov -w packages/hooks
```

There is **no coverage threshold and no coverage gate.** Coverage is a measurement here, not a
target — the point is to be able to see the refactor's real impact. Adding a threshold is a separate
decision.

---

## `.buildpad/` is excluded from all of this

The Buildpad canvas export is planning data — research notes and markdown, synced periodically. It
holds no code, so every tool that scans the tree must skip it, and a canvas sync must never fail a
gate.

| Tool | How |
|---|---|
| dependency-cruiser | `NOT_SOURCE` in [`.dependency-cruiser.cjs`](../../../.dependency-cruiser.cjs) (`doNotFollow` + `exclude`) |
| jscpd | `ignore` in [`.jscpd.json`](../../../.jscpd.json) |
| ESLint | Unreachable by construction — `apps/api`'s lint script globs `{src,apps,libs,test}/**/*.ts` relative to the workspace, and there is no repo-root ESLint config |
| Prettier | `.buildpad/` in [`.prettierignore`](../../../.prettierignore) |
| docs/spec sync | `NON_CODE_PREFIXES` in [`check-docs-impact.mjs`](../../../scripts/check-docs-impact.mjs) — see [`DOCS_CI.md`](DOCS_CI.md) |

The docs/spec gate treats `.buildpad/` paths as **ignored**, not as documentation: a PR that edits
code *and* `.buildpad/` still owes a `docs/` or `spec/` edit.
