# Skill: UI Development

> Use when building or modifying UI in the web dashboard, landing site, or shared component packages.

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

Available components: accordion, avatar, badge, button, card, command, dialog, dropdown-menu, input, popover, progress, scroll-area, select, separator, sheet, skeleton, switch, table, tabs, textarea, toast, tooltip.

### Adding a new ShadCN component

ShadCN components are copy-pasted from the ShadCN registry, not installed via CLI. To add one:
1. Create file in `apps/web/components/ui/`
2. Install the Radix dependency: `npm install @radix-ui/react-<primitive> -w apps/web`
3. Use `cn()` for class merging, `cva()` for variants
4. Follow existing patterns in the directory for consistency

---

## Tailwind and theming

### Theme tokens (from `@repo/theme`)

The design system uses HSL CSS variables for semantic colors:

| Token | Usage |
|-------|-------|
| `background` / `foreground` | Page background and text |
| `card` / `card-foreground` | Card surfaces |
| `primary` / `primary-foreground` | Primary actions (navy-800) |
| `muted` / `muted-foreground` | Subdued text and backgrounds |
| `destructive` / `destructive-foreground` | Danger states |
| `border` | Borders |
| `ring` | Focus rings |

### Brand colors

| Name | Hex range | Usage |
|------|-----------|-------|
| `navy` | 50–950 | Primary backgrounds, headers |
| `royal-blue` | 50–950 | Accent, links |
| `emerald` | 50–950 | Success states |

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
    "./app/**/*.{js,ts,jsx,tsx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}",
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

All data fetching uses TanStack Query via shared hooks. Import from the package root (barrel export in `packages/hooks/src/index.ts`):

```typescript
import { useCurrentUser, useUpdateUser, useMembers, useCurrentChapter } from "@repo/hooks";
```

Pattern:
- `useQuery` for reads: `queryKey` for caching, `queryFn` calls `client.GET`
- `useMutation` for writes: `mutationFn` calls `client.POST/PATCH/DELETE`, `onSuccess` invalidates queries
- All hooks require both `QueryClientProvider` (TanStack Query — provides caching, invalidation, and retry logic) and `FrappClientProvider` (provides the typed API client) in the component tree

### Provider chain (web app)

```text
QueryProvider (TanStack Query)
  └─ FrappProvider (API client with Supabase auth token + chapter ID)
       └─ NetworkProvider (online/offline state)
            └─ App content
```

These providers are defined in `apps/web/lib/providers/` but not yet wired into the root layout — they must be added when building real pages.

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

After making UI changes, start the dev server and verify in-browser:
```bash
npm run dev -w apps/web   # http://localhost:3000
npm run dev -w apps/landing  # http://localhost:3002
```

### Dark mode

The theme supports dark mode via the `.dark` class. Toggle by adding/removing the class on `<html>`. CSS variables automatically switch.

### Responsive design

Tailwind breakpoints are standard: `sm` (640px), `md` (768px), `lg` (1024px), `xl` (1280px). The web dashboard targets desktop-first; landing targets mobile-first.

---

## Updating this skill

When new patterns emerge:
1. Document new ShadCN component additions and their Radix dependencies.
2. If the provider chain changes (e.g., auth middleware is added), update the "Provider chain" section.
3. If new shared hooks are added to `@repo/hooks`, mention them in the data layer section.
