---
name: ui-development
description: >
  Build or modify UI in the web dashboard (apps/web), landing site (apps/landing), or the shared
  component/theme/hooks/validation packages. Use when writing or editing frontend code — React
  components, ShadCN/Radix composites, Tailwind styling, theme tokens, TanStack Query data hooks,
  or Zod form validation — anywhere under apps/web, apps/landing, or packages/{ui,theme,hooks,validation}.
---

# UI Development

> Read before building or modifying UI in the web dashboard, landing site, or shared component packages.

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

The canonical design-system contract (color role map, component ownership matrix, state
completeness standard, accessibility gates) lives in
[`docs/internal/design-system/UI_UX_SYSTEM.md`](../../../docs/internal/design-system/UI_UX_SYSTEM.md);
the tables below summarize the tokens as implemented in `@repo/theme`. **Palette note:** the
chat-first redesign rebranded the palette to **bone / bronze / ink** (see
`packages/theme/src/globals.css` and `tailwind.config.ts`) — the legacy `navy` / `royal-blue` /
`emerald` **keys are preserved so existing utility classes keep compiling, but their values now map
to ink / bronze / bone-era colors**. `UI_UX_SYSTEM.md`'s color role map predates that rebrand; where
they disagree, the theme package is what ships.

### Theme tokens (from `@repo/theme`)

The design system uses HSL CSS variables for semantic colors:

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
