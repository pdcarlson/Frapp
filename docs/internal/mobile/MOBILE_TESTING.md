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
against the file tree, but neither proves the app *navigates*. On the first
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
- [ ] **Multi-chapter member** (needs a real account in 2+ chapters, and #805 —
      the access-token hook — enabled): sign in, land on the chapter picker, pick
      one, and arrive in the tabs with chapter data loading. Then force-quit and
      reopen: it should go straight to the tabs, **not** flash the picker.
- [ ] **Single-chapter member**: signs in straight to the tabs, never sees the
      picker.

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

**Do not widen the React version range.** React is pinned to an exact `19.2.3` in
every workspace and in the root `overrides`. React Native 0.86.2 bundles
`react-native-renderer` 19.2.3, which asserts *exact* equality with `react` at
runtime, but declares its peer range as `^19.2.0` — so npm will happily resolve a
newer React, hoist it to the repo root, and leave the mobile app dead on first
render with "Invalid hook call" followed by "Incompatible React versions". Unit
tests, lint, and typecheck all pass in that state; only booting the app catches it.

The exact version is not frozen forever — it moves with each Expo SDK upgrade.
Read the correct target for an SDK from `expo/bundledNativeModules.json` (it lists
`react`, `react-dom`, and `react-native` together) and move all six manifests plus
the root `overrides` in one commit. A root `overrides` entry is global, so mobile
cannot take a newer React while the override holds the old one.

**Upgrading the SDK requires regenerating the lockfile.** `@expo/vector-icons`
declares `expo-font: ">=14.0.4"` as a *peer*, which the previous SDK's `expo-font`
still satisfies — so a plain `npm install` keeps the whole old SDK chain hoisted at
the root next to the new one, vulnerabilities included. Use
`rm -rf node_modules package-lock.json && npm install`, then verify a single
`node_modules/expo` at the expected version before trusting any audit numbers.
