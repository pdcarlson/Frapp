# Dependency updates (Dependabot)

Facts for Dependabot's schedule and grouping, the rule behind its ignore list, the write-ups behind several ignore entries, and the dependency-tree traps they guard against. The full ignore list is [`.github/dependabot.yml`](../../.github/dependabot.yml), where each entry carries its own reason; an entry with no section here (the NestJS 12 hold, the `postcss` pin) is explained only there. Router: [`agent-infra.md`](agent-infra.md). Cite this file and a heading, never `§N`.

Config: [`.github/dependabot.yml`](../../.github/dependabot.yml). This is the automated half of
the supply-chain story; the blocking half is `npm run check:npm-audit` ([`agent-infra.md` → Lint, test, build](agent-infra.md#lint-test-build-repo-root)), which fails CI on any
non-allowlisted high/critical advisory.

**One ecosystem entry, at the root.** `apps/*` and `packages/*` are npm workspaces resolving through
a single root `package-lock.json`, so one `npm` entry covers all of them. Per-workspace entries would
open duplicate PRs against the same lockfile — don't add them.

**Schedule and noise floor.** Weekly, Monday 09:00 UTC, `open-pull-requests-limit: 6`. Minor and
patch updates are grouped into **one** PR (`npm-minor-and-patch`); majors are deliberately left
ungrouped so each arrives as its own reviewable diff. Every Dependabot PR costs a babysit cycle under
the [Autonomous PR lifecycle](../../AGENTS.md), which is why grouping is aggressive.

**The exceptions to "majors arrive alone": the `vitest` and `sentry` groups.** The `sentry` group
(`@sentry/nestjs` + `@sentry/nextjs`, which pin `@sentry/core` and `@sentry/node` exactly) groups
majors only, since their minors already share `npm-minor-and-patch`; its `sentry-security` twin
covers the security lane at every update type. It replaced the Sentry 11 hold when #2722 landed:
Sentry 11 had arrived as two single-package PRs (#2712, #2714), and neither could go green.

**The `vitest` group.** `vitest` and
`@vitest/coverage-v8` are grouped at *every* update type, because they peer-require each other at an
exact version. Moving one half alone does not fail — npm silently lands a **second** vitest and
leaves half the tree on the old version, *which* half depending on which package moved — so a patch
splits the tree just as badly as a major does. Grouping by update type is the normal noise-floor
lever; this group exists for correctness instead, and it costs +1 PR on the weeks vitest ships. A
second group entry carries `applies-to: security-updates`, because groups default to the
version-update lane only. See
[The vitest 5 major is held on jest-dom's matcher types](#the-vitest-5-major-is-held-on-jest-doms-matcher-types)
below for the measured trees and why one of the two PRs went green anyway.

The limit went 5 → 6 with that group, and the 6th slot is *its*, not new headroom: the group fires
on every week vitest ships, and Dependabot drops overflow past the cap **silently** — no error, no
comment, nothing saying a PR was withheld. Security PRs are exempt from the limit and never counted
against it, so a full queue cannot suppress one. Add another always-on group and this needs raising
again by one.

**Who babysits.** Nobody special — Dependabot PRs flow through the normal lifecycle: CI runs (`npm
ci`, lint, type-check, `api-tests`, `web-tests`, `api-docker-build`) plus the audit gate, and an
agent triages red checks infra-vs-code exactly as for a human-authored PR. Commits land as
`chore(deps): …` / `chore(deps-dev): …`; PRs are labelled `area:deps` and carry no release label, so
they take the default `release:patch` bump.

## A grouped bump of a peer-depended package can land a second copy, not an upgrade

Dependabot [#2369](https://github.com/pdcarlson/Frapp/pull/2369) moved `apps/api` from
`@nestjs/*@^11.2.1` to `^11.2.4` and reddened five jobs at once — `lint-and-typecheck`,
`clean-checkout-typecheck`, `api-contract-check`, `api-tests` and `api-docker-build` — on type
errors naming the *same* type on both sides (`Argument of type 'INestApplication<any>' is not
assignable to parameter of type 'INestApplication<any>'`): one import path under
`apps/api/node_modules/@nestjs/common`, the other under the root `node_modules/@nestjs/common`.
When nothing in a Dependabot diff but `package-lock.json` explains a wall of red, that is the shape
to recognise.

It is the duplicate-hoisted-copy trap of
[`security-fixes.md`](../security/security-fixes.md#why-the-pin-bump-alone-was-not-enough) — its
§ *Prevention* rule "Check for a duplicate hoisted copy afterward", and the `next`/`geist` case
under § *Why the pin bump alone was not enough* — arriving through the Dependabot lane instead of an
advisory sweep. Six packages outside the bumped set peer-depend on the root `@nestjs/common` node
(`@nestjs/config`, `@nestjs/swagger`, `@nestjs/schedule`, `@sentry/nestjs`, …) on ranges as loose as
`^11.0.0`, so when the only *direct* dependant moves, the old node still satisfies every one of
them: npm keeps it, re-marked `"peer": true`, and nests the new version under
`apps/api/node_modules/` instead. TypeScript is structural, so two copies are not incompatible by
themselves — what breaks is the declarations inside them that structural typing cannot relate.
`VersionValue` is `string | typeof VERSION_NEUTRAL | Array<…>` and `VERSION_NEUTRAL` is declared
`unique symbol`, so two copies declare two distinct symbol types. That is where *this* error bottoms
out — `Type 'unique symbol' is not assignable to type 'VersionValue | undefined'` — and it is what
`tsc` names first on the way back up through `VersioningOptions` to the `INestApplication` mismatch
the jobs report. Do not read it as the only break: `tsc` stops at the first incompatible property,
and neutralising that symbol in both copies leaves the two `INestApplication` types unrelated
anyway, through the generic `on` signature reached via `connectMicroservice` (checked by compiling
two copies against each other, 2026-09-18). This is npm's tree builder, not Dependabot — a plain
`npm install --package-lock-only` on the same manifest change reproduces the nesting exactly
(2026-09-18, npm 11.19.1).

**Read the remedy in that document, not here**, `npm update <pkg>`-before-entry-deletion order
included. What this lane adds to that record is that for a *grouped* bump the cheaper lever is
enough, provided the siblings move together: with all four `apps/api` ranges at `^11.2.5`,
`npm update @nestjs/common @nestjs/core @nestjs/platform-express @nestjs/testing
--package-lock-only` off `origin/main` resolved one hoisted 11.2.5 apiece and no nested copy —
byte-identical to deleting those four lockfile entries by hand and re-resolving (2026-09-18,
Node 24.20.0 / npm 11.19.0). Mind the versions there: the fix shipped **11.2.5**, one patch past
what #2369 proposed, because that release landed while the PR sat red.

`npm dedupe` is not a lever for this — neither it nor a root `overrides` entry moves an existing
peer resolution, as that same record states. In this repo it never gets that far anyway: it
re-resolves the whole tree and exits `ERESOLVE` on the `openapi-typescript` peer conflict under
[`agent-infra.md` → TypeScript 7 is native `tsc` plus a TypeScript 6 compiler
API](agent-infra.md#typescript-7-is-native-tsc-plus-a-typescript-6-compiler-api).

## The ignore list is a runtime constraint, not a preference

`react`, `react-dom`, `react-test-renderer`, the `react-native*` family and the Expo client packages
are ignored. React is pinned to an **exact** version in every workspace plus a root `overrides`
entry: React Native bundles a `react-native-renderer` that asserts exact version equality with
`react` at runtime, while its peer range does not express that. npm will
therefore accept a newer React silently, hoist it, and kill `apps/mobile` on first render with
"Invalid hook call" — a failure **only booting the app on a device catches**, never CI. See
[`AGENTS.md` § Gotchas](../../AGENTS.md) and PR #842. These packages move as a version-locked set
through a planned Expo SDK upgrade (#2329), never as isolated bumps. (#289 was the SDK 54 → 57
upgrade, closed `completed` by PR #927; #2329 is the open tracker for the next one.)

**The membership rule**, since the list is not simply "everything RN-shaped": a package belongs in it
if it is either (a) exact-version-locked to React (`react`, `react-dom`, `react-test-renderer`) or
(b) a native module whose binary must match the Expo SDK's prebuilt set (`react-native*`, the
`expo-*` client packages, `@expo/*`, `@react-native-async-storage/*`). JS-only libraries on caret
ranges stay updatable even when they look RN-adjacent — `@react-navigation/native` and
`@gorhom/bottom-sheet` are deliberately **not** ignored, because a bad bump there fails
`check-types` or a test rather than dying silently on a device.

That `check-types` safety net is the reason JS-only libraries stay updatable, and it **does not
cover a package that ships native code**: `@sentry/react-native` and `@stripe/stripe-react-native`
both ship Swift and Kotlin, both appear in the SDK's own `bundledNativeModules.json`, and both are
outside the ignore list — so a bad bump on either fails as a native compile with no CI signal, not
as a type error. They are also deliberately held *ahead* of the versions the SDK specifies. Whether
that exemption is right, and on what grounds, is #2336; it is an open question, not a decision this
rule has made.

**For the `expo-*` client packages, apply (b) mechanically, not as a judgement:** *every* `expo-*`
entry in `apps/mobile/package.json` belongs in the list, whatever the package looks like from the
JS side. An Expo client package's major version **is** its SDK line — the `58.x` release of any of
them is built against `expo-modules-core@58` and freely calls native API that `expo-modules-core@57`
does not have — so "is this really a native module?" is the wrong question to ask of one, and
answering it per package is what let ten of them sit outside the list until PR #2338. Read the rule
this way and the list is mechanically checkable against the manifest; read it as a per-package
judgement and the gap reopens the next time a client package is added. `npm run
check:expo-sdk-line` checks it mechanically in the required `mobile-validate` job (#2330):

- **The roster.** It fails on an `expo-*` package `apps/mobile` declares (in any dependency
  section) that the list doesn't name exactly, on a missing `expo` or `@expo/*` entry, on one of
  those entries whose `update-types` leave out `version-update:semver-major` (a major is the next
  SDK), on any glob that matches `apps/api`'s `expo-server-sdk`, and on an exact `expo-*` entry for a
  package `apps/mobile` doesn't declare that isn't an installed package the SDK's map lists.
- **The SDK line.** It fails on any copy `package-lock.json` installs, transitive ones such as
  `expo-modules-core` included, of a package the installed `expo`'s `bundledNativeModules.json`
  lists under `expo-*` or `@expo/*`, when its version is outside the range the map gives it, and on
  a declared range in `apps/mobile/package.json` whose floor is off that range.
  Installed Expo packages the map doesn't list (`expo-modules-jsi`, `expo-modules-autolinking`, the
  `@expo/*` tooling on its own version lines) aren't checked; `expo`'s own dependency ranges pin
  them.

It asserts SDK-line coherence only: a package inside its range can still fail to compile.
`@sentry/react-native` and `@stripe/stripe-react-native` are in that map but left out of the check
on purpose, pending #2336 above, and so is the `react-native-*` family, which moves with React.

That gap cost a production build. Dependabot moved `expo-apple-authentication` (#2218) and
`expo-localization` (#2217) to `58.0.0` as ordinary semver majors, and the first iOS production EAS
build failed in the Xcode native compile with `type 'Utilities' has no member 'keyWindow'`:
`expo-apple-authentication@58.0.0`'s `ios/AppleAuthenticationRequest.swift` calls
`Utilities.keyWindow()`, and `expo-modules-core@57.0.11` declares `Utilities` with only
`urlFrom(string:)` and `currentViewController()` — in the 57 line that window lookup lives on a
different type, `SceneGeometry.keyWindow(for:)`. **Nothing in CI compiles this class of break:**
the `expo prebuild` job runs with `--no-install`, which generates the native project without
compiling it, so no Swift is built anywhere in CI and the failure first appears at `eas build -p
ios`. At the time the list was the only gate; since #2330 the SDK-line check fails a bump off the
line before merge, because it reads versions rather than compiling anything.

Pinning back to the SDK line is the supported configuration, not a workaround — `~57.0.x` is what
Expo ships for SDK 57 — but it is **not free, and the PR that did it did not verify the runtime
path.** `58.0.0` also carried two iOS fixes on the Sign in with Apple path that the 57 line does not
have: an uncatchable `fatalError` when no key window is found (replaced upstream by a catchable
exception), and a missing `.runOnQueue(.main)` on `requestAsync`, which leaves
`ASAuthorizationController.performRequests()` on `expo-modules-core`'s background async queue. Both
are tracked in #2334, and both arrive for free with #2329. Do not read the pin as evidence that
native SIWA was exercised — the mobile unit suite mocks the module and never loads it.

Two traps for whoever edits that list next:

- **Do not collapse the Expo entries into `expo-*`.** That glob also matches `expo-server-sdk`, an
  `apps/api` dependency (the push-delivery client) with no relationship to the mobile SDK lock.
  Globbing it would freeze the API's push library silently and indefinitely. The client packages are
  listed individually for exactly this reason; if an SDK upgrade adds a new one, append it (the
  SDK-line check fails until you do, and refuses an `expo-*` glob).
- **Ignore conditions also suppress Dependabot _security_ updates.** A CVE in React, React Native or
  an Expo client package will **not** open a PR automatically. This is an accepted trade — an
  isolated security bump in that set breaks the runtime — but it is a real gap, so it is written down
  rather than left implicit. `check:npm-audit` still fails CI on such an advisory, so it surfaces
  loudly; carrying the fix means doing an SDK-aligned upgrade, not a one-package bump.

  **That gap got wider when the Expo client list was completed to every `expo-*` package
  `apps/mobile` declares** (21 at the time, PR #2338). It now also
  covers `expo-camera`, `expo-image-picker`, `expo-location` and `expo-notifications` — the media,
  location and push surfaces, which had been receiving
  automatic patch and security PRs while they sat outside the list. None of the entries carry
  `update-types`, so in-SDK `57.0.x` patches are frozen alongside the SDK-line majors that actually
  caused the break; scoping them to `version-update:semver-major` (the shape `eslint` already uses
  in the same file) would block the break and let patches flow. Whether to do that is #2331 — an
  open question, not a decision this section has made.

`@types/react` is deliberately **not** ignored: it is types-only, carries no runtime equality
assertion, and a bad bump fails `npm run check-types` in CI — which is precisely the safety net that
makes auto-updates tolerable.

**Dependabot does not manage the root `overrides` block.** Those entries (`handlebars`, `undici`,
`path-to-regexp`, … — added by #861 to force patched versions of *transitive* dependencies) are
invisible to it, so they neither get bumped nor get cleaned up as the direct dependencies that pulled
them in move on. Reviewing that block is a manual job; `npm run check:npm-audit` is what tells you an
override is no longer doing its work.

## Dependabot PRs need no docs exemption

They used to. `docs-spec-sync` was a required check under `enforce_admins: true` that failed any PR
touching non-`docs/` files without touching `docs/` — and a Dependabot PR changes `package.json` /
`package-lock.json` and nothing else, so without a step-level exemption keyed on the PR author every
one of them was permanently unmergeable, not merely red. The gate was deleted in #1597 and the
exemption went with it.

The lesson worth keeping is why the exemption existed at all: a required check that a whole category
of legitimate PR **cannot** satisfy is not a gate, it is a block. That was the argument for deleting
the gate, and it is the test to apply before adding any check to `DOCS_CHECKS`.

## `colorjs.io` is ignored: it is a vendored-generator pin, not a dependency

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
[`packages/chapter-theme/src/vendor/README.md`](../../packages/chapter-theme/src/vendor/README.md).

## The ESLint 10 major is held on a plugin, not on our code

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

## The vitest 5 major is held on jest-dom's matcher types

`vitest` and `@vitest/coverage-v8` ignore **major** updates only; 4.x minors and patches still flow.
They are named rather than globbed as `@vitest/*` on purpose — `@vitest/eslint-plugin` (the renamed
`eslint-plugin-vitest`) sits in that scope but peers `vitest: "*"` and versions on its own line, so
a glob would freeze its majors forever and drag it into a group premised on the exact peer pin. Same
rule as `expo-*` vs `expo-server-sdk` above. Two independent things break under vitest 5, and only
the first is a hold.

**Upstream, and the reason this is a hold.** vitest 5 widened its assertion interface to two type
parameters (`interface Assertion<R extends void | Promise<void> = void, T = unknown>`).
`@testing-library/jest-dom` still augments the one-parameter shape (`interface Assertion<T = any>`).
TypeScript merges a generic interface's declarations only when the type parameter lists are
*identical*, so the augmentation quietly fails to merge and **every jest-dom matcher stops
existing**. `tsc` emits one error per matcher call site, and `apps/web` has **1,637 of them across
82 spec files** (2026-09-21; counted by matching the jest-dom matcher names against
`apps/web/**/*.spec.tsx`, and spot-checked against #2439's `lint-and-typecheck` log, whose per-file
error lines match site for site). So `check-types` fails in the four figures, not the dozens, all of
it reading `Property 'toBeInTheDocument' does not exist on type 'Assertion<void, HTMLElement>'`, and
it takes `lint-and-typecheck` and `clean-checkout-typecheck` down wholesale.
`@testing-library/jest-dom@7.0.1` is the newest published release (2026-09-21,
`npm view @testing-library/jest-dom version`) — there is nothing to upgrade to.

When a wall of `TS2339: Property 'toBeX' does not exist on type 'Assertion<…>'` appears after a test
runner bump and nothing in the diff touched the specs, this arity mismatch is the shape to
recognise. The matchers did not break; the augmentation stopped merging.

What makes this a *hold* rather than an open question: it was measured, like the ESLint 10 hold. The
only in-repo fix is a hand-written augmentation re-declaring jest-dom's matcher surface against the
two-parameter interface — **50 matchers**, hand-synced with every jest-dom release, for a package
whose own types are meant to be the source of truth. Rejected for the same reason the ESLint 10
`settings.react.version` workaround was.

**Ours, and not covered by the hold lifting.** `apps/mobile/lib/theme.spec.tsx:104` fails under
vitest 5 with `AssertionError: expected undefined to be defined` (1 failed / 1000 passed). It finds a
`Platform.select` call made at *module load* by scanning `vi.mocked(Platform.select).mock.calls`, and
under vitest 5 the call is not there. Not root-caused to a named vitest 5 change. Note
`apps/mobile/vitest.config.ts` *leaves `clearMocks` at its default of off* — deliberately, per the
NOTE at its line 12 — specifically to keep that record alive. There is **no `clearMocks` key**: the
constraint is real but nothing pins it, so a vitest release that flips the default breaks
`theme.spec.tsx` with nothing in the config to stop it. The rewrite should retire that dependency
rather than deepen it. So when jest-dom ships, this is still not a pure version bump.

**Why neither Dependabot PR was the upgrade it claimed to be.** Worth recording in detail, because
CI said so in only one of the two cases. `@vitest/coverage-v8` peer-requires `vitest` at an *exact*
version and vitest returns the favour, so moving one half never fails the install — **npm duplicates
instead**. `vitest` is declared by 12 workspaces and `@vitest/coverage-v8` once at the root, which
today resolves to a single hoisted `node_modules/vitest`. That node has **13** consumers, not 12:
`@repo/api-sdk` runs `vitest run` while declaring no `vitest` devDependency of its own, so it binds
to the hoisted copy — `ci.yml` says so in as many words ("The package uses the hoisted workspace
vitest; this step does not add a lockfile entry"). Move one half and that node splits in two
(counted 2026-09-21 from each branch's `package-lock.json`, npm 10.9.7):

| branch | root `vitest` | root `coverage-v8` | nested workspace copies | CI |
| --- | --- | --- | --- | --- |
| `main` | 4.1.11 | 4.1.11 | none | green |
| [#2437](https://github.com/pdcarlson/Frapp/pull/2437) (`coverage-v8` alone) | **5.0.1** | 5.0.1 | **12 × 4.1.11** | **green** |
| [#2439](https://github.com/pdcarlson/Frapp/pull/2439) (`vitest` alone) | 4.1.11 | 4.1.11 | **12 × 5.0.1** | red |

One install becomes thirteen either way — the duplicate-hoisted-copy trap of
[A grouped bump of a peer-depended package can land a second copy, not an upgrade](#a-grouped-bump-of-a-peer-depended-package-can-land-a-second-copy-not-an-upgrade)
above, reached through the ungrouped-**major** lane rather than the grouped one. Nested copies are
not merely wasteful here:
[A group regeneration can drop `jsdom`, and vitest resolves it from the root](#a-group-regeneration-can-drop-jsdom-and-vitest-resolves-it-from-the-root)
below records what a relocated vitest actually breaks, because vitest loads its environment from its
own install location.

The asymmetry is the part to internalise. #2439 moved the copy the **tests** load, so it went red and
argued for itself. #2437 moved only the copy **coverage** loads — and **nothing in CI runs
`test:cov`** — so it went fully green, with coverage bound to vitest 5.0.1 while every suite except
`@repo/api-sdk`'s ran on 4.1.11. (`@repo/api-sdk` is the 13th consumer above: its suite ran on
5.0.1, in `lint-and-typecheck`, and passed — the only vitest 5 runtime evidence this repo has.) That
PR would have merged. A green Dependabot PR touching a package CI never exercises is worth one look
at the lockfile before trusting the checkmark.

The `vitest` **group** is the permanent half of the fix and is *not* part of the hold: it keeps the
family together at every update type, so the split cannot recur when the hold lifts. It is two
entries — groups default to `applies-to: version-updates`, and security updates ignore groups
unless one opts in, so a security bump of either package alone would rebuild the same split tree
(dormant while Dependabot alerts stay disabled, #921).

Lifting the hold needs **both** blockers cleared, not just jest-dom: drop the two `ignore` entries
once jest-dom ships vitest 5 types **and** `apps/mobile/lib/theme.spec.tsx` no longer depends on an
import-time mock call. Dropping them on jest-dom alone lands a PR that is red on `mobile-validate` —
the failure this section predicts. **Keep the group** either way. Tracking:
[#2445](https://github.com/pdcarlson/Frapp/issues/2445).

## A group regeneration can drop `jsdom`, and vitest resolves it from the root

`vitest` declares `jsdom` as an **optional** peer (`peerDependenciesMeta.jsdom.optional`), and npm
never auto-installs optional peers. It also loads the environment from *its own* install location —
the hoisted root `node_modules/vitest` — so the workspace-level `jsdom` devDependencies in
`apps/web`, `packages/hooks` and `packages/chat-core` are invisible to it. The jsdom suites passed
only because a stale root `jsdom@29.1.1` node lingered in the lockfile as an auto-installed peer of
an older vitest, which nothing declared and nothing guaranteed.

#1395 — the weekly `npm-minor-and-patch` group — regenerated the lockfile, that root node went away,
and every `environment: "jsdom"` config plus every `/** @vitest-environment jsdom */` spec failed
with `Cannot find package 'jsdom' imported from …/node_modules/vitest/dist/chunks/…`. `web-tests`
and `mobile-validate` went red with nothing in the diff that looked like a cause: the group touched
no test file, and the jsdom line in each workspace manifest was unchanged.

`jsdom` is now an explicit **root** devDependency, so the hoisted copy is intentional and `npm ci`
reproduces it. Two neighbouring declarations were missing for the same reason — hoisting luck rather
than intent — and are now explicit: `@testing-library/react` in `apps/mobile` (eight specs import
it), and the `react-dom` peer that `@testing-library/react` needs in `packages/hooks`. Without that
second one npm re-resolves the peer to the newest `^19` on any bump of the testing-library edge,
which collides with the exact `react@19.2.3` pin and fails the install outright with `ERESOLVE`.

The general rule: **declare what a workspace imports.** A package that resolves only because npm
happened to hoist it is a red suite waiting for the next regeneration — and the failure surfaces in
a PR that never touched it.

## Alerts and security updates are a repo Settings toggle

Dependabot **alerts** and **security updates** live in repo Settings → Advanced Security, not in this
file. **The read half is answered as of 2026-09-02: alerts are DISABLED on this repo.**
`GET /repos/pdcarlson/Frapp/vulnerability-alerts` returns **404 `"disabled"`** when called direct
(node `fetch`) — not the `403` this paragraph used to record, which was the agent proxy's
GitHub-credential layer answering rather than GitHub, and therefore said nothing about the toggle
either way (see **The `api.github.com` route rule** under [`agent-infra.md` → Work status](agent-infra.md#work-status)). A session can now read this
setting; it still cannot flip it — the GitHub MCP exposes no repo-security-settings tool and the
REST route above is a read channel. So #921 stays open as `[human]`, now scoped to the write half:
turning alerts (and security updates) on in repo Settings. The alerts toggle is the half that was
read directly; the security-updates toggle follows from it (alerts are a prerequisite) but was not
itself read. Read that alongside § *The ignore list is a runtime constraint, not a preference*
above: security PRs for the React/RN/Expo set are suppressed there deliberately, and with the
repo-level toggle off no alert is being raised for anything else either — so `npm run
check:npm-audit` in CI is the only vulnerability signal this repo actually has today, and unlike a
Dependabot alert it is a **blocking** CI gate (see the `check:npm-audit` row in [`agent-infra.md` → Lint, test, build](agent-infra.md#lint-test-build-repo-root)).
