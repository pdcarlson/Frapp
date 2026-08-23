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

> Read before building or modifying UI in the mobile app, web dashboard, landing site, or shared component packages.
>
> Signet vs legacy Frapp tokens, visual truth, and "a cutover deletes what it replaces":
> [`signet-cutover`](../signet-cutover/SKILL.md). Realtime / connection / topic teardown:
> [`realtime-resilience`](../realtime-resilience/SKILL.md).

---

## Architecture overview

| Layer | Location | Purpose |
|-------|----------|---------|
| `@repo/theme` | `packages/theme/src/` | Tailwind preset (`./tailwind`) + stylesheets (`./signet.css` Signet, `./globals.css` legacy/landing) + typed Signet tokens (`./signet`, what mobile reads) + the chapter accent resolver (`./accent`). `./tokens` is the legacy bone/bronze/ink token set, consumed only inside the package. |
| ShadCN components | `apps/web/components/ui/` | Dashboard primitives and Radix composites (Button, Card, Dialog, Select, Toast, etc.) |
| App components | `apps/web/components/` | Feature-level components |
| Pages | `apps/web/app/` | Next.js App Router pages and layouts |
| Landing | `apps/landing/app/` | Marketing site (separate Next.js app; inline Tailwind, no shared component package) |
| Mobile screens | `apps/mobile/app/` | Expo Router screens (React Native — no Tailwind classes) |
| Mobile components | `apps/mobile/components/` | React Native composites |

---

## Component patterns

### ShadCN / Radix components (`apps/web`)

Located in `apps/web/components/ui/`. There is no shared web-component workspace — dashboard
primitives live here, landing uses inline Tailwind, and mobile uses React Native composites.

```typescript
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
```

These follow ShadCN conventions:
- Class Variance Authority (CVA) for variant-based styling
- `cn()` utility from `@/lib/utils` (clsx + tailwind-merge)
- Radix UI primitives for accessible behavior

Available components: avatar, badge, button, card, command, dialog, dropdown-menu, duotone, focus, input, label, popover, select, sheet, switch, table, tabs, textarea, toast, toaster, typography.

`accordion`, `progress`, `scroll-area`, `separator`, `skeleton`, `sonner` and
`tooltip` were **deleted** by the #920 primitives slice — each had exactly one
reference in the repo, its own definition — along with their npm dependencies.
Do not re-add one from the ShadCN registry to satisfy a single call site; the
replacements are `components/shared/async-states.tsx` for skeletons,
`components/ui/toast.tsx` + `hooks/use-toast.ts` for toasts, and
`DropdownMenuSeparator`'s `-mx-1 my-1 h-px bg-border` for a rule. `Button` has
no `outline` variant either — Signet's Secondary *is* the outlined button.
`apps/web/components/ui/focus.ts`, `apps/web/components/ui/duotone.tsx` and
`apps/web/components/ui/typography.ts` (the `EYEBROW` recipe) are shared
recipes rather than components.

Three things the #920 Directory & Finance slice settled, which are easy to
re-derive wrongly:

- **`Badge` ships the §5 Semantic kind in three hues** — `success`, `warning`,
  `destructive`. A status label takes one of them, never `default`: `default`
  is the *chapter accent*, so a red-accented chapter renders `PAID` as its
  danger badge. `outline` (Hairline) is for metadata that must not read as a
  status at all.
- **`Table`'s row hover and selection are a matched pair** — `accent-3` for
  hover, `accent-4` plus `accent-11` text for selection. Do not re-spell either
  at a call site, and do not collapse them into one tint: they are
  luminance-equivalent, and only the second carries a step. The reasoning and
  the measurements are in the file's own header.
- **A state rendered inside a `<CardContent>` uses
  `components/shared/nested-states.tsx`**, not `async-states.tsx`. The latter
  paints `--card`, which is 1.00:1 inside a card.

### Adding a new ShadCN component

