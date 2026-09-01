## Security Fix: Supabase Filter Injection

### Overview
A high-severity security vulnerability related to Supabase `.or()` filter injection was identified and fixed in `apps/api/src/application/services/search.service.ts`.

### Details
Previously, user input was directly interpolated into Supabase `.or()` filter strings (e.g., `.or(\`title.ilike.${pattern}\`)`). Because PostgREST uses specific characters like commas `,` and parentheses `()` to parse query logic, an attacker could inject these characters to modify the query structure and bypass isolation scopes.

To fix this, an `escapeFilterValue` utility was created in `apps/api/src/infrastructure/supabase/supabase.utils.ts` that safely escapes string values according to PostgREST quoting rules (surrounding values with double quotes and doubling internal quotes). All dynamic inputs used in `.or()` filters within `search.service.ts` are now sanitized using this utility.

### Prevention
Always use `escapeFilterValue` when injecting dynamic user inputs into PostgREST/Supabase string filters.

## PostgREST filter injection in supabase-backwork-resource.repository.ts
Added `escapeFilterValue` to sanitize search input in `SupabaseBackworkResourceRepository` to prevent PostgREST grammar elements from being injected into `.or()` filters.

## PostgREST `.or()` quoting in supabase-chat-message.repository.ts
`SupabaseChatMessageRepository.findPollsByChapter` builds an `.or()` filter for active polls using a server-generated ISO timestamp. That segment is passed through `escapeFilterValue` so the `.or()` template follows PostgREST string quoting. The inactive-poll branch uses `.filter(..., 'lte', ...)` with the bare ISO string because the Supabase JS client encodes filter operands; passing the same double-quoted PostgREST literal there would compare against a string that includes quote characters and break `lte` semantics.

## Bounded row cap on `findPollsByChapter`
That method always applies `.limit()` using `LIST_QUERY_LIMIT_*` from `apps/api/src/domain/constants/list-query-limits.ts` when `options.limit` is missing, invalid, or out of range, so a future caller cannot accidentally fetch an unbounded POLL row set for a chapter. `PollService.listPolls` clamps `limit` the same way as `PointsService.listTransactions` (default 50, inclusive 1–200) before calling the repository; the repository helper still normalizes for defense in depth.

## npm audit triage (issue #245)

### Overview

`npm audit` reported **58 vulnerabilities (1 critical, 19 high, 38 moderate)** at the repo root. The critical was `handlebars` (multiple advisories) pulled in transitively by `ts-jest` in `apps/api`. High-severity items split between direct deps (NestJS injection, multer in `@nestjs/platform-express`, lodash in `@nestjs/config`, etc.) and transitive deps (`minimatch`, `picomatch`, `node-forge`, `tar`, `undici`, `path-to-regexp`, `fast-uri`, `flatted`, `@xmldom/xmldom`) reachable through NestJS, Expo CLI tooling, Jest, and ESLint trees.

### Changes

