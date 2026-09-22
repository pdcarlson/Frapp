---
name: ui-development
description: >
  Build or modify UI in the mobile app (apps/mobile), web dashboard (apps/web), landing site
  (apps/landing), or the shared theme/hooks/validation packages. Use when writing or
  editing frontend code — React Native screens and typed StyleSheet token factories, React
  components, ShadCN/Radix composites, Tailwind styling, theme tokens, TanStack Query data hooks,
  or Zod form validation — anywhere under apps/mobile, apps/web, apps/landing, or
  packages/{theme,hooks,validation}.
---

# UI Development

Where frontend code lives and the conventions that aren't obvious from reading it. For which
tokens and typefaces are current, which reference board is visual truth, and how a cutover
works, see [`signet-cutover`](../signet-cutover/SKILL.md). For realtime subscriptions, connection
state, and topic teardown, see [`realtime-resilience`](../realtime-resilience/SKILL.md).

## Architecture overview

| Layer | Location | Notes |
|-------|----------|-------|
| `@repo/theme` | `packages/theme/src/` | Exports `./tailwind` (shared preset), `./signet.css` (both web surfaces), `./signet` (typed tokens, what mobile reads), `./accent` (chapter accent resolver). `src/tokens.ts` is internal only (the accent fallback and the motion scale) |
| ShadCN primitives | `apps/web/components/ui/` | Dashboard primitives and Radix composites. There is no shared web-component package |
| Web features / pages | `apps/web/components/`, `apps/web/app/` | Next.js App Router |
| Landing | `apps/landing/app/` | Separate Next.js app with inline Tailwind |
| Mobile | `apps/mobile/app/` (Expo Router screens), `apps/mobile/components/` | React Native, no Tailwind classes |

## Web components (`apps/web`)

Primitives follow ShadCN conventions: CVA variants, `cn()` from `@/lib/utils`, and Radix for
behavior. To add one, copy it into `components/ui/` and install its Radix package with
`npm install @radix-ui/react-<primitive> -w apps/web`. Don't add a registry primitive for a single
call site. Several were deleted for having only one, and the replacements are
`components/shared/async-states.tsx` (skeletons), `components/ui/toast.tsx` + `hooks/use-toast.ts`
(toasts), and `DropdownMenuSeparator`'s classes (a rule).

Conventions that are easy to get wrong:

- `Button` has no `outline` variant. Signet's Secondary is the outlined button.
- A status `Badge` takes `success`, `warning`, or `destructive`, never `default`. `default` is the
  chapter accent, so a red-accented chapter would render `PAID` as a danger badge. `outline` is for
  metadata that must not read as a status.
- `Table` row hover (`accent-3`) and selection (`accent-4` plus `accent-11` text) are a matched
  pair. Don't re-spell either at a call site or merge them. The reasoning is in the file header.
- A loading, empty, or error state inside a `<CardContent>` uses
  `components/shared/nested-states.tsx`, not `async-states.tsx`, which paints `--card` and would
  vanish inside a card.
- Focus indicators come from the recipes in `components/ui/focus.ts`, which all focusable controls
  share. `typography.ts` (`EYEBROW`) and `duotone.tsx` are shared recipes too.

## Tailwind and theming

Signet (dark-only, Figtree) is the only design system, and every surface is on it. The design
contract (component ownership, state completeness, accessibility gates, token extension) is
[`spec/ui/design-system/README.md`](../../../spec/ui/design-system/README.md). For token values,
read the files that compile rather than any table:

- `packages/theme/src/signet.css` holds the CSS variables: surface and text ladders, hairlines,
  ShadCN-compat pairs, and the house accent slot the accent engine overrides at runtime.
- `packages/theme/src/tailwind.config.ts` is the shared preset that binds them as Tailwind keys.
  `signet.css.spec.ts` asserts that every key reads a defined token.
- `packages/theme/src/signet.ts` has the typed tokens for mobile.

Each surface's `globals.css` imports exactly one theme stylesheet, `@repo/theme/signet.css`. Each
app names its config with `@config`, which is how the v3-shaped JS config (`presets`, `content`,
`darkMode`) applies under Tailwind v4.

