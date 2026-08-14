---
name: ui-development
description: >
  Build or modify UI in the mobile app (apps/mobile), web dashboard (apps/web), landing site
  (apps/landing), or the shared component/theme/hooks/validation packages. Use when writing or
  editing frontend code — React Native screens and typed StyleSheet token factories, React
  components, ShadCN/Radix composites, Tailwind styling, theme tokens, TanStack Query data hooks,
  or Zod form validation — anywhere under apps/mobile, apps/web, apps/landing, or
  packages/{ui,theme,hooks,validation}.
---

# UI Development

> Read before building or modifying UI in the mobile app, web dashboard, landing site, or shared component packages.

---

## Architecture overview

| Layer | Location | Purpose |
|-------|----------|---------|
| `@repo/ui` | `packages/ui/src/` | Shared primitive components (Button, Card, Code) |
| `@repo/theme` | `packages/theme/src/` | Tailwind config preset + CSS variables + global styles |
| ShadCN components | `apps/web/components/ui/` | Radix-based composites (Dialog, Select, Toast, etc.) |
| App components | `apps/web/components/` | Feature-level components |
| Pages | `apps/web/app/` | Next.js App Router pages and layouts |
| Landing | `apps/landing/app/` | Marketing site (separate Next.js app) |
| Mobile screens | `apps/mobile/app/` | Expo Router screens (React Native — no Tailwind classes) |
| Mobile components | `apps/mobile/components/` | React Native composites |

---

## Component patterns

### `@repo/ui` primitives

Located in `packages/ui/src/`. Each component is a separate file with barrel export via `package.json` `"exports"`:

```typescript
import { Button } from "@repo/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@repo/ui/card";
```

These use `joinClassNames` from `@repo/ui/utils` for class merging.

### ShadCN / Radix components

Located in `apps/web/components/ui/`. These follow ShadCN conventions:
- Class Variance Authority (CVA) for variant-based styling
- `cn()` utility from `@/lib/utils` (clsx + tailwind-merge)
- Radix UI primitives for accessible behavior

Available components: accordion, avatar, badge, button, card, command, dialog, dropdown-menu, input, label, popover, progress, scroll-area, select, separator, sheet, skeleton, sonner, switch, table, tabs, textarea, toast, toaster, tooltip.

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

**Palette status (read this before styling anything):** the repo's canonical design system is now
**Signet** — dark-first, warm neutrals, gold accent seed, Figtree — specified under
[`spec/ui/design-system/`](../../../spec/ui/design-system/README.md). **The web dashboard and
landing site have NOT been reskinned yet**: they still ship the legacy chat-first
**bone / bronze / ink** palette (see `packages/theme/src/globals.css` and `tailwind.config.ts`),
light-first with Geist Sans, and their specs are frozen at that state
([`spec/ui/README.md`](../../../spec/ui/README.md)). Web/landing work continues on the legacy
tokens below — do not restyle those shipping surfaces toward Signet ad hoc. The legacy `navy` /
`royal-blue` / `emerald` **keys are preserved so existing utility classes keep compiling, but their
values map to ink / bronze / bone-era colors**.

**`packages/theme` is the shared token package for every surface, not a web-only one.** It already
serves `apps/web` and `apps/landing` (Tailwind preset + CSS variables) and `apps/mobile` (typed
tokens via `@repo/theme/tokens`), and Signet tokens land there too — as an **additive entrypoint**,
leaving the existing legacy exports that web/landing consume untouched. Two things are defects:
Signet values replacing or bleeding into those legacy exports, and Signet tokens duplicated into
app-local files instead of extending the package. Component ownership and token-extension rules: §3
of [`spec/ui/design-system/README.md`](../../../spec/ui/design-system/README.md).

### Theme tokens (the legacy web exports of `@repo/theme`)

The shipping web theme uses HSL CSS variables for semantic colors:

