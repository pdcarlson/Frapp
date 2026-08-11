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

## Unit tests

The `apps/mobile` workspace is configured with Vitest. `vitest.setup.ts` mocks the
native Expo modules (`expo-file-system/legacy`, `expo-sharing`) and the
`react-native` platform globals.

```bash
npm run test -w apps/mobile
```

## Gotchas

**Do not widen the React version range.** React is pinned to an exact `19.1.0` in
every workspace and in the root `overrides`. React Native 0.81.5 bundles
`react-native-renderer` 19.1.0, which asserts *exact* equality with `react` at
runtime, but declares its peer range as `^19.1.0` — so npm will happily resolve a
newer React, hoist it to the repo root, and leave the mobile app dead on first
render with "Invalid hook call" followed by "Incompatible React versions". Unit
tests, lint, and typecheck all pass in that state; only booting the app catches it.
