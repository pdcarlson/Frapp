# Mobile Testing

## Running the app on a device

There is **no EAS build**. `apps/mobile/eas.json` defines `development` / `preview` /
`production` profiles, but no EAS project has been provisioned, so the only way to
see the app today is Expo Go against a local Metro server. This cannot be done from
a headless cloud VM — it needs a physical device (or a local simulator) on the same
network as the machine running Metro.

### 1. Provide the environment

Expo inlines `EXPO_PUBLIC_*` at bundle time. Create `apps/mobile/.env.local`
(gitignored) with:

```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_API_URL=
```

Per-environment values are in
[`docs/internal/environment/ENV_REFERENCE.md`](../environment/ENV_REFERENCE.md).
`EXPO_PUBLIC_API_URL` is the **bare API origin** — the SDK paths already carry
`/v1`, so a trailing `/v1` doubles it.

Without the two Supabase values the sign-in card renders
"EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are not set for this
build" and every auth row in the smoke checklist fails by construction.

Alternatively, `npm run dev:mobile` from the repo root injects the same variables
through Infisical instead of a local file.

### 2. Start Metro

```bash
npm run start -w apps/mobile
```

Then scan the QR code with Expo Go (Android) or the Camera app (iOS).

If Metro stops with `CommandError: Interactive prompt was cancelled` after asking
you to log in, an Expo account is being resolved that you are not signed in to.
`npx expo start --offline` skips the account lookup entirely.

### 3. Walk the checklist

[`MOBILE_INTERACTION_SMOKE_CHECKLIST.md`](./MOBILE_INTERACTION_SMOKE_CHECKLIST.md)
is the script. Note that in Expo Go the deep-link scheme is `exp://`, not
`frapp://`, so the magic-link rows in §1 are unreachable regardless of the
Supabase redirect allowlist — use the password sign-in path.

### 4. S1 foundation smoke (`sheet-demo`)

S1 of #937 (the Signet foundation cutover) could not be device-verified from the
cloud session that built it, so its proof is a throwaway screen: navigate to
`/sheet-demo` (hidden `href: null` route — from any screen's URL bar in Expo Go,
or temporarily deep-link `exp://.../--/sheet-demo`). Verify:

- [ ] The app **boots** — no crash at launch means the provider stack
      (gesture-handler root, safe-area, guarded keyboard, sheet host) and the
      splash-held Figtree load are sound.
- [ ] The **Figtree specimen** renders visibly different weights for 400/600/700
      (Android is the honest test — it cannot fake weights from one file), and
      the mono line renders in a monospace face.
- [ ] The **keyboard path** line reads `fallback` in Expo Go (it must never read
      `native` there; `native` is correct only in a future EAS dev build).
- [ ] **Open bottom sheet** presents the gorhom sheet with grabber, header, and
      Cancel; it drags and dismisses; typing in the field keeps it visible above
      the keyboard.