ShadCN components are copy-pasted from the ShadCN registry, not installed via CLI. To add one:
1. Create file in `apps/web/components/ui/`
2. Install the Radix dependency: `npm install @radix-ui/react-<primitive> -w apps/web`
3. Use `cn()` for class merging, `cva()` for variants
4. Follow existing patterns in the directory for consistency

---

## Tailwind and theming

The canonical design-system contract (component ownership matrix, state completeness standard,
fail-fast entitlement gating, accessibility gates, motion) lives in
[`spec/ui/design-system/README.md`](../../../spec/ui/design-system/README.md); the tables below
summarize the tokens as implemented in `@repo/theme`.

**Palette status (read this before styling anything):** the repo's canonical design system is
**Signet** — dark-only, warm neutrals, gold accent seed, Figtree — specified under
[`spec/ui/design-system/`](../../../spec/ui/design-system/README.md). **The web dashboard is
Signet end to end**: `apps/web/app/globals.css` imports `packages/theme/src/signet.css` (dark-only,
Figtree via `--font-figtree`), and all nine #920 slices have landed — the shell, the shared
primitives, and every screen family. The migration window is closed, so a legacy class or a live
`dark:` variant on a dashboard screen is a defect now, not a pending slice. **The landing site has
NOT been reskinned**: it still ships the legacy chat-first **bone / bronze / ink** palette
(`packages/theme/src/globals.css`), light-first with Geist Sans, its spec frozen at that state
([`spec/ui/README.md`](../../../spec/ui/README.md)) — do not restyle it toward Signet ad hoc. The
legacy `navy` / `emerald` **preset keys survive for `apps/landing` alone** (existing utility
classes keep compiling, but their values map to ink / moss / bone-era colors) and go with its
reskin, #913/#914. `royal-blue` is **gone** — the #920 slice-9 cutover deleted it outright, along
with `navy`'s numbered steps and the `@repo/theme` TS brand aliases (#917, closed).

**`packages/theme` is the shared token package for every surface, not a web-only one.** It already
serves `apps/web` and `apps/landing` (Tailwind preset + CSS variables) and `apps/mobile` (typed
Signet tokens via **`@repo/theme/signet`** — 58 files, plus `@repo/theme/accent` at one call site;
mobile does not import `@repo/theme/tokens` at all, and nothing outside `packages/theme` does), and
the Signet tokens live there too (`src/signet.css`, `src/signet.ts`) — as an **additive
entrypoint**, leaving the legacy exports that landing still consumes untouched. Two things are
defects:
Signet values replacing or bleeding into those legacy exports, and Signet tokens duplicated into
app-local files instead of extending the package. Component ownership and token-extension rules: §3
of [`spec/ui/design-system/README.md`](../../../spec/ui/design-system/README.md).

### Signet tokens (web work reads these)

Web dashboard work uses the token names defined in `packages/theme/src/signet.css` — read that
file rather than any table here. It holds the fixed foundations (surface ladder `--background` /
`--surface-1` / `--card`, text ladder, hairline borders) plus the ShadCN-compat pairs the shared
preset reads, and the house-default accent slot (`--primary` … `--accent-text`) that the chapter
accent engine overrides at runtime. The Signet-only Tailwind keys live app-locally in
`apps/web/tailwind.config.ts` until landing reskins — `surface-1`, the `primary-hover` /
`primary-pressed` and `accent-subtle` / `accent-subtle-hover` / `accent-border` / `accent-text`
families, `disabled`, `warning`, `info`, `destructive-text`, `mention`, `gold.*`, plus the `2xl`
border radius, the `fontFamily.sans` → `var(--font-figtree)` override and the custom
`pointer-coarse` variant. **Read that file rather than this list** — it is the one that compiles,
and it carries the reasoning for each. `packages/theme/src/signet.css.spec.ts` asserts every key
reads a defined token.

### Legacy theme tokens (landing-only)