| Token | Usage |
|-------|-------|
| `background` / `foreground` | Page background and text |
| `card` / `card-foreground` | Card surfaces |
| `primary` / `primary-foreground` | Primary actions (deep bronze — replaced royal blue) |
| `muted` / `muted-foreground` | Subdued text and backgrounds |
| `destructive` / `destructive-foreground` | Danger states |
| `border` | Borders |
| `ring` | Focus rings |

### Brand color keys (legacy names, remapped values)

| Key | Maps to | Usage |
|------|-----------|-------|
| `navy` | ink ramp | Brand anchor, headers, dark surfaces |
| `royal-blue` | bronze ramp | Primary action, accent, links |
| `emerald` | moss/success ramp | Success states |

Never treat success-green as the global primary-action color — `primary` (bronze) is the action
color, ink is the brand anchor. Read the current values from `packages/theme/src/globals.css`
rather than trusting any doc's hex table.

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
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
};
```

Global CSS imports the theme's base styles:
```css
/* apps/web/app/globals.css */
@import "../../../packages/theme/src/globals.css";
```

---

## Mobile app (`apps/mobile`)

`apps/mobile` is the active Signet surface. Start at
[`spec/ui/mobile/README.md`](../../../spec/ui/mobile/README.md) — it and its siblings
(`screens.md`, `navigation.md`, `patterns.md`) own the screen inventory, IA, and interaction
patterns; tokens, components, icons, and copy come from
[`spec/ui/design-system/README.md`](../../../spec/ui/design-system/README.md). Read those before
writing a screen. The constraints below are the ones most often violated by web habits:

- **Typed `StyleSheet` token factories, not NativeWind.** A screen calls `useFrappTheme()`
  (`apps/mobile/lib/theme.tsx`) and passes the tokens to a `createStyles(tokens: FrappTokens)`
  factory that returns a `StyleSheet` — see `apps/mobile/components/nav-tile.tsx`. There is zero
  `className` usage in `apps/mobile`; `nativewind` remains a dependency with config files left in
  place, but it MUST NOT style Signet surfaces.
- **No raw hex in screen code.** Every color comes from `@repo/theme/tokens` via `getFrappTokens()`.
  A color literal in a screen or component is a defect.
- **Expo Go is the only current run path** (`npm run start -w apps/mobile`, then scan from a
  physical device or local emulator — it cannot be verified headless). Modules that do not run in Go
  — Stripe React Native, remote push, `react-native-keyboard-controller` — MUST sit behind an
  isolation module that does a runtime environment check and degrades gracefully, so importing a
  screen never crashes Go. Screen code MUST NOT import them directly.

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

The barrel now covers hooks for members, events, attendance, points, chat, billing, invoices, backwork, notifications, service entries, tasks, study, documents, polls, semesters, reports, search, chapters, roles, invites, and users — check `packages/hooks/src/` before writing a new hook.

Pattern:
- `useQuery` for reads: `queryKey` for caching, `queryFn` calls `client.GET`
- `useMutation` for writes: `mutationFn` calls `client.POST/PATCH/DELETE`, `onSuccess` invalidates queries
- All hooks require both `QueryClientProvider` (TanStack Query — provides caching, invalidation, and retry logic) and `FrappClientProvider` (provides the typed API client) in the component tree

### Provider chain (web app)

```text
ThemeProvider (next-themes — class-based dark mode)
  └─ QueryProvider (TanStack Query)
       └─ FrappProvider (API client with Supabase auth token + chapter ID)
            └─ AnalyticsProvider (product analytics)
                 └─ NetworkProvider (online/offline state)
                      └─ App content
```

The chain is assembled in `AppProviders` (`apps/web/app/providers.tsx`) and wired into the root layout (`apps/web/app/layout.tsx`); the individual providers live in `apps/web/lib/providers/` (ThemeProvider in `apps/web/components/theme/theme-provider.tsx`). New pages get all providers automatically — do not re-wrap.

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

The theme supports dark mode via the `.dark` class, managed by `next-themes` (`ThemeProvider` in the provider chain, `attribute="class"`, system default). Use `useTheme()` from `next-themes` to toggle — don't manipulate the `<html>` class directly. CSS variables automatically switch.

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