- **Root `overrides`** (in `package.json`) force patched versions of transitive packages without requiring upstream releases. The override pattern is the canonical lever for transitive CVEs in this monorepo — extend it rather than patching individual workspaces. The `@xmldom/xmldom` override uses an unbounded floor (`>=0.8.13`) so consumers that declared a higher major retain it — today `plist@3` (`^0.9.10`) and `@expo/plist` (`^0.8.8`), which resolve to a single hoisted `0.9.10`. (The list read `jsdom@29`, `expo-server-sdk@5`, `plist@3` until #1419; neither of the first two reaches `@xmldom/xmldom` in the tree at all any more — the `jsdom@29` was the orphaned root copy #1419 pruned, whose story is told in [`ci-cd/AGENT_INFRA.md`](../ci-cd/AGENT_INFRA.md#a-group-regeneration-can-drop-jsdom-and-vitest-resolves-it-from-the-root).) The `undici` override is bounded — `>=7.29.0 <8.0.0` — because undici `8.x` raises its engine to `node>=22.19.0`, which trips `EBADENGINE` and crashes `npm ci` in the `node:20-alpine` Docker base used by `apps/api`. **Only lift the `<8.0.0` cap after** the repo's `engines.node` is bumped to `>=22.19.0`, the `apps/api` Dockerfile base image is moved off `node:20-alpine`, and CI's `setup-node` matrix is updated to match. The floor was raised from `>=6.24.0` in #699 — see [undici floor](#undici-floor-raised-off-the-vulnerable-7x-band-699) below. Note the floor is only a *lower* bound on an override npm always resolves to the max of, so it does not by itself pick the version; it exists to stop a future resolution from sliding back under the advisory. undici `7.29.0` declares `engines.node >=20.18.1`, which every real runtime here satisfies (Docker `node:20-alpine`, all CI jobs on `node-version: 20`) even though root `engines.node` still reads `>=18`.
- **`@nestjs/*` patch bumps** in `apps/api/package.json` (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/swagger`, `@nestjs/config`, `@nestjs/cli`, `@nestjs/schematics`, `@nestjs/testing`) close the direct-dep high CVEs (NestJS injection, lodash, path-to-regexp, multer). The `vite` and `lodash` advisories cleared via the NestJS / vite transitive bumps that rode along, not via overrides.
- ~~**`@infisical/cli`** kept pinned at `0.43.40` (matches main). Newer `0.43.80+` declares `tar ^7.5.13` natively but breaks the `apps/api` Docker build during the preinstall (`tar.x` extraction in `node:20-alpine` fails consistently). The two resulting high advisories (`@infisical/cli` and its nested `tar`) are accepted as **dev-only install-time exceptions**~~ — **superseded (#831/#618 sweep): the pin is now `0.43.121` and the exception is lifted.** Re-tested at `0.43.121`, whose preinstall extracts with node-tar `7.5.22`; a full Dockerfile deps-stage `npm ci` inside `node:20-alpine` completes with a working binary, so the tar advisories are fixed rather than excepted — see "npm audit sweep + CI gate" below. (`@infisical/cli` remains a root `devDependencies` entry used only by `npm run dev:*` scripts, excluded from production runtime by the `apps/api` Dockerfile `prod-deps` stage.)

### Result

`npm audit` **at the time of #245**: **0 critical, 2 high (dev-only, see above), 26 moderate**. All 642 `apps/api` unit tests pass; full monorepo `check-types`, `lint`, and `apps/api` production build are clean.

**Current baseline (re-measured 2026-08-08, at the head of #684/#699): 64 total — 4 critical, 22 high, 38 moderate, 0 low.** The drift since #245 is upstream advisory disclosure against dependencies this repo has not moved, not a regression introduced by a change here. The four criticals are `@xhmikosr/decompress`, `concurrently`, `shell-quote`, and `tar` — `concurrently` is a direct root `devDependencies` entry and is tracked in #730; the rest sit in the Expo/Metro and archive-extraction tooling trees. ~~Treat *this* line as the posture of record, not the #245 line above it.~~ **Superseded — the posture of record now lives in "npm audit sweep + CI gate" below, and the CI `dependency-audit` gate keeps it honest from here on.**

### Remaining moderate advisories (deferred, tracked as issues)

- ~~**Expo SDK 54 → 56 upgrade** (closes ~16 of the 26 remaining moderates): #289~~ — **done**, as SDK 54 → **57**. See "Expo SDK 57 upgrade" below.
- **`@swc/cli` 0.7 → 0.8 in `apps/api`**: #290
- ~~**Outstanding `next` moderate advisories (web + landing)**: #291~~ — **closed.** See "Next.js advisory cleanup" below.
- **`geist` (apps/web)**: #292
- **`brace-expansion` 5.x in minimatch 10.x tree**: not separately tracked — moderate only, and the override that would close it (`^2.0.3`) breaks minimatch 10.x at runtime (different exported API). Re-evaluate when an audit-clean cross-major version exists.

### Prevention

When `npm audit` flags transitive CVEs, prefer **`overrides` at the repo root** over per-workspace upgrades. Pin to the patched range cited in the advisory (e.g., `<=1.3.3` ⇒ override to `^1.4.0`), then re-resolve with **`npm update <pkg>`**.

**Use `npm update <pkg>` — do not delete the lockfile.** Editing an override does *not* move an already-locked version: npm never re-checks a locked version against a *changed* override range, so `npm install`, `npm install --package-lock-only`, and even a clean `node_modules` rebuild all silently leave the old resolution in place. (Verified in #699: the undici override was narrowed to `>=7.29.0` and all three still resolved 7.26.0.) Deleting `package-lock.json` *does* apply the new override, but it re-resolves every range in the monorepo — measured at **356 unrelated packages** on one run, including `next`, `vite`, `prettier`, `eslint`, `@playwright/test`, and `@supabase/*`. That destroys the revert story and risks formatting, lint, and visual-snapshot failures unrelated to the advisory. `npm update <pkg>` re-resolves the named package against the new constraint and nothing else.

**Check for a duplicate hoisted copy afterward.** An optional peer dependency can reintroduce the vulnerable version under a second path, leaving `npm audit` red even though the direct dependency was bumped. In #684, bumping `@nestjs/platform-express` alone left a second hoisted copy at the old version — pulled in by `@nestjs/core`'s optional peer on `@nestjs/platform-express@^11.0.0` — still carrying the vulnerable `multer`. Bumping the sibling packages in lockstep collapsed it. Confirm with `npm ls <pkg> --all` that exactly one version resolves, and remember `@nestjs/platform-express` pins `multer` **exactly**, so the fixing release must be found by walking versions rather than assuming a range floats.

## multer / body-parser / undici advisory sweep (#684, #699)

A second round of `overrides`/bump triage over the same tree as #245, closing 15 advisories. Both halves land in the same root `package-lock.json`, so they shipped as one diff rather than two PRs racing over the same regenerated file.

### multer and body-parser cleared via a lockstep `@nestjs/*` bump (#684)

`@nestjs/platform-express` pins `multer` **exactly**, not with a caret, so the fixing release had to be found by walking versions: `11.1.24` through `11.1.27` all pin `multer@2.1.1`; **`11.1.28` is the first to pin `2.2.0`**. That clears GHSA-72gw-mp4g-v24j (HIGH, DoS via deeply nested multipart field names) and GHSA-3p4h-7m6x-2hcm (MODERATE, incomplete cleanup of aborted uploads).

Bumping `platform-express` alone was **not** sufficient, and this is the part worth remembering. `@nestjs/core` declares an *optional peer* dependency on `@nestjs/platform-express@^11.0.0`; with `core` still at `11.1.24`, npm satisfied that peer with a second, hoisted `platform-express@11.1.24` that kept the vulnerable `multer@2.1.1` in the tree. `npm audit` stayed red while the direct dependency looked fixed. Bumping `@nestjs/common`, `core`, `platform-express`, and `testing` together to `^11.1.28` collapses that back to a single hoisted copy. (This matches the lockstep set #245 already established for these packages.)

`body-parser` rides the same `express@5.2.1` chain; GHSA-v422-hmwv-36x6 (LOW, size enforcement silently disabled by an invalid `limit`) clears at `2.3.0`, which express's existing `^2.2.1` range already permitted. The Stripe `rawBody: true` path (`apps/api/src/main.ts`, consumed by `stripe-webhook.guard.ts`) is unaffected — body-parser's `verify`-callback contract is unchanged across 2.2.2 → 2.3.0.

The declared floor was moved to `^11.1.28` rather than left at `^11.1.24`. The old range already *permitted* 11.1.28, so `npm ci` would have installed the patched tree either way — but because Nest pins `multer` exactly, any fresh resolution under `^11.1.24` is free to land back on 11.1.24 and silently reintroduce `multer@2.1.1`. The floor is what records the security intent.

### undici floor raised off the vulnerable 7.x band (#699)

The `overrides.undici` range was `>=6.24.0 <8.0.0` — a floor four minors *below* the patched release — so it still resolved `7.26.0`, squarely inside the vulnerable 7.0.0–7.28.0 band, defeating the point of having pinned an override at all. Narrowed to `>=7.29.0 <8.0.0`, clearing 12 advisories including TLS certificate-validation bypass via SOCKS5 ProxyAgent, HTTP header injection via `Set-Cookie` percent-decoding, cross-user cache poisoning, and response-queue poisoning via keep-alive socket reuse. **Four of the twelve have range `<7.29.0`, so `7.28.x` would not have sufficed.**

undici reaches the *production* image (`apps/api` → `expo-server-sdk` → `undici`), not just test tooling, so this floor is load-bearing for the deployed artifact. The `<8.0.0` ceiling is retained for the `node:20-alpine` engine reason recorded above.

### Result

`multer`, `body-parser`, and `undici` are all absent from `npm audit` at the head of this work, with no new advisory introduced (`low` went 1 → 0; `high` 25 → 22). Lockfile drift was held to the 7 intended packages — the four `@nestjs/*`, `multer`, `body-parser`, `undici` — plus two drops, `@nuxt/opencollective` and `consola`, which fall out because newer `@nestjs/core` removed its donation-banner postinstall (also removing a `hasInstallScript` from the production image).

Verified: `npm ci` in sync, `check-types` 16/16, `lint` 16/16 (0 errors), `nest build`, 1479 `apps/api` unit tests, 152 ai-evals, 175 web, 4 landing, plus `check:brand-assets`, `check:migration-safety`, and `check:api-contract`. The API was booted against the local sandbox and served HTTP on the new stack.

> **Two corrections to the above, learned in #291 — read before deleting the lockfile.** Overrides do *not* move an existing **peer** resolution, and a full `rm package-lock.json` rebuild **drops the optional platform binaries for every host except the one that ran it**. Delete just the offending entries and run `npm install --package-lock-only` instead. See "Next.js advisory cleanup" below.

## npm audit sweep + CI gate (#831, #290, #618)

One pass over everything fixable without a tracked breaking upgrade, then a blocking CI gate so high/critical advisories cannot re-enter silently.

### The sweep

Starting point (measured 2026-08-13 on `main`): **61 total — 4 critical, 19 high, 38 moderate**.

- **`npm audit fix`** (in-range, lockfile-only): cleared the critical `@xhmikosr/decompress` chain and `concurrently`/`shell-quote` (9.2.1 → 9.2.4 / 1.8.3 → 1.9.0, the #730 dup), plus high `brace-expansion`, `fast-uri`, `form-data`, `piscina`, `vite` (8.0.14 → 8.2.1) and assorted moderates. 50 lockfile entries moved, no semver-major hops.
- **`js-yaml` highs** needed two extra steps because `@nestjs/swagger@11.4.4` pins `js-yaml@4.1.1` **exactly**: the `apps/api` floor moved to `^11.4.6` (records intent, same as the `@nestjs/*` `^11.1.28` floor above), and because 11.4.6 pins `js-yaml@5.2.1` — itself flagged (GHSA-pm4m-ph32-ghv5, fixed 5.2.2) — a **scoped** root override (`"@nestjs/swagger": { "js-yaml": "^5.2.2" }`) forces only swagger's nested copy to 5.2.3. The hoisted `4.3.1` still serves `@eslint/eslintrc`, `cosmiconfig`, and `@expo/xcpretty`, which declare `^4.x`. Note a scoped override does not move an already-locked nested copy either — `npm update <parent>` (here `@nestjs/swagger`) is what re-resolves the subtree.
- **`@swc/cli` 0.7.10 → 0.8.1** in `apps/api` (#290): cleared its moderate plus the `@xhmikosr/*` archive-extraction chain. `@nestjs/cli`'s *optional peer* on `@swc/cli` kept a second hoisted `0.7.10` alive after the workspace bump — the same trap as #684's `platform-express` — collapsed with `npm update @swc/cli`.
- **`@infisical/cli` 0.43.40 → 0.43.121**: lifts the #245-era dev-only exception. The old blocker (preinstall tar extraction failing on `node:20-alpine`) no longer reproduces — 0.43.121's preinstall extracts with node-tar `7.5.22`, and a full Dockerfile deps-stage `npm ci` inside `node:20-alpine` was verified to complete with a working binary. Clears the last **critical** (`GHSA-23hp-3jrh-7fpw`) and seven high node-tar advisories.

**Posture of record (2026-08-13, head of this sweep): 39 total — 0 critical, 12 high, 27 moderate, 0 low.** Every remaining high/critical *package* finding is the Expo SDK 54 chain, whose root causes are exactly four advisories (`image-size` ×2, `postcss` ×2) fixed only by the Expo SDK 57 major upgrade (#289). Remaining moderates: the Expo chain (#289) and the `@sentry/nestjs`/OpenTelemetry chain (#682).

> **Superseded 2026-08-14 by the `@sentry/nestjs` major bump (#682), below: 22 total — 0 critical, 12 high, 10 moderate, 0 low.** The high count is unchanged because it was always entirely the Expo chain; the 17 cleared moderates were the OpenTelemetry subtree. The Expo chain (#289) is now the *only* remaining source of package findings.

### Expo SDK 57 upgrade (#289)

**Posture of record (2026-08-15, head of the SDK 57 upgrade): 23 total — 0 critical, 14 high, 9 moderate, 0 low.** Read the *advisory* count, not the package count: **unique advisories fell 7 → 3**. The raw `high` figure went 12 → 14 while getting strictly better, because the surviving root cause fans out through slightly more packages in the SDK 57 tree than it did in SDK 54. Counting packages instead of advisories inverts the sign of this change — don't.

`apps/mobile` moved from Expo SDK 54 (`expo@54.0.33`, RN 0.81.5) to **SDK 57** (`expo@57.0.13`, RN 0.86.2). Target versions came from `expo@57.0.13`'s `bundledNativeModules.json`, which is the authority for an SDK's pinned peer set.

What the bump actually resolved, against the four allowlisted highs it was filed to clear:

- **Cleared (2):** both `postcss` advisories — `GHSA-6g55-p6wh-862q` (arbitrary file read via `sourceMappingURL`) and `GHSA-r28c-9q8g-f849` (path traversal via source-map auto-loading). They lived in the copy nested under `@expo/metro-config`, which SDK 57 no longer pins to a vulnerable version. Both entries are **deleted** from `scripts/npm-audit-allowlist.json`.
- **Not cleared (2):** both `image-size` advisories — `GHSA-w3rx-r6r6-pgpr` and `GHSA-5p2g-fcmc-qvqq`. **These have no upstream fix at any version:** the advisories cover `<=2.0.2` and `2.0.2` is the newest published release, while `metro` requires `image-size: ^1.0.2` in both `0.84.4` (shipped via `@expo/metro`) and `0.87.0` (current latest). No Expo or Metro release escapes it. Their allowlist entries are **kept**, with the reason text corrected — it previously claimed "fix requires the Expo SDK 57 major upgrade", which this upgrade disproved — and re-pointed to **#923**, which carries the policy decision. `expires` was deliberately left at 2026-11-15: failing closed is what forces a human to make that call.

Two gotchas worth not re-learning:

- **The React pin moves with the SDK.** SDK 57 requires React `19.2.3` exactly. Because the root `overrides` entry is global, mobile cannot take it while the override holds the old version — so all six manifests move in one commit. The pin stays *exact*; see [`AGENTS.md`](../../../AGENTS.md) § gotchas.
- **`npm install` alone silently keeps the old SDK.** `@expo/vector-icons` declares `expo-font: ">=14.0.4"` as a peer, and the previous SDK's `expo-font` still satisfies it, so npm leaves the whole SDK 54 chain hoisted at the root beside SDK 57 — with its vulnerabilities. Audit numbers taken in that state are wrong (they read *worse*: 28 findings / 7 advisories). Confirm a single `node_modules/expo` at the expected version before trusting any measurement. A blanket `rm -rf package-lock.json` fixes it but floats ~212 unrelated packages including silent majors; prune and re-resolve just the Expo/React/Metro entries instead.

### The gate (`dependency-audit`, issue #618)

`scripts/check-npm-audit.mjs` runs as the `dependency-audit` CI job on every PR and push (and in `npm run ci:local-gate`). Mechanics:

- Parses `npm audit --json --package-lock-only --include=dev --include=optional` at the **advisory** level (GHSA ids, case-normalized), not the package level, and **fails on any high/critical advisory absent from `scripts/npm-audit-allowlist.json`**. Moderate/low are reported, never blocking. The explicit `--include` flags stop a future `.npmrc` `omit`/`production` setting from silently shrinking the audited tree, and a gated-severity advisory whose GHSA id cannot be parsed is a hard failure, not a skip. Locally, `ci:local-gate` passes `--soft-network` so an offline dev is warned rather than blocked when the registry is unreachable (same convention as the secret scan's `--soft-missing`); CI never softens.
- Allowlist entries require `ghsa` + `reason` + `trackedBy` (GitHub issue) + `expires` (date). **An expired entry whose advisory is still live fails the gate** — accepted debt is time-boxed and must be re-triaged, not carried forever. Entries that no longer match anything are flagged stale for pruning. An empty allowlist blocks every high/critical, and a malformed list fails outright, so the gate cannot be neutralized by emptying or corrupting the list.
- Current allowlist: the four Expo-chain highs above, all `trackedBy: "#289"`, expiring 2026-11-15. **Zero critical entries.**
- The threshold is effectively `--audit-level=high` (the level the #618 escalation asked for), made landable by the sweep above; anything newly disclosed at high/critical goes red on the next PR or push.
- Unit tests: `scripts/ci/__tests__/check-npm-audit.test.mjs` (runs in `ci-scripts-tests`).
- **Blocking status:** `dependency-audit` is listed in `CI_CHECKS` in `scripts/ci/lib/required-checks.mjs`, which is the intended required set. Whether it is live on a given branch depends on when an admin last ran `npm run configure:branch-protection`; read live state per [`GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md#required-status-checks) rather than from this page.

### Prevention

When the gate goes red on a PR that did not touch dependencies, a new advisory was published upstream against the existing lockfile: fix it in-range if `npm audit fix`/`npm update <pkg>` can (see the #245/#684/#291 playbooks above), otherwise file or link the tracking issue and add a time-boxed allowlist entry in the same PR. Never widen an entry beyond the single GHSA id, and never land an entry without a tracking issue. The gate only fires on PR/push activity, so advisories against an untouched lockfile surface on the next PR — Dependabot (#848) is the tracked complement for proactive detection and bumps.

## `@sentry/nestjs` v9 → v10 (issue #682)

The one advisory chain the #831 sweep above could not clear in-range: `@sentry/nestjs@9.47.1` pulled `@opentelemetry/core@1.30.1`, carrying **GHSA-8988-4f7v-96qf** (unbounded memory allocation parsing W3C Baggage headers). Baggage propagation runs on every traced request, so the trigger surface was the whole hot path. `npm audit` reported `isSemVerMajor: true` — the fix only existed across a major boundary, which is why it was deferred to its own issue rather than folded into the sweep.

**Bumped `apps/api` to `@sentry/nestjs@^10.70.0`.** On the floor: #682's body (filed 2026-08-08) quotes `fixAvailable` as `10.69.0`, but re-running `npm audit --json` against `origin/main`'s lockfile today reports `10.70.0` — 10.70.0 published 2026-08-10, so the number moved between the issue being filed and the work being done, and 10.69.0 → 10.70.0 is a *minor*, not a patch. Either clears the advisory: both pull `@opentelemetry/sdk-trace-base ^2.9.0`, well above the `< 2.8.0` range, so the true minimum is lower than either number. `^10.70.0` was taken as current `latest`. This moves `@opentelemetry/core` to **2.10.0** and drops the audit from 39 findings to **22 — 0 critical, 12 high, 10 moderate**. All 17 cleared findings were the OpenTelemetry subtree.

### Why the major was safe here

v10's headline change is *"bump to OpenTelemetry v2"*, with `@sentry/nestjs` switching to OTel core instrumentation. Its removals — `BaseClient`, `hasTracingEnabled`, the `Logger` *type* and the debug logger (now `debug`, exported from `@sentry/core`, not `@sentry/nestjs`), the `_experiments.enableLogs`/`beforeSendLog`/`autoFlushOnFeedback` options, and browser-side FID collection — are **none of them reachable from this repo**. One correction for anyone grepping this list: **`logger` is still exported** in 10.70.0 — it is the Logs API (`fmt`/`debug`/`info`/`warn`/`error`/`fatal`/`trace`), a different thing from the removed debug logger, so a live `Sentry.logger` call site is not dead code. The Sentry surface at the time of the bump was five files: `Sentry.init` in `main.ts`, the `ErrorEvent` type in `sentry-scrubbing.ts` and its spec, and `withScope`/`captureException`/`captureMessage` in `all-exceptions.filter.ts` and its spec. This PR added two more — `sentry-options.ts` (which now holds the `init` options and imports `NodeOptions`) and `sentry-integration.spec.ts` — so anyone reusing this paragraph as the reachability checklist for the *next* major should audit **seven**. Peer ranges (`@nestjs/* ^8 || ^9 || ^10 || ^11` against this repo's 11.1.28) and `engines.node >= 18` both already held.

> **That seven-file checklist is out of date as of #865, and the shape of the audit changed with it.** The scrubbing rules moved to `packages/validation/src/sentry-scrubbing.ts`, which names **no** `@sentry/*` type at all — it cannot, because `apps/mobile` depends on `@repo/validation` and has no Sentry installed, so a type-only import would land in the emitted `.d.ts` and fail to resolve there. The SDK-typed surface is therefore now exactly the two thin app bindings (`apps/api/.../sentry-scrubbing.ts` and `apps/web/lib/sentry/options.ts`) plus the init sites, and `apps/web` added a second SDK — `@sentry/nextjs@^10`, deliberately the same major as `@sentry/nestjs` — with three initialized runtimes (browser, Node server, edge) rather than one. A next-major audit should start from `grep -rl "@sentry/" apps packages --include=*.ts --include=*.tsx` rather than from this paragraph's file count.

Reachability is only half a major-bump argument, so for completeness on the supply-chain half: v10 pulls a genuinely new vendor subtree — `@sentry/server-utils` → `@apm-js-collab/tracing-hooks` → `@apm-js-collab/code-transformer`, which brings `meriyah` (a JS parser) and `astring` (a code generator) into the API image. It is audit-clean and only reachable through the opt-in `experimentalUseDiagnosticsChannelInjection` loader, which this repo does not enable, but a parser and codegen arriving in a backend image is worth naming rather than leaving for someone to discover in a lockfile diff.

One v10 behavior change *does* land here, and it is worth stating precisely because the previous comment in `main.ts` described it wrongly. In v10, `sendDefaultPii: false` is **not** a "collect nothing" switch — it resolves through `defaultPiiToCollectionOptions` to a *key-based filter*. Verified by calling the SDK's own `filterKeyValueData` with the resolved options:

| Field | Result under `sendDefaultPii: false` |
| --- | --- |
| `authorization`, `cookie` headers | `[Filtered]` |
| `?token=…` and other sensitive-*named* params | `[Filtered]` |
| request bodies | not collected (`httpBodies: []`) |
| client IP | not inferred (`userInfo: false`) |
| `x-custom-note: "contact member@example.com"` | **passes through verbatim** |
| `?email=member@example.com` | **passes through verbatim** |

The filter matches on *key names*, so values under innocuously-named keys survive it. That is exactly the gap `redactFreeText` exists to close, and it is why `beforeSend` — not this flag — is the real enforcement point. The IP and body halves are genuinely off, so the net posture is at least as strong as v9's; the mechanism is just not the one the old comment claimed.

### The coverage gap this exposed

Before this change, **nothing in the repo exercised the real SDK.** `sentry-scrubbing.spec.ts` calls `scrubSentryEvent` as a plain function and `all-exceptions.filter.spec.ts` opens with `jest.mock('@sentry/nestjs')` — correct for what each tests, but between them no test would notice an SDK upgrade that silently stopped invoking `beforeSend`. Every existing Sentry test would have stayed green while the API shipped unscrubbed events.

`sentry-integration.spec.ts` closes that, and the **options come from `buildSentryOptions()`** — the same function `main.ts` calls, extracted in this PR for exactly that reason. `main.ts` ends in `void bootstrap()`, so it cannot be imported to inspect; without the extraction the spec had to re-declare the options, which made its assertions tautologies that read back the test's own literals. Now, deleting `beforeSend` or flipping `sendDefaultPii` in production fails the suite. All three cases are mutation-verified: replacing the scrubber with the identity function, flipping `sendDefaultPii`, and dropping `beforeSend` each turn the suite red.

It is hermetic by construction — a stubbed `transport` plus an `.invalid` DSN mean no envelope can leave the process on any runner — and its assertions read **what reached the transport**, not what `beforeSend` returned. That distinction is load-bearing: a draft that recorded `beforeSend`'s return value could not tell "the scrubber dropped this event" from "the scrubber never ran", and a scrubber mutated to return `null` for message events — silencing every auth-failure-spike alert — passed it 6/6.

The integration set is pinned (`defaultIntegrations: false` plus an explicit `contextLines` + `requestData`) because the **default set leaks a test environment per worker**, failing `jest --detectLeaks`. Measured 2×2: the integration set alone decides it — with defaults off, production's `tracesSampleRate` can stay on and the check still passes.

The mechanism is process-global `node:diagnostics_channel` subscriptions that `Sentry.close()` never unsubscribes. Isolated per integration: `childProcessIntegration` alone reproduces the failure (it subscribes to `child_process` and `worker_threads` with no teardown anywhere in the file), as do `httpIntegration` and `nativeNodeFetchIntegration`; `nodeContext`, `modules`, `console`, `processSession`, `onUncaughtException` and `localVariables` are all clean. Two earlier drafts of this paragraph got this wrong in opposite directions and both are worth recording: the first blamed `tracesSampleRate: 0` pulling in ~28 OpenTelemetry instrumentations (wrong trigger — `hasSpansEnabled` *is* a nullish check, so `0` does read as enabled, but that is not what leaked); the second "corrected" it by dismissing the `diagnostics_channel` mechanism entirely as gated behind `experimentalUseDiagnosticsChannelInjection`, which is a *different*, injection-based mechanism — the subscriptions above are unconditional and non-experimental.

`localVariablesIntegration` is excluded, but not because the `vars` rule is dead. It attaches nothing here only because `includeLocalVariables` is unset and the spec's error is never thrown — `captureAllExceptions` defaults to `true`, so caught exceptions are in scope in principle, `LocalVariablesAsync` ships in production's default set, and `sendDefaultPii: false` still resolves `stackFrameVariables: true`. A `vars` assertion in that file would therefore pass with `scrubException`'s `delete kept.vars` deleted; `sentry-scrubbing.spec.ts:151` covers it where it can actually fail.

**Scope, as originally shipped: error events only.** The SDK routes just those to `beforeSend`; transaction events go to `beforeSendTransaction`, which the API did not set, so they reached Sentry without passing through the scrubber at all. That was pre-existing (v9 split the hooks identically) rather than introduced here, and it was **closed by #896**, which added a second entry point — `scrubSentryTransaction` — rather than reusing the first. Reuse was never the fix: `spans` is absent from `EVENT_KEY_ALLOWLIST`, so pointing `beforeSendTransaction` at `scrubSentryEvent` would have shipped span-less traces silently. Both hooks are wired in `sentry-options.ts` today; see [`spec/behavior/observability.md`](../../../spec/behavior/observability.md) § Error Tracking for the current rules.

One testing note carried over from that work: the guard asserting transactions are not passed through unscrubbed is necessary but **not sufficient on its own**, because the wrong fix above redacts the transaction name correctly before dropping the spans — so it passes a redaction-only assertion. Span survival has to be asserted separately, which `sentry-integration.spec.ts` now does.

Writing the spec surfaced a second wrinkle worth knowing before anyone extends these tests: the SDK's `ContextLines` integration attaches the **source lines** around every stack frame, so a PII-shaped literal in a test file is echoed back into the event from disk. This defeats "value appears nowhere in the payload" assertions *and* silently satisfies "payload contains `[redacted:…]`" ones. An earlier draft asserted the latter against `JSON.stringify(event)`; mutating the scrubber to emit a *different* marker left that draft 4/4 green. (Replacing the scrubber with the identity function outright did fail it, on one assertion — an earlier version of this paragraph claimed otherwise and overstated how blind the draft was.) The fix is to assert against `exception.values[0].value` rather than the serialized event. Those frame-context fields pass through `scrubException` unredacted (it rebuilds frames by spread, deleting only `vars`), a denylist in a module that is otherwise deliberately allowlist-shaped — tracked separately in **#889**.

## Next.js advisory cleanup (issue #291)

### Overview

`next` was pinned at `^16.1.5` in `apps/web` and `apps/landing`, resolving to **16.2.6** — vulnerable to nine advisories (4 high: middleware/proxy bypass, Server Actions DoS, SSRF in Server Actions on custom servers, SSRF in rewrites; 5 moderate: two response-body cache-confusion variants, unbounded Edge Server Action payload, Image Optimization SVG DoS, unauthenticated Server Function endpoint disclosure). All are fixed in `>=16.2.11`; stable `16.3.0` clears the range.

### Why the pin bump alone was not enough

`geist` (a direct `apps/web` dependency) declares a peer `next: ">=13.2.0"`. After bumping both workspace pins to `^16.3.0`, npm installed `16.3.0` **nested** under each app but left the **hoisted** `node_modules/next` at the already-locked `16.2.6` to satisfy that peer — so the vulnerable copy stayed in the tree and `npm audit` was unchanged. Neither `npm dedupe` nor a root `overrides.next` entry moves an existing peer resolution.

This is the **same failure mode** as the "Check for a duplicate hoisted copy afterward" rule in the #245 Prevention section above, which #684 hit through `@nestjs/core`'s optional peer. Two independent runs have now been caught by an optional/declared peer silently retaining a vulnerable copy after the direct dependency was bumped; assume it will happen again and check for it every time.

The fix used here was to delete only the stale entries and let npm re-resolve them:

```sh
# remove `node_modules/next` and every `@next/swc-*` entry from package-lock.json, then:
npm install --package-lock-only
```

That collapses the tree to a **single hoisted `next@16.3.0`** with no nested duplicates, and touches ~445 lines of the lockfile instead of rewriting it.

**Try `npm update <pkg>` first.** The Prevention section's lever was not attempted here — `npm update next` may well have re-resolved the peer on its own, and it is the cheaper, better-documented path. Reach for entry deletion only after `npm update` has been tried and demonstrably left the old copy in place. Note the two are not in conflict: Prevention's warning is that `npm install --package-lock-only` will not re-check an **already-locked version against a changed override range**; here the entries were *removed* first, so npm had nothing to keep and had to resolve them fresh.

### Do not "fix" this with a full lockfile rebuild

`rm -rf node_modules package-lock.json && npm install` also clears the advisory — but on top of the 356-package churn the Prevention section already warns about, it **silently breaks every platform except the one that ran it**. npm records only the optional platform binaries matching the current host, so a rebuild on Linux x64 drops:

* `@next/swc-darwin-arm64` / `-darwin-x64` — the primary dev machines
* `@next/swc-win32-*`, `@next/swc-linux-arm64-*`
* 20 of the 24 `@img/sharp-*` variants, including `linuxmusl-arm64`

`npm ci` then succeeds on Linux x64 and CI stays green, while a Mac or ARM checkout fails to load the SWC binary. This is a **second, independent reason** not to delete the lockfile, and unlike the churn argument it is not merely a review-burden problem — it ships a broken install to every non-Linux developer while every gate stays green. If a full rebuild is ever unavoidable, diff the `@next/swc-*` and `@img/sharp-*` entry counts before and after and restore any platform that disappeared.

### Result

Measured on the merged tree (this change on top of #684/#699): `npm audit` **64 → 61** total, high **22 → 19**; `next` no longer appears and the nine advisories above are cleared. Because only the `next` entries were re-resolved, no unrelated dependency moved — `prettier` (3.8.3), `@playwright/test` (1.60.0) and the rest of the tree are byte-identical to `main`, so the visual-regression baselines and formatter output are unchanged. That was confirmed rather than assumed: CI's `web-visual-regression` job hit its browser cache on the unchanged Playwright version and every dashboard baseline matched, so `next@16.3.0` does not alter rendered output.

For contrast, the discarded full rebuild reported a larger drop by also moving unrelated packages whose ranges already permitted patched versions — `multer`, `undici`, `concurrently`/`shell-quote` and others. **`multer` and `undici` were the legitimately-tracked ones, and #684/#699 closed them properly in their own reviewed diff**, which is exactly the point: clearing them as an invisible side effect of a `next` bump would have put unreviewed dependency movement into a security PR, and would have collided with that work rather than composing with it.

The one `postcss` high advisory that previously rode in under `next`'s dependency chain now resolves solely through `@expo/metro-config` in the mobile tree — it belongs to the Expo SDK upgrade (#289), not to `next`.

## Security Fix: Unrestricted File Upload in Chapter Logos

### Overview
A high-severity security vulnerability related to unrestricted file uploads was identified and fixed in `apps/api/src/application/services/chapter.service.ts`.

### Details
Previously, the `requestLogoUploadUrl` method in `ChapterService` generated signed upload URLs without validating the provided `contentType` or file extension. This allowed an attacker to upload arbitrary files (e.g., `.html`, `.php`, `.exe`) to the branding storage bucket, posing a significant risk of Cross-Site Scripting (XSS) or other attacks if these assets were later served.

To fix this, the logo path began validating both the `contentType` header and the extracted file extension against an image allowlist (`image/jpeg`, `image/png`, and the rest of the `image` kind now in `@repo/validation`). If either check fails, a `BadRequestException` is thrown, preventing the generation of the signed URL for malicious files.

### Prevention
Always enforce strict content-type and extension allowlists when generating signed storage URLs for user-uploaded content.

## Security Fix: Upload-confirm storage path validation

### Overview
A high-severity tenant-isolation gap was fixed in `apps/api/src/application/services/backwork.service.ts` and `apps/api/src/application/services/chapter-document.service.ts`.

### Details
The upload-URL methods generate chapter-scoped storage paths (`chapters/{chapter_id}/backwork/{resource_id}/…` and `chapters/{chapter_id}/documents/{document_id}/…`) server-side, but `confirmUpload` persisted whatever `storage_path` the client submitted without validation. Later download flows mint signed download URLs from that persisted path, so a malicious or buggy client could register metadata pointing outside its own chapter folder and expose another object's signed download URL through a legitimate chapter-scoped resource.

Both `confirmUpload` methods now reject any `storage_path` that does not start with the caller's chapter prefix (`chapters/${chapter_id}/backwork/` and `chapters/${chapter_id}/documents/` respectively), throwing `BadRequestException` before any persistence. This mirrors the existing `ChapterService.confirmLogoUpload` branding-path validation. Download issuance was already scoped by `(id, chapter_id)`, so it remains correct.

### Prevention
When a client echoes back a server-generated storage path on a confirm step, always validate it against the expected chapter-scoped prefix before persisting metadata that later mints signed URLs.

## Security Fix: Chapter subscription read/write lock enforcement

### Overview
A critical-severity entitlement gap was fixed in `apps/api/src/interface/guards/chapter.guard.ts`. The `canceled` and `past_due` subscription states defined in [`spec/behavior/billing.md`](../../../spec/behavior/billing.md) and [`spec/behavior/data-retention.md`](../../../spec/behavior/data-retention.md) were modeled but never enforced at the API layer, so a canceled chapter could still create chat messages, events, invoices, tasks, points, backwork uploads, and other write operations.

### Details
`ChapterGuard` now loads `chapters.subscription_status` alongside the membership check and applies the spec's read/write lock at the request boundary. Reads (GET / HEAD / OPTIONS) remain allowed for every status (matching §26's "all data preserved indefinitely in read-only mode"). Writes are gated by status × route classification:

- `canceled` — all chapter-scoped writes return `403` with code `chapter.subscription.canceled`. The hard lock applies even to free-tier modules, matching [`data-retention.md`](../../../spec/behavior/data-retention.md) ("cannot create new content, invite members, or perform any write operations").
- `past_due` — paid-ops writes return `403 chapter.subscription.write_locked`. Free-tier writes (chat, members, invites, roles, chapter config, user profile, search, chapter admin) continue to work, honoring the Chunk 03 free-tier wedge in [`onboarding.md`](../../../spec/behavior/onboarding.md) ("Inviting members is free-tier and not billing-gated").
- `incomplete` — paid-ops writes return `403 chapter.subscription.required`. Free-tier writes continue so a brand-new chapter can chat and invite before completing checkout.
- `active` — all writes allowed.

Two new decorators in `apps/api/src/interface/decorators/subscription.decorator.ts` classify controllers: `@FreeTier()` marks the chat / members / invites wedge plus chapter admin (so admins can still manage the chapter while past_due / incomplete); `@SubscriptionExempt()` is used on `BillingController` so admins can always reach Checkout / portal to recover from a locked state. Default (unmarked) controllers are paid-ops and fail closed.

The `canPerformWriteAction` / `canPerformReadAction` utilities in `apps/api/src/domain/utils/subscription.ts` (previously dead code referenced only by tests) now back the live enforcement path.

### Prevention
New chapter-scoped controllers default to paid-ops (fail-closed): writes are blocked when the chapter is `past_due`, `incomplete`, or `canceled` unless the controller is explicitly marked `@FreeTier()` or `@SubscriptionExempt()`. The subscription decorator wiring is asserted by `apps/api/src/interface/decorators/subscription.decorator.spec.ts` so any drift between the spec classification and the actual decorators trips a unit test.

### Known follow-up
~~The Supabase Edge Functions on the chat hot path (`supabase/functions/chat-send`, `supabase/functions/chat-react`) bypass the NestJS guard and currently have no subscription check, so a canceled chapter can still post chat via the edge path. Tracked separately as issue #305.~~ **Closed by ADR-11 / #416:** the chat hot path now runs inside `ChatController` and inherits `@FreeTier()` + `SubscriptionGuard` like every other NestJS chat route. The bypass surface is gone.

## Security Fix: Cross-tenant chat reaction read leak (`chat_message_actions` RLS)

### Overview
A high-severity multi-tenant isolation gap was fixed in the Row-Level Security for `chat_message_actions` (per-user reactions / poll votes). The gap was introduced by `supabase/migrations/20260523150000_chat_hotpath.sql` and corrected in `supabase/migrations/20260803150000_chat_message_actions_membership_rls.sql` (FRA-38 / #279).

### Details
The table's `SELECT` policy was `using (auth.role() = 'authenticated')`, so **any** authenticated Supabase user could read **every** action row across all chapters, private/DM channels, and role-gated channels. This was not purely theoretical: the web client reads `chat_message_actions` **directly under the user's JWT** (RLS-enforced) — an initial reaction backfill (`apps/web/lib/chat/use-chat-channel.ts`) and a *global* Supabase Realtime `postgres_changes` subscription (`packages/chat-core/src/realtime-manager.ts`), the latter with **no** application-layer channel filter, so RLS was the only gate. A user in chapter A could observe reaction/vote rows for messages in chapter B (and in private/DM/role-gated channels they could not otherwise see) — confirmed by reproducing the read as the `authenticated` role against a local database before the fix (a chapter-B user counted a chapter-A action row; 0 after the fix).

The fix keeps the table readable by the web client but scopes the `SELECT` policy to channel visibility, mirroring the canonical `canAccessChannel` predicate (`@repo/validation`):

```sql
using (auth.role() = 'authenticated' and public.can_read_chat_message(message_id))
```

Because the referenced tables (`chat_messages`, `chat_channels`, `members`, `roles`) are default-deny under the invoking `authenticated` role, a plain sub-select in the policy would return nothing and deny all reads; the membership lookup therefore runs inside a `SECURITY DEFINER` helper `public.can_read_chat_message(uuid)` (with `set search_path = public`; `execute` revoked from `public`/`anon`, granted only to `authenticated`/`service_role`). The helper enforces chapter membership plus the per-type rule (`PUBLIC` → any member; `PRIVATE`/`DM`/`GROUP_DM` → `member_ids`; `ROLE_GATED` → `*` or a matching `required_permissions`). The INSERT/DELETE policies (own-row scoped) and the service-role write path are unchanged, so hot-path writes are unaffected.

The policy is additionally scoped `TO authenticated`. That is load-bearing rather than cosmetic: `execute` on the helper is revoked from `anon`, so an anon read either returns zero rows or dies with `42501 permission denied for function`, depending on whether the planner evaluates the cheap `auth.role() = 'authenticated'` conjunct before the function call. Both outcomes were reproduced on PG 17.5 — short-circuiting spares the call when the role conjunct is evaluated first, and the error appears when the function is reached without EXECUTE. Postgres does not contractually fix that ordering (it costs quals and may reorder, and hoisting `auth.role()` into an initplan per FRA-291 changes the shape again), and `use-chat-channel.ts` discards the error, so the failure would be silent. The role clause removes the dependency on plan shape: anon never reaches the qual. (The migration emits the clause through `format()` guarded on `pg_roles`, because bare-Postgres substrates such as the PGlite CI harness have no `authenticated` role.)

The change touches no table columns and adds only an internal RLS-only function, so the curated `apps/api/src/infrastructure/supabase/database.types.ts` (which tracks table shapes and app-invoked RPCs, not internal helpers) needs no edit.

### Replica identity: deliberately left at the default
An earlier draft of this fix set `chat_message_actions` to `REPLICA IDENTITY FULL`, reasoning that Realtime evaluates the SELECT policy against the old row image to decide DELETE-event delivery, so `message_id` had to be present or un-reaction events would be dropped for every subscriber. **That reasoning is wrong in both halves**, per Supabase's Realtime Postgres Changes documentation:

> RLS policies are not applied to `DELETE` statements, because there is no way for Postgres to verify that a user has access to a deleted record. When RLS is enabled and `replica identity` is set to `full` on a table, the `old` record contains only the primary key(s).

So DELETE events are never RLS-filtered (they were never at risk of being dropped), and with RLS enabled the `old` record is trimmed to primary keys regardless — `FULL` could not supply `message_id` even if it were needed. It would be permanent WAL cost on every delete for no benefit, plus a false invariant baked into CI. The client never needed more than the key: `dispatchActionDelete(old.id)` resolves removals through its local `cache.actionIndex`, which only holds actions whose INSERT it was legitimately delivered — and INSERT events **are** RLS-filtered by this policy.

### Residual, not closed by this fix
Because Realtime never applies RLS to DELETE, the unfiltered `chat:actions:global` subscription still fans a bare action `id` out to every authenticated subscriber, cross-chapter. That id is opaque — no message, user, chapter, or payload — and clients ignore ids absent from their own cache, so it discloses only that *some* action somewhere was removed. Scoping that subscription per-channel is tracked as **FRA-291**.

The INSERT/DELETE policies are deliberately unchanged (this issue is read-scoped), and it is worth recording why the obvious write-side worry does **not** apply. Those policies gate on `user_id in (select id from users where supabase_auth_id = auth.uid())`, and `users` is default-deny, so the subselect yields nothing and *every* direct-client write is refused — verified against the local stack as the `authenticated` role, where both a cross-chapter write and a legitimate own-channel write were denied `42501`. A member cannot, therefore, poison a poll tally by POSTing an action row for a message they can no longer read: the write path is already closed. It is closed by accident rather than by design, which is the real defect, and that the policies are effectively no-ops is tracked as **FRA-293**. Genuine hot-path writes are unaffected because they run through the Edge Function / API under `service_role`, which bypasses RLS entirely.

### Verification
The leak was reproduced and confirmed closed against a **local Supabase Postgres** instance, executing as the real `authenticated` role with `request.jwt.claims` set per user: pre-fix a chapter-B user counted **2** chapter-A action rows; post-fix **0**, while a member of the private channel still read 2 and a chapter member outside it read 1 (public only). The seeded transaction was rolled back.

Regression coverage in `scripts/check-pglite-migrations.mjs` is in three tiers:

1. **Catalog shape** — exactly **one** permissive read-applicable policy. The filter is `polpermissive and polcmd in ('r','*')`: Postgres ORs permissive policies together, and a `FOR ALL` policy also applies to SELECT, so a second one of either spelling would silently re-open this exact leak. Plus `SECURITY DEFINER` with `search_path` pinned to `public`, EXECUTE revoked from PUBLIC, replica identity still default, and `users` still carrying no client-reachable permissive SELECT policy.
2. **Predicate** — a seeded tier driving `can_read_chat_message` directly across 15 cases (own-chapter, cross-chapter, `PRIVATE` in/out, `DM` in/out, `GROUP_DM` in/out, `ROLE_GATED` with/without permission, `*` wildcard, empty requirement, a chapter-B role id held by a chapter-A member, an uppercase stored role id, null `auth.uid()`).
3. **Black-box enforcement** — reads the table through `SET ROLE` as an unprivileged probe role, asserting visible row counts per user. This tier is what actually pins the guarantee: the shape check is substring-shaped and defeatable (`... AND can_read_chat_message(message_id) IS NOT NULL` is constant-true; De Morgan spells an OR with only `AND`/`NOT`), and all such rewrites were confirmed to pass tier 1 and fail tier 3.

Two gaps remain, both promotion-time checks rather than CI ones (see `DB_PROMOTION_RUNBOOK.md`): PGlite has no `anon` role, so the EXECUTE assertion checks only the PUBLIC bit while hosted Supabase grants `anon` directly; and it has no `authenticated` role, so the `TO authenticated` clause is never exercised. Full end-to-end enforcement under a real JWT stays deferred to the NestJS tier (#423).

### Prevention
For any table a browser/mobile Supabase client reads **directly** — especially over a Realtime subscription, where RLS is the sole gate — the RLS `SELECT` policy must encode the full tenant + channel-visibility rule; do not rely on "the app layer filters it." When such a policy must read default-deny tables, wrap the lookup in a `SECURITY DEFINER` helper with a pinned `search_path` and least-privilege `execute` grants, and mirror the single shared access predicate (`canAccessChannel`) rather than duplicating ad-hoc logic.

## Security Fix: Unfiltered chapter channel list (#1001)

### Overview
`GET /v1/channels` returned **every** channel in the caller's chapter, unfiltered, to anyone holding `members:view` — including `PRIVATE`, `ROLE_GATED`, `DM` and `GROUP_DM` channels the caller was not in. `GET /v1/channels/{id}` had the same hole for a single channel. Message bodies were never exposed (`getMessages` has always asserted channel access), but channel *existence, names, descriptions, required permissions, and DM participant ids* were.

Pre-existing; not introduced by the mobile chat work that surfaced it. Both clients were affected — the web sidebar and the mobile channel list rendered from the same endpoint, and the web polls page fed the same response into a "filter by channel" dropdown.

### Details
The route's handler never received a user id, so per-user filtering was structurally impossible below it: `listChannels` took only the chapter, and `getChannels(chapterId)` returned `channelRepo.findByChapter(chapterId)` verbatim. The repository issues `select('*')` on the **service-role** client, which bypasses RLS, and `chat_channels` has RLS enabled with **zero policies** (`supabase/migrations/00000000000000_initial_schema.sql`) — so the service layer was not merely the first line of defence, it was the only one.

The disclosure is larger than a list of names. `member_ids uuid[]` ships in the row, and direct-message channels are server-named `dm-<sortedUuidA>-<sortedUuidB>`, so each DM pair leaked through two independent fields. Any member could reconstruct the chapter's complete direct-message social graph — who is in a private conversation with whom — plus the name, description and `required_permissions` of every private and role-gated channel.

The inconsistency was internal to one file: `getUnreadCounts`, two methods away, already filtered its rows through the shared batch predicate, on the reasoning that an unread count alone reveals that a DM between two other members exists and is active. So the endpoint returning *counts* was access-checked while the endpoint returning *the channels themselves, by name* was not.

The fix routes both reads through the existing `ChannelAccessService`: the list through a new array-taking `filterAccessibleChannels`, the single read through `assertChannelAccess`. The new method exists because the list endpoint already holds the rows — resolving its ids back through the id-taking `filterAccessibleChannelIds` would have re-read the chapter's channels a second time on every request. Both entry points share one predicate loop, so they cannot drift.

The `channels:manage` mutations (`PATCH`/`DELETE`) deliberately keep resolving a channel chapter-scoped only, through a private `requireChannelInChapter`. An officer is authorized to edit or delete a channel by that permission, not by membership of it; running the per-user predicate there would have started 403ing officers on private channels they administer but do not belong to.

That leaves a real asymmetry, and this change **introduces** it rather than merely exposing it: before, `getChannel` was chapter-scoped only, so a `channels:manage` holder could both list and GET any channel in their chapter. Now they can still PATCH and DELETE a `PRIVATE` or `ROLE_GATED` channel they are not in, but neither read surface will show it to them — `GET /v1/channels` filters it out and `GET /v1/channels/{id}` 403s. The mutations survive; the only two ways to discover the id do not. Nothing breaks today because `useChannel`, `useUpdateChannel` and `useDeleteChannel` have no consumers in either client, but the first channel-administration screen built on them will need a manage-scoped enumeration path rather than the member-scoped list. That is a product decision, not a filtering one, so it is left open here deliberately.

### Verification
Unit coverage was added at both layers, because the defect lived at both. At the service layer, tests assert a member sees public channels plus their own DM and private channel, and specifically that another pair's DM is absent **by id, by `name`, and by `member_ids`** — the pair leaks through two fields, so one assertion would not have proven it closed. Role-gated visibility is covered with and without the permission, along with the non-member and empty-chapter paths. At the controller layer, tests assert each handler threads the caller's id to the service; that is where the original bug actually was, since the handler had no id to pass.

Two tests pin properties a future refactor could silently undo: that the chapter's channels are read **exactly once** per list request, and that `updateChannel`/`deleteChannel` still resolve a channel the caller is not a member of.

The `getChannels` tests were confirmed to fail against the unfiltered implementation before the fix was restored — five of them, including the DM case. (That count is for reverting `getChannels` alone; reverting `getChannel` to its pre-fix body as well fails a sixth, the PRIVATE rejection.) An independent review pass separately mutated the filter to a pass-through and to an always-empty return, confirming the assertions are neither vacuous nor satisfied by over-filtering.

### Residual, not closed by this fix
`chat_channels` still has RLS enabled with no policy, so there is no database-layer backstop; the service filter remains the only control. Direct client reads are denied outright (default-deny with no policy), so this is a defence-in-depth gap rather than a live leak. Tracked as **#1009** — an RLS change is E2-class and not a drive-by.

The repository's `select('*')` is likewise unchanged. For channels that survive the filter the caller is a member, so `member_ids` is legitimately theirs; the over-fetch only mattered in combination with the missing filter. Narrowing the projection is **#986**.

**A `PRIVATE` channel created through `POST /v1/channels` is now invisible to everyone, including its creator.** `createChannel` never populates `member_ids`, and `canAccessChannel` resolves PRIVATE as `(member_ids ?? []).includes(userId)` with no wildcard bypass — so the filter denies every caller. The channel was already unreadable before this fix (`getMessages` has always used the same predicate); what changed is that it no longer appears in the list either, so the id cannot be recovered from any read surface. Pre-existing data-model gap, made consequential here. Tracked as **#1008**.

The query cost of `GET /v1/channels` rises from 1 to roughly 5: the channel read, the filter's member lookup, and `getEffectivePermissions`' own member read plus two role lookups. The `needsPermissions` short-circuit reads like an optimization but effectively never fires, because `#alumni` is seeded `ROLE_GATED` into every chapter by `DEFAULT_CHANNELS` — the permission path is the common case, not the exception. Cost is constant in chapter size and matches what `GET /v1/channels/unread` already pays on the same screen.

Two of those reads are redundant rather than merely additive: `ChapterGuard` has already resolved and pinned the caller's member row at `request.member`, and `PermissionsGuard` has already flattened the same effective-permission set, both earlier in the same request. The reuse point is therefore the guard chain — an existing `@CurrentMember()` decorator already exposes the row — not `RbacService`'s signature. Left alone here to keep this change to the filter.

### Prevention
Any chapter-wide list endpoint over a per-user-visible resource must go through `ChannelAccessService`. A route-level permission gate scopes the **tenant**; it never scopes the **row**. When a handler cannot filter because it has no caller identity, that is the bug — thread the id rather than assuming the guard covered it. And treat metadata as content: names, membership arrays and server-generated identifiers can disclose a relationship as completely as the messages inside it.

## Chapter payload over-exposure on the member-facing reads (issue #930)

### Overview
`GET /v1/chapters/current` returned the entire `chapters` row to any caller holding `members:view` — which is every member of the chapter, not just officers. `SupabaseChapterRepository.findById` is `select('*')`, `ChapterService.findByIdWithLogoUrl` spread the result, and no response DTO stood between the row and the wire. Members could read `stripe_customer_id`, `subscription_id`, `past_due_since`, `last_stripe_webhook_at`, the three `legal_accepted_*` columns, and `beta_config`.

`GET /v1/chapters` leaked the same columns from the same root cause: `mapMembershipSummary` embedded the raw chapter object, so the chapter-picker payload carried them **for every chapter the caller belongs to**, on a route with no billing permission at all. `packages/hooks/src/use-chapters.ts` already typed `stripe_customer_id` and `subscription_id` on that response, so this was live rather than theoretical.

This is over-exposure **inside** a tenant, not a cross-tenant leak. `ChapterGuard.resolveChapterContext` still hard-403s a JWT/header mismatch (`chapter.context.mismatch`), so no caller could read another chapter's row through either route.

A third surface leaked the same columns through the *write* path. `PATCH /v1/chapters/current` admits `roles:manage` **or** `billing:manage`, and returned the updated row verbatim — so a custom role carrying `roles:manage` without `billing:view` read the identifiers straight out of the write response. Custom roles take arbitrary permission sets (`chapter_custom_roles`), so that combination is constructible, not hypothetical. Found while verifying the two read routes against a running instance.

### Details
All three exits now go through `toChapterMemberView` (`apps/api/src/application/services/chapter-member-view.ts`), a single allowlist projection.

The projection **iterates the allowlist** rather than spreading the row and deleting sensitive keys. That distinction is the fix, not a style choice: the delete-based form fails open, so the next migration that adds a private column publishes it by default and nothing reports it. Iterating means a new column is withheld until someone adds it to the allowlist deliberately.

`stripe_customer_id` and `subscription_id` needed no new home — `GET /v1/billing/status` already returns exactly those two, and `BillingController` requires `billing:view` at class level. The web billing page was already reading them from there, so removing them from the chapter payload had no client half.

Two fields stay in the payload deliberately, and the tests say so loudly. `subscription_status` and `past_due_since` are what the client subscription mirror reads (`useSubscriptionWriteState`), and `isWithinSubscriptionGrace(null)` **fails open** — so dropping either would throw nothing, break no type, and leave every client rendering grace-window affordances while the server hard-locked the same writes. The narrowing that fixes a leak is one edit away from causing that, which is why it is pinned at both the projection and the service layer.

The write route keeps its `Chapter` return type on `ChapterService.update` — the projection happens at the controller, so internal callers are untouched. `CurrentChapterResponseDto` also replaced a contract that declared `content: never` for this operation — the SDK typed the response as nothing at all (the slice of #1049 that applies here). The DTO and the runtime allowlist are tied together by compile-time guards, so adding a field to one without the other fails the build by name. `oasdiff` reports the change as non-breaking, since the operation previously declared no response body.

### Verification
`chapter-member-view.spec.ts` asserts the identifiers are absent both by key and by a serialized scan of the whole payload — a future field that embeds them (a `billing` blob, a debug echo) would pass a `toHaveProperty` check and fail this one. AC #4 is covered by injecting a column the projection has never heard of and asserting it does not appear, which passes without editing the test file — that is the property under test.

At the service layer, both endpoints are covered directly. The `listForUser` test previously asserted `chapter: chapters[0]` — the whole row — which **pinned the leak**; it now asserts the projection plus explicit negative assertions on the three identifier columns, so a regression fails here even if the projection helper's own contract changed.

Full suite green at the time of the fix: 131 API suites / 2343 tests, 72 web files / 821 tests, and `check-types` clean for api, web and mobile.

### Residual, not closed by this fix
The repositories still issue `select('*')`; the projection is at the service boundary, so every internal caller (billing, report export, the Stripe webhook path) keeps the full row it legitimately needs. Narrowing the repository read is a larger change with many callers and is not required to close the exposure.

`GET /v1/chapters` still declares no response schema in the contract, so its payload shape remains untyped for clients even though it is now projected. That is #1049's scope, not this fix's.

The issue's own impact table lists `past_due_since` as a column that should not be member-readable, while its acceptance criteria require it to keep reaching the client. The criteria won here. If the intent was to move the grace signal behind a permission, that is a separate change with a client half, since the mirror would need another source.

### Prevention
A route whose permission gate admits every member is not a projection. Any handler returning a row read with `select('*')` needs an explicit allowlist between the row and the response, and that allowlist must be **iterated, not subtracted from**, so new columns are private by default. When you narrow a payload, first enumerate the consumers of every field you are dropping across `apps/web`, `apps/mobile` and `packages/` — and be most careful with fields whose absence is *absorbed* rather than thrown, because those degrade silently and no test will tell you.

## `search_path` shadowing in `SECURITY DEFINER` functions (#985)

### Overview
Seven `SECURITY DEFINER` functions in `public` were declared `set search_path = public`. Postgres
resolves unqualified relation names against `pg_temp` **first** when `pg_temp` is not itself listed,
so a caller-created temp table shadowed the real table inside those functions while they ran with the
definer's privileges. Four are authorization code: `can_read_chat_message` backs chat RLS, and
`realtime_can_read_chapter_scope` / `_event_scope` / `_user_scope` gate realtime topic delivery — a
shadowed read there is an authorization decision made against attacker-supplied rows.

### Details
Fixed in `supabase/migrations/20260827190000_secdef_search_path_pg_temp.sql`, which redefines all
seven with `set search_path = public, pg_temp`. Bodies are unchanged. `20260816190000` had already
applied the same fix to `get_channel_unread_counts` (#983); this completed the sweep.

Reachability, stated plainly: there is no known path to this from the app surface today — PostgREST
exposes no arbitrary SQL and the Supabase client can only invoke defined RPCs, so triggering it
requires a session that can execute DDL. It becomes live the moment anything grants broader SQL
access (a direct connection string, a psql-capable admin tool, or an RPC that runs caller-supplied
SQL). Treated as defense-in-depth on authorization-critical code rather than an active incident, which
is why it was P2 and not P1. This is also what Supabase's advisor reports as "Function Search Path
Mutable".

### Prevention
Declare every `SECURITY DEFINER` function `set search_path = public, pg_temp`, with `pg_temp` **last**
— listing it first reinstates the defect. `scripts/check-pglite-migrations.mjs` enforces this against
the applied catalog (the `security definer search_path` tier) and fails the `pglite-migrations` job on
any function that does not, so the eighth one cannot land silently. The check reads the catalog rather
than scanning migration SQL, because migrations are immutable — the three files that introduced the
bare setting keep it in their text permanently, and only the end state is meaningful.