Rules:

- Extend the package, don't copy. A Signet product token (anything in `foundations.md`'s locked
  set) duplicated into an app-local file is a defect. A role only one surface may use belongs to
  that surface, which is why the two app-local remainders are deliberate. `gold.*` lives in
  `apps/web/tailwind.config.ts` for the Ask pill. The landing's three marketing type roles
  (`--text-hero`, `--text-display-lg`, `--text-lead`) are declared in `apps/landing/app/globals.css`
  and bound in `apps/landing/tailwind.config.ts`. They sit above `foundations.md` §7's locked six
  and are landing-only by decision, so using one on a product surface is an off-scale defect.
- `@repo/theme/accent` has exactly one mobile importer, `apps/mobile/lib/chapter-branding.ts`
  (check with `grep -rn "@repo/theme/accent" apps/mobile`). Keeping it to one keeps the accent
  engine's blast radius auditable, so a second importer is a change you have to argue for.
- Tokens hold complete color values, and the preset reads them as a plain `var(--token)`. Never
  write `hsl(var(--token))`, because it emits `hsl(hsl(...))`, which the browser drops, and
  `tailwind.config.spec.ts` fails on it. In an arbitrary value, use the type hint
  `text-[color:var(--foreground)]`.
- A class that names an undefined key, step, or variant compiles to nothing, with no warning. Until
  a class family shows up in a compiled stylesheet, it isn't verified.
- The web and landing apps are dark-only, with no theme provider and nothing setting `.dark`. Both
  keep `darkMode: "class"` as a backstop so Tailwind's `media` default can't activate a stray
  variant. Don't set the class, add a toggle, or write a `dark:` variant. A legacy class or a live
  `dark:` variant on either surface is a defect.
- Landing has its own spec and binding reference boards, so read
  [`spec/ui/landing/README.md`](../../../spec/ui/landing/README.md) before changing it rather than
  restyling ad hoc. Its motion block in `apps/landing/app/globals.css` mirrors the
  `packages/theme/src/tokens.ts` scale (`apps/landing/app/page.spec.ts` pins it), so don't declare
  a second scale.
- The web dashboard is desktop-first (layouts assume `lg`+) and must still hold the 375px floor
  (`test:floor`). The landing is mobile-first. Breakpoints are stock Tailwind.

## Mobile app (`apps/mobile`)

Read [`spec/ui/mobile/README.md`](../../../spec/ui/mobile/README.md) and its siblings (`screens.md`,
`navigation.md`, `patterns.md`) before writing a screen. They own the screen inventory, IA, and
patterns, and the design-system README owns tokens, components, icons, and copy. These are the
constraints web habits most often break:

- Style with typed `StyleSheet` token factories, not NativeWind (removed). A screen calls
  `useFrappTheme()` from `apps/mobile/lib/theme.tsx` and passes the tokens to a
  `createStyles(tokens: SignetTokens)` factory. Follow `apps/mobile/components/nav-tile.tsx`.
- The theme is dark-only. The context is `{ tokens: SignetTokens }`, with no light/dark preference,
  no `resolvedTheme`, and no `useColorScheme`.
- Don't put raw hex or hand-set type in screen code. Set type only through
  `typeRole(tokens.typography.role.X)`, which carries the per-weight Figtree family.
  `fontSize`/`fontWeight` literals, or arithmetic on a role token, are defects. Use `tint(hue)` for
  semantic fills (0.13 default, 0.3 for borders), `MONO_FONT_FAMILY` for mono, and
  `avatarRadius(size)` for avatars. All of these live in `lib/theme.tsx`.
- Provider chain in `app/_layout.tsx`, outer to inner: `GestureHandlerRootView` >
  `SafeAreaProvider` > `FrappThemeProvider` > `AuthSessionProvider` > `FrappProvider` >
  `ObservabilityIdentityProvider` > `AnalyticsProvider` > `KeyboardProviderGuarded` >
  `BottomSheetModalProvider`. Figtree loads there behind a splash hold.
