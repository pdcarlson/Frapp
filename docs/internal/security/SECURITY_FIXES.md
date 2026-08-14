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

- **Root `overrides`** (in `package.json`) force patched versions of transitive packages without requiring upstream releases. The override pattern is the canonical lever for transitive CVEs in this monorepo — extend it rather than patching individual workspaces. The `@xmldom/xmldom` override uses an unbounded floor (`>=0.8.13`) so consumers that declared a higher major (`jsdom@29`, `expo-server-sdk@5`, `plist@3`) retain it. The `undici` override is bounded — `>=7.29.0 <8.0.0` — because undici `8.x` raises its engine to `node>=22.19.0`, which trips `EBADENGINE` and crashes `npm ci` in the `node:20-alpine` Docker base used by `apps/api`. **Only lift the `<8.0.0` cap after** the repo's `engines.node` is bumped to `>=22.19.0`, the `apps/api` Dockerfile base image is moved off `node:20-alpine`, and CI's `setup-node` matrix is updated to match. The floor was raised from `>=6.24.0` in #699 — see [undici floor](#undici-floor-raised-off-the-vulnerable-7x-band-699) below. Note the floor is only a *lower* bound on an override npm always resolves to the max of, so it does not by itself pick the version; it exists to stop a future resolution from sliding back under the advisory. undici `7.29.0` declares `engines.node >=20.18.1`, which every real runtime here satisfies (Docker `node:20-alpine`, all CI jobs on `node-version: 20`) even though root `engines.node` still reads `>=18`.
- **`@nestjs/*` patch bumps** in `apps/api/package.json` (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/swagger`, `@nestjs/config`, `@nestjs/cli`, `@nestjs/schematics`, `@nestjs/testing`) close the direct-dep high CVEs (NestJS injection, lodash, path-to-regexp, multer). The `vite` and `lodash` advisories cleared via the NestJS / vite transitive bumps that rode along, not via overrides.
- ~~**`@infisical/cli`** kept pinned at `0.43.40` (matches main). Newer `0.43.80+` declares `tar ^7.5.13` natively but breaks the `apps/api` Docker build during the preinstall (`tar.x` extraction in `node:20-alpine` fails consistently). The two resulting high advisories (`@infisical/cli` and its nested `tar`) are accepted as **dev-only install-time exceptions**~~ — **superseded (#831/#618 sweep): the pin is now `0.43.121` and the exception is lifted.** Re-tested at `0.43.121`, whose preinstall extracts with node-tar `7.5.22`; a full Dockerfile deps-stage `npm ci` inside `node:20-alpine` completes with a working binary, so the tar advisories are fixed rather than excepted — see "npm audit sweep + CI gate" below. (`@infisical/cli` remains a root `devDependencies` entry used only by `npm run dev:*` scripts, excluded from production runtime by the `apps/api` Dockerfile `prod-deps` stage.)

### Result

`npm audit` **at the time of #245**: **0 critical, 2 high (dev-only, see above), 26 moderate**. All 642 `apps/api` unit tests pass; full monorepo `check-types`, `lint`, and `apps/api` production build are clean.

**Current baseline (re-measured 2026-08-08, at the head of #684/#699): 64 total — 4 critical, 22 high, 38 moderate, 0 low.** The drift since #245 is upstream advisory disclosure against dependencies this repo has not moved, not a regression introduced by a change here. The four criticals are `@xhmikosr/decompress`, `concurrently`, `shell-quote`, and `tar` — `concurrently` is a direct root `devDependencies` entry and is tracked in #730; the rest sit in the Expo/Metro and archive-extraction tooling trees. ~~Treat *this* line as the posture of record, not the #245 line above it.~~ **Superseded — the posture of record now lives in "npm audit sweep + CI gate" below, and the CI `dependency-audit` gate keeps it honest from here on.**

### Remaining moderate advisories (deferred, tracked as issues)

- **Expo SDK 54 → 56 upgrade** (closes ~16 of the 26 remaining moderates): #289
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

### The gate (`dependency-audit`, issue #618)

`scripts/check-npm-audit.mjs` runs as the `dependency-audit` CI job on every PR and push (and in `npm run ci:local-gate`). Mechanics:

- Parses `npm audit --json --package-lock-only --include=dev --include=optional` at the **advisory** level (GHSA ids, case-normalized), not the package level, and **fails on any high/critical advisory absent from `scripts/npm-audit-allowlist.json`**. Moderate/low are reported, never blocking. The explicit `--include` flags stop a future `.npmrc` `omit`/`production` setting from silently shrinking the audited tree, and a gated-severity advisory whose GHSA id cannot be parsed is a hard failure, not a skip. Locally, `ci:local-gate` passes `--soft-network` so an offline dev is warned rather than blocked when the registry is unreachable (same convention as the secret scan's `--soft-missing`); CI never softens.
- Allowlist entries require `ghsa` + `reason` + `trackedBy` (GitHub issue) + `expires` (date). **An expired entry whose advisory is still live fails the gate** — accepted debt is time-boxed and must be re-triaged, not carried forever. Entries that no longer match anything are flagged stale for pruning. An empty allowlist blocks every high/critical, and a malformed list fails outright, so the gate cannot be neutralized by emptying or corrupting the list.
- Current allowlist: the four Expo-chain highs above, all `trackedBy: "#289"`, expiring 2026-11-15. **Zero critical entries.**
- The threshold is effectively `--audit-level=high` (the level the #618 escalation asked for), made landable by the sweep above; anything newly disclosed at high/critical goes red on the next PR or push.
- Unit tests: `scripts/ci/__tests__/check-npm-audit.test.mjs` (runs in `ci-scripts-tests`).
- **Blocking status:** `dependency-audit` is listed in `scripts/configure-branch-protection.mjs` under the standard ROLLOUT caveat — after this lands on `main` and runs green once, re-run `npm run configure:branch-protection` to make it a required check (see `docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md`).

### Prevention

When the gate goes red on a PR that did not touch dependencies, a new advisory was published upstream against the existing lockfile: fix it in-range if `npm audit fix`/`npm update <pkg>` can (see the #245/#684/#291 playbooks above), otherwise file or link the tracking issue and add a time-boxed allowlist entry in the same PR. Never widen an entry beyond the single GHSA id, and never land an entry without a tracking issue. The gate only fires on PR/push activity, so advisories against an untouched lockfile surface on the next PR — Dependabot (#848) is the tracked complement for proactive detection and bumps.

## `@sentry/nestjs` v9 → v10 (issue #682)

The one advisory chain the #831 sweep above could not clear in-range: `@sentry/nestjs@9.47.1` pulled `@opentelemetry/core@1.30.1`, carrying **GHSA-8988-4f7v-96qf** (unbounded memory allocation parsing W3C Baggage headers). Baggage propagation runs on every traced request, so the trigger surface was the whole hot path. `npm audit` reported `isSemVerMajor: true` — the fix only existed across a major boundary, which is why it was deferred to its own issue rather than folded into the sweep.

**Bumped `apps/api` to `@sentry/nestjs@^10.70.0`** (`10.69.0` was the audit's stated floor; `10.70.0` was `latest` at the time and avoids landing one patch stale). This moves `@opentelemetry/core` to **2.10.0** and drops the audit from 39 findings to **22 — 0 critical, 12 high, 10 moderate**. All 17 cleared findings were the OpenTelemetry subtree.

### Why the major was safe here

v10's headline change is *"bump to OpenTelemetry v2"*, with `@sentry/nestjs` switching to OTel core instrumentation. Its removals — `BaseClient`, `hasTracingEnabled`, the `logger`/`Logger` export, the `_experiments.enableLogs`/`beforeSendLog`/`autoFlushOnFeedback` options, and browser-side FID collection — are **none of them reachable from this repo**. The Sentry surface at the time of the bump was five files: `Sentry.init` in `main.ts`, the `ErrorEvent` type in `sentry-scrubbing.ts` and its spec, and `withScope`/`captureException`/`captureMessage` in `all-exceptions.filter.ts` and its spec. This PR added two more — `sentry-options.ts` (which now holds the `init` options and imports `NodeOptions`) and `sentry-integration.spec.ts` — so anyone reusing this paragraph as the reachability checklist for the *next* major should audit **seven**. Peer ranges (`@nestjs/* ^8 || ^9 || ^10 || ^11` against this repo's 11.1.28) and `engines.node >= 18` both already held.

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

The integration set is pinned (`defaultIntegrations: false` plus an explicit `contextLines` + `requestData`) because the **default set leaks a test environment per worker**, failing `jest --detectLeaks`. Measured 2×2: the integration set alone decides it — with defaults off, production's `tracesSampleRate` can stay on and the check still passes. An earlier draft of this section blamed `tracesSampleRate: 0` loading ~28 OpenTelemetry instrumentations; that is wrong, and the `diagnostics_channel` mechanism it described is gated behind `experimentalUseDiagnosticsChannelInjection`, which this repo never enables. (`hasSpansEnabled` *is* a nullish check, so `tracesSampleRate: 0` does read as enabled — it just is not what caused the leak.) `localVariablesIntegration` is excluded on purpose: it populates `frame.vars` only for uncaught exceptions, so a test asserting `vars` is stripped would pass with that rule deleted — `sentry-scrubbing.spec.ts:151` covers it where it can actually fail.

**Scope, stated plainly: this covers error events only.** The SDK routes just those to `beforeSend`; transaction events go to `beforeSendTransaction`, which the API does not set, so they reach Sentry without passing through the scrubber at all. That is pre-existing (v9 split the hooks identically), not introduced here, and it is **not** fixable by pointing `beforeSendTransaction` at `scrubSentryEvent` — `spans` is absent from `EVENT_KEY_ALLOWLIST`, so doing so would silently ship span-less traces. Tracked in **#896**.

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

To fix this, strict whitelists were implemented using JavaScript `Set`s for `ALLOWED_LOGO_CONTENT_TYPES` (e.g., `image/jpeg`, `image/png`) and `ALLOWED_LOGO_EXTENSIONS`. Both the `contentType` header and the extracted file extension are now validated against these whitelists. If either validation fails, a `BadRequestException` is thrown, preventing the generation of the signed URL for malicious files.

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
The table's `SELECT` policy was `using (auth.role() = 'authenticated')`, so **any** authenticated Supabase user could read **every** action row across all chapters, private/DM channels, and role-gated channels. This was not purely theoretical: the web client reads `chat_message_actions` **directly under the user's JWT** (RLS-enforced) — an initial reaction backfill (`apps/web/lib/chat/use-chat-channel.ts`) and a *global* Supabase Realtime `postgres_changes` subscription (`apps/web/lib/chat/realtime-manager.ts`), the latter with **no** application-layer channel filter, so RLS was the only gate. A user in chapter A could observe reaction/vote rows for messages in chapter B (and in private/DM/role-gated channels they could not otherwise see) — confirmed by reproducing the read as the `authenticated` role against a local database before the fix (a chapter-B user counted a chapter-A action row; 0 after the fix).

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