The screen is deleted before the Phase 2 exit gate (#808 supersedes it). It
deliberately survived the S2 nav restructure: it is still the only device smoke
vehicle anyone has, and no one has yet run it.

### 5. S2 navigation smoke

S2 (#957) moved every route at once and could not be device-verified either. The
bundle builds and `lib/routes.spec.ts` proves every route literal resolves
against the file tree, but neither proves the app _navigates_. On the first
device run, check:

- [ ] The app opens on **Chat** — chat is home, and there is no Home tab.
- [ ] The tab bar shows exactly **four** tabs: Chat, Events, Tasks, More.
- [ ] Tab glyphs are **duotone at 24px** and the active one **recolors** rather
      than switching to a solid shape. The More glyph is a 2×2 grid, not an
      ellipsis. The active label is heavier than the inactive ones.
- [ ] Every **More** row opens its destination; the stub rows say so rather than
      erroring.
- [ ] **Profile** is reachable from More and gone from the tab bar.
- [ ] A deleted path (`exp://.../--/points`, `--/task-center`) lands on home via
      `+not-found` instead of an error screen.
- [ ] **`frapp://event-details` still resolves** — export an `.ics` from an event
      and open it. This is the one filename contract in the app; a break here is
      invisible until a member taps a calendar entry.
- [ ] **Single-chapter member**: signs in straight to the tabs and is never
      asked to choose. This must hold **with `custom_access_token_hook` still
      disabled** (#805) — the API auto-resolves a sole membership server-side,
      and the app must not require the claim. Force-quit and reopen: straight to
      the tabs, no picker flash.
- [ ] **Chapter picker** (More → Chapter): opens for any member, lists their
      chapters, and Sign out works from it even mid-selection.
- [ ] **Multi-chapter switch** (needs an account in 2+ chapters **and** #805
      enabled): pick a chapter and land back in the tabs with that chapter's
      data. With #805 still disabled the pick should still return you to the
      tabs rather than spin — the chapter just will not change.

## Unit tests

The `apps/mobile` workspace is configured with Vitest. `vitest.setup.ts` mocks the
native Expo modules (`expo-file-system/legacy`, `expo-sharing`, `expo-font`,
`expo-splash-screen`), the S1 native additions (`react-native-gesture-handler`,
`react-native-safe-area-context`, `@gorhom/bottom-sheet`,
`react-native-keyboard-controller`, `@expo-google-fonts/figtree`), and the
`react-native` platform globals (including `StyleSheet` and string component
stand-ins for Signet token-factory tests).

Two suites are static rather than render-based, and deliberately so:
`lib/routes.spec.ts` walks the real route tree to check every route literal —
it is what stands in for typed routes, which do not bind under CI's bare `tsc`
(see [`spec/ui/mobile/navigation.md`](../../../spec/ui/mobile/navigation.md)) —
and `lib/auth-gate.spec.ts` enumerates every session/chapter state to prove the
two routing gates cannot redirect into each other.

```bash
npm run test -w apps/mobile
```

## Gotchas

**Never put a `*.spec.*` file under `app/`.** Expo Router discovers routes with
`requireContext` over the whole `app/` tree, so a spec placed next to the screen
it tests is bundled _into the app_. That drags `vitest` — and through it Vite's
module runner — into the Metro graph, and `expo export` dies with
`SyntaxError: Invalid call at line 1018: import(filepath)`. Every local check
stays green while this is true: `npm run test`, `npm run lint`, and
`npm run check-types` all pass, because none of them bundles.

Put screen-adjacent logic that wants a test in `lib/` and import it from the
screen — `lib/chat/channel-list.ts` and its spec are the pattern. Note that
`lib/routes.spec.ts` skips `.spec.` files in its own route walk, so it will _not_
warn you about this; the only thing that catches it is bundling.

```bash
# The one check that catches route-tree and Metro-resolution breakage.
npx expo export --platform ios
```

**Do not widen the React version range.** React is pinned to an exact `19.2.3` in
every workspace and in the root `overrides`. React Native 0.86.2 bundles
`react-native-renderer` 19.2.3, which asserts _exact_ equality with `react` at
runtime, but declares its peer range as a caret — so npm will happily resolve a
newer React, hoist it to the repo root, and leave the mobile app dead on first
render with "Invalid hook call" followed by "Incompatible React versions". Unit
tests, lint, and typecheck all pass in that state; only booting the app catches it.

The exact version is not frozen forever — it moves with each Expo SDK upgrade.
Read the correct target for an SDK from `expo/bundledNativeModules.json` (it lists
`react`, `react-dom`, and `react-native` together) and move all five pin sites —
`apps/landing`, `apps/mobile`, `apps/web`, `packages/hooks`, and the root
`overrides` — in one commit. A root `overrides` entry is global, so mobile
cannot take a newer React while the override holds the old one.

**Upgrading the SDK requires regenerating the lockfile.** `@expo/vector-icons`
declares `expo-font: ">=14.0.4"` as a _peer_, which the previous SDK's `expo-font`
still satisfies — so a plain `npm install` keeps the whole old SDK chain hoisted at
the root next to the new one, vulnerabilities included. Use
`rm -rf node_modules package-lock.json && npm install`, then verify a single
`node_modules/expo` at the expected version before trusting any audit numbers.

**A `waitFor` on a derived flag can be satisfied by the wrong state.**
`useAuthSession` exposes `isChapterResolving` as
`status === "authenticated" && !hasReadChapterClaim`
([`lib/auth-session.tsx`](../../../apps/mobile/lib/auth-session.tsx)), so it reads
`false` during `hydrating` just as it does once the first claim read has landed.
`await waitFor(() => expect(result.current.isChapterResolving).toBe(false))`
therefore _can_ return before `getSession()` has resolved and before any claim read
has been issued — the wait passes for a reason the test did not intend, and
whatever it was meant to sequence is still ahead of it. It does not fail every
time; see the drain below for what decides it. Assert `status === "authenticated"`
in the same `waitFor` so the pre-authentication state cannot satisfy it.

The test for whether a wait is specified enough is simply this: **could its first
synchronous sample already pass?** `waitFor` evaluates its callback immediately
inside its own promise executor, before anything has had a chance to happen, so a
condition that is already true when the wait begins returns at once and sequences
nothing. That is independent of how many suites are running.

Apply that test to what the wait is _for_, not mechanically. A wait placed after an
`await act(...)` that already did the sequencing will often pass on its first
sample, and that is fine — about ten of this spec's own waits are in exactly that
position. The question is whether anything _other than the wait itself_ rules out
the state you are trying to skip past. When the answer is the `act` above it, the
wait is a readable assertion; when the answer is nothing, it is a bug.

The corollary is that waiting on an _already-settled_ flag is a pure no-op. Where a
later async operation is the thing under test and it changes no flag — a claim
re-read, which deliberately leaves `hasReadChapterClaim` true — wait on the
operation instead: await the mock's recorded promises inside `act`, and assert the
call count so the wait cannot be satisfied by an earlier, unrelated call.

This was the whole of #976. Two things about it are worth not repeating:

- **It was not a cross-test leak.** It was originally diagnosed as a released claim
  gate leaking into the next test, and an `act()` containment was added for that
  theory. The rate never moved, because nothing ever crossed a test boundary.
- **It was not suite-only**, though #976 says it was. To check either claim you
  have to run the _pre-fix_ spec, which since #981 means an explicit checkout —
  `git show 1632e72:apps/mobile/lib/auth-session.spec.tsx`, the last commit before
  the fix. Against that revision the test reproduces run on its own: 4 failures in
  30 file-alone runs, versus 1 in 15 for the full nine-file suite, on one 4-core
  box. Run it against `main` instead and you get a clean 70/70, which says nothing
  about the flake. So do not treat "passes in isolation" as evidence that a
  documented mechanism does not apply — and when you do measure a rate, say which
  revision you measured.

What actually varies run to run is the drain Testing Library performs _after_
`waitFor` resolves: `asyncWrapper` awaits a `setTimeout(0)` that races React's
scheduler macrotasks, and that decides whether the pending work has landed by the
time the test continues. Machine load shifts those odds, which is why the rate is
noisy and why a handful of green runs proves very little.

**A test double that parks a call needs one resolver per parked call.** The same
spec holds `getClaims` open to make the in-flight window observable. Storing a
single resolver on the mock state looked sufficient, but the claim effect re-runs on
every token change, so a token refresh parks a second read while the mount read is
still behind the gate — and the second park overwrote the first resolver, stranding
a promise that could then never settle. Keep a list of waiters and release all of
them.