The frozen landing theme (`packages/theme/src/globals.css`) defines these semantic colors as CSS
variables. Every one holds a **complete color value** (`hsl(30 45% 32%)`, `#C49A3A`,
`rgba(255,255,255,.08)`) — not a bare HSL triple — and the preset reads them through `colorVar()`
as a plain `var(--token)`. **Never hand-write `hsl(var(--token))` around one**: it emits
`hsl(hsl(...))`, which the browser drops, and a `tailwind.config.spec.ts` guard fails the build on
it (#1151). In a Tailwind arbitrary value the correct form carries the type hint —
`text-[color:var(--foreground)]`.

| Token | Usage |
|-------|-------|
| `background` / `foreground` | Page background and text |
| `card` / `card-foreground` | Card surfaces |
| `primary` / `primary-foreground` | Primary actions (deep bronze — replaced royal blue) |
| `muted` / `muted-foreground` | Subdued text and backgrounds |
| `destructive` / `destructive-foreground` | Danger states |
| `border` | Borders |
| `ring` | Focus rings |

### Brand color keys (legacy names, remapped values — `apps/landing` only)

Two keys survive in the shared preset, and **neither is a full ramp**:

| Key | Steps defined | Maps to | Usage |
|------|-----------|-----------|-------|
| `navy` | `DEFAULT` only | ink (`#1F1A15`) | Brand anchor, headers, dark surfaces |
| `emerald` | `DEFAULT`, `50`, `100`, `400`, `500`, `600` | moss/success ramp | Success states |

`royal-blue` was **deleted** in the #920 slice-9 cutover — it had zero class sites anywhere in the
repo. `navy` shed its numbered steps in the same pass, for the same reason: all ten surviving call
sites are the bare `text-navy` / `bg-navy`, all of them in `apps/landing`. **A class naming a
key or step that is not defined above compiles to nothing** — no error, no warning, an unstyled
element (#1145, #1151). Do not reach for `bg-royal-blue-600` or `text-navy-900`.

**`emerald` is a *partial* override of a stock Tailwind colour**, which is the sharper hazard: a
step not in the list above does not fail, it silently falls through to **stock Tailwind green**.
That was #916's root cause — `emerald-700` is absent, so a landing pricing pill rendered stock
emerald text beside a moss `emerald-100` fill and nothing flagged it.

Both keys exist only for `apps/landing` and go with its reskin (#913/#914). Never treat
success-green as the global primary-action color — `primary` (bronze) is the action color, ink is
the brand anchor. Read the current values from `packages/theme/src/tailwind.config.ts` (the scale
keys) and `packages/theme/src/globals.css` (the semantic HSL variables) rather than trusting any
doc's hex table.

### Custom animations

Pre-defined in the theme: `fade-up`, `fade-in`, `count-up`, `slide-down`, `slide-in-right`. Use via `animate-fade-up`, `animate-slide-down`, etc.

### Consuming the theme

Web and landing apps extend the shared config:
```typescript
// apps/web/tailwind.config.ts
import sharedConfig from "@repo/theme/tailwind";
const config: Config = {
  presets: [sharedConfig],
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
};
```

`apps/web` additionally layers the Signet-only color tokens, the `2xl` border radius, the Figtree
`fontFamily.sans` override and a custom `pointer-coarse` variant on top, and keeps
`darkMode: "class"` with nothing setting the class — read the real `apps/web/tailwind.config.ts`.
`pointer-coarse` is worth knowing about: Tailwind 3.4 ships no such variant, so before it was
registered every `pointer-coarse:` class in the tree compiled to nothing at all.

Each surface's global CSS imports exactly one of the two theme stylesheets — never both:
```css
/* apps/web/app/globals.css — Signet (dark-only) */
@import "../../../packages/theme/src/signet.css";
```
```css
/* apps/landing/app/globals.css — legacy, frozen */
@import "../../../packages/theme/src/globals.css";
```

---

## Mobile app (`apps/mobile`)

`apps/mobile` is the mobile Signet surface. Start at
[`spec/ui/mobile/README.md`](../../../spec/ui/mobile/README.md) — it and its siblings
(`screens.md`, `navigation.md`, `patterns.md`) own the screen inventory, IA, and interaction
patterns; tokens, components, icons, and copy come from
[`spec/ui/design-system/README.md`](../../../spec/ui/design-system/README.md). Read those before
writing a screen. The constraints below are the ones most often violated by web habits:

- **Typed `StyleSheet` token factories, not NativeWind.** A screen calls `useFrappTheme()`
  (`apps/mobile/lib/theme.tsx`) and passes the tokens to a `createStyles(tokens: SignetTokens)`
  factory that returns a `StyleSheet` — see `apps/mobile/components/nav-tile.tsx`. NativeWind was
  removed entirely in S1 of #937 (configs, deps, and the tsconfig `nativewind-env.d.ts` entry) and
  MUST NOT come back on a Signet surface.
- **Signet is dark-only.** The theme context is `{ tokens: SignetTokens }` from
  `@repo/theme/signet` — there is no light/dark preference, no `resolvedTheme`, and no
  `useColorScheme` in the theme layer. Provider chain (outer→inner): `GestureHandlerRootView` >
  `SafeAreaProvider` > `FrappThemeProvider` > `AuthSessionProvider` > `FrappProvider` >
  `AnalyticsProvider` > `KeyboardProviderGuarded` > `BottomSheetModalProvider`.
- **No raw hex in screen code, no hand-set type.** Colors come from the Signet tokens; type is set
  only through `typeRole(tokens.typography.role.X)` (which carries the per-weight Figtree family —
  `fontSize`/`fontWeight` literals or arithmetic on a role token are defects). Semantic fills use
  `tint(hue)` (~13% default, 0.3 for borders); mono uses `MONO_FONT_FAMILY`; avatars use
  `avatarRadius(size)`. All helpers live in `apps/mobile/lib/theme.tsx`. Figtree loads in
  `app/_layout.tsx` from `@expo-google-fonts/figtree` behind a splash hold.
- **Expo Go is the only current run path** (`npm run start -w apps/mobile`, then scan from a
  physical device or local emulator — it cannot be verified headless). Modules that do not run in Go
  — Stripe React Native, remote push, `react-native-keyboard-controller` — MUST sit behind an
  isolation module that does a runtime environment check and degrades gracefully, so importing a
  screen never crashes Go. Screen code MUST NOT import them directly — an ESLint
  `no-restricted-imports` error enforces this; the keyboard module is `apps/mobile/lib/keyboard.tsx`
  (`KeyboardProviderGuarded` / `getKeyboardPath`).
- **Seven files are frozen — building a screen means ADDING files.** `app/_layout.tsx`,
  `app/(tabs)/_layout.tsx`, `lib/theme.tsx`, `components/screen-shell.tsx`, `lib/href.ts`,
  `package.json`, `app.json`. Every planned route is already registered hidden (`href: null`) with a
  stub backing file, so a screen slice fills in the stub and never touches the tab layout. If you
  genuinely need one of the seven — a new dependency, a config plugin, a new shared prop — that is a
  separate integrator PR, not part of your slice. Full rule:
  [`spec/ui/mobile/navigation.md`](../../../spec/ui/mobile/navigation.md) § Hotspot freeze.
- **Route strings are not compile-checked in CI.** `typedRoutes` is on, but the generated types are
  gitignored and only `expo start` writes them, so under a bare `tsc` `Href` is just `string`.
  `apps/mobile/lib/routes.spec.ts` is the guard that actually runs — if you add or move a route, it
  is what tells you a link went stale.

Everything else — component variants, states, iconography, copy — is specified in the docs linked
above and is not restated here.

---

## Data layer for UI

### API SDK (`@repo/api-sdk`)

Generated TypeScript client from `openapi.json`. Uses `openapi-fetch` for type-safe requests.

### React hooks (`@repo/hooks`)

All data fetching uses TanStack Query via shared hooks — never raw `fetch`. Import from the package root (barrel export in `packages/hooks/src/index.ts`):

```typescript
import { useCurrentUser, useUpdateUser, useMembers, useCurrentChapter } from "@repo/hooks";
```

The barrel re-exports 28 modules — members, events, attendance, points, chat, billing, invoices, backwork, notifications, service entries, tasks, study, documents, polls, semesters, reports, search, chapters, chapter directory, roles, custom roles, custom fields, org config, invites, and users, plus the client and query-key helpers. Check `packages/hooks/src/` before writing a new hook; that directory, not this list, is the current one.

Pattern:
- `useQuery` for reads: `queryKey` for caching, `queryFn` calls `client.GET`
- `useMutation` for writes: `mutationFn` calls `client.POST/PATCH/DELETE`, `onSuccess` invalidates queries
- All hooks require both `QueryClientProvider` (TanStack Query — provides caching, invalidation, and retry logic) and `FrappClientProvider` (provides the typed API client) in the component tree

### Provider chain (web app)

```text
QueryProvider (TanStack Query)
  └─ FrappProvider (API client with Supabase auth token + chapter ID)
       └─ SentryIdentityProvider (Sentry user identity — renders no UI)
            └─ AnalyticsProvider (product analytics)
                 └─ NetworkProvider (online/offline state)
                      └─ App content
```

The chain is assembled in `AppProviders` (`apps/web/app/providers.tsx`) and wired into the root layout (`apps/web/app/layout.tsx`); the individual providers live in `apps/web/lib/providers/`. There is no theme provider — the web dashboard is dark-only Signet, and `next-themes` left with the #920 shell slice. New pages get all providers automatically — do not re-wrap.

### Validation (`@repo/validation`)

Shared Zod schemas for form validation:
```typescript
import { CreateChapterSchema, UpdateUserSchema } from "@repo/validation";
```

Use with React Hook Form or direct `parse`/`safeParse` for client-side validation that matches API expectations.

---

## State management

- **Chapter selection**: Zustand store at `apps/web/lib/stores/chapter-store.ts`. Persists `activeChapterId` to localStorage.
- **Server state**: TanStack Query (via `@repo/hooks`). No Redux or other global state.

---

## Testing UI changes

### Visual verification

After making UI changes, start the dev server and verify in-browser (setup details in
[`docs/internal/environment/LOCAL_DEV.md`](../../../docs/internal/environment/LOCAL_DEV.md)):
```bash
npm run dev -w apps/web   # http://localhost:3000
npm run dev -w apps/landing  # http://localhost:3002
```

Mobile is verified on a device, not in a browser — see the run-path constraint above.

### Dark mode

Signet web is **dark-only**: there is no `next-themes`, no theme provider, and nothing toggles a
`.dark` class — the single `:root` block in `packages/theme/src/signet.css` is the theme, so there
is no mode switch to test. `apps/web` keeps `darkMode: "class"` deliberately with nothing setting
the class: that was what kept residual `dark:` variants inert while the #920 slices ran, and every
family has now deleted its own, so `apps/web` ships **zero** live `dark:` variants and the setting
is a backstop against Tailwind's `media` default re-activating a new one. Do not set the class,
reintroduce a toggle, or write a fresh `dark:` variant. Landing is unaffected: it stays light-first on the
legacy `packages/theme/src/globals.css` (its `.dark` block is never toggled).

### Responsive design

Tailwind breakpoints are standard: `sm` (640px), `md` (768px), `lg` (1024px), `xl` (1280px). The **web dashboard** (`apps/web`) is **desktop-first** (dense layouts and side navigation assume `lg`+); the **landing** (`apps/landing`) is **mobile-first** (single column and touch targets by default, then progressive enhancement at `sm`/`md`).

## Accessibility

Preserve ARIA attributes, test keyboard navigation (Tab, Shift+Tab, Enter, Escape, Arrow keys), ensure visible focus indicators using the `ring` theme token, use semantic HTML (`button`, `nav`, `main`), provide alt text and aria-labels for icon-only buttons, and test with screen readers (VoiceOver, NVDA). Reference Radix UI Accessibility and keep Radix primitives' defaults when implementing custom components.

---

## Updating this skill

When new patterns emerge:
1. Document new ShadCN component additions and their Radix dependencies.
2. If the provider chain changes (e.g., auth middleware is added), update the "Provider chain" section.
3. If new shared hooks are added to `@repo/hooks`, mention them in the data layer section.