- Expo Go is the local run path (`npm run start -w apps/mobile`, then scan from a device or
  emulator). It can't be verified headless. Native modules that crash Go at launch or break
  `expo export --platform web` (Stripe React Native, `expo-notifications`,
  `react-native-keyboard-controller`, `expo-apple-authentication`) must be imported through their
  isolation modules (`@/lib/payments/stripe`, `@/lib/notifications/push`, `@/lib/keyboard`,
  `@/lib/apple-auth`), which check the runtime and degrade. ESLint `no-restricted-imports` rejects
  a direct import.
- Seven files are frozen: `app/_layout.tsx`, `app/(tabs)/_layout.tsx`, `lib/theme.tsx`,
  `components/screen-shell.tsx`, `lib/href.ts`, `package.json`, `app.json`. Every planned route
  is already registered hidden (`href: null`) with a stub file, so building a screen means filling
  in the stub. A change that needs one of the seven (a dependency, including an internal `@repo/*`
  package, a config plugin, a shared prop) is a separate integrator PR. See
  [`navigation.md`](../../../spec/ui/mobile/navigation.md) § Hotspot freeze.
- Route strings aren't compile-checked in CI, because typed-route output is gitignored and only
  `expo start` writes it. `apps/mobile/lib/routes.spec.ts` is the guard that runs.
- Everything under `app/` ships. expo-router bundles every file there as a route module, so a spec
  or fixture beside a screen pulls `vitest` into Metro and breaks `expo export`. `routes.spec.ts`
  fails on one. Put testable logic, and whole-screen render specs, in `lib/` (for example
  `lib/onboarding/join-screen.spec.tsx`). See
  [`MOBILE_TESTING.md`](../../../docs/internal/mobile/MOBILE_TESTING.md) § Gotchas.

## Data layer for UI

- **Fetching:** use TanStack Query through the shared hooks in `@repo/hooks`, never raw `fetch`.
  Import from the package root. `packages/hooks/src/` (one module per feature domain, re-exported
  by `index.ts`) is the inventory, so check it before writing a new hook. Reads are `useQuery` with
  `queryFn` calling `client.GET`. Writes are `useMutation` calling `client.POST/PATCH/DELETE`,
  with `onSuccess` invalidating queries. Hooks need both `QueryClientProvider` and
  `FrappClientProvider` above them.
- **API client:** `@repo/api-sdk` is the `openapi-fetch` client generated from
  `apps/api/openapi.json`. Regenerate it through the contract steps in
  [`api-development`](../api-development/SKILL.md) rather than editing `types.ts`.
- **Web provider chain:** `AppProviders` in `apps/web/app/providers.tsx`, wired into
  `app/layout.tsx`, nests `QueryProvider` > `FrappProvider` (API client with the Supabase token and
  chapter id) > `ObservabilityIdentityProvider` > `AnalyticsProvider` > `NetworkProvider`. The
  providers live in `apps/web/lib/providers/`. New pages inherit all of them, so don't re-wrap.
  There is no theme provider.
- **Forms:** shared Zod schemas come from `@repo/validation`, used with React Hook Form or
  `parse`/`safeParse`. They are UX only, because the API DTOs are the enforcement. The same package
  owns the client gates (`can`/`canAll`/`canAny`, `isModuleEnabled`, `subscriptionWriteState`,
  `isAnalyticsOptedOut`), so use them rather than re-deriving permission or module state.
- **State:** the active chapter lives in a Zustand store (`apps/web/lib/stores/chapter-store.ts`,
  persisted to localStorage). Server state lives in TanStack Query. There is no other global store.

## Verifying UI changes

Run `npm run dev -w apps/web` (http://localhost:3000) or `npm run dev -w apps/landing`
(http://localhost:3002) and check the change in a browser. Setup:
[`LOCAL_DEV.md`](../../../docs/internal/environment/LOCAL_DEV.md). Mobile is verified on a device
through Expo Go. For the unit and Playwright suites each surface runs in CI, see the
[`testing`](../testing/SKILL.md) skill.
