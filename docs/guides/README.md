# Developer guides (canonical)

These markdown files are the **source of truth** for Frapp developer-facing guides. There is no separate docs website in the monorepo right now—read here on GitHub or in your editor. A public docs site is a possible **post-launch** follow-up.

| Guide                | File                                       |
| -------------------- | ------------------------------------------ |
| Getting started      | [getting-started.md](getting-started.md)   |
| Deployment overview  | [deployment.md](deployment.md)             |
| Environment & config | [env-config.md](env-config.md)             |
| Docker (API)         | [docker.md](docker.md)                     |
| API architecture     | [api-architecture.md](api-architecture.md) |
| Database & Supabase  | [database.md](database.md)                 |
| Testing              | [testing.md](testing.md)                   |
| Contributing         | [contributing.md](contributing.md)         |

**Default local run (API + web + landing):** `npm run dev:stack` from repo root after Infisical login — full detail and alternatives in [`../internal/LOCAL_DEV.md`](../internal/LOCAL_DEV.md).

**Also read:** product and implementation specs in [`spec/`](../../spec/README.md), operator runbooks in [`docs/internal/`](../internal/README.md), and **[`docs/internal/DOCUMENTATION_CONVENTIONS.md`](../internal/DOCUMENTATION_CONVENTIONS.md)** (where to document PR changes).

**Maintenance:** Toast error copy in dashboard client components uses shared `getErrorMessage` from `apps/web/lib/utils.ts` (same file as `asArray` / `cn`) so fixes apply everywhere. The dashboard home route (`apps/web/app/(dashboard)/home/page.tsx`) exports Next.js `metadata` with title `Home — Frapp` so `/`, `/dashboard`, and `/join` redirects show a specific document title instead of the root default. The dashboard events list (`apps/web/app/(dashboard)/events/page.tsx`) bumps a `nowTick` state on a one-minute interval while the time filter is “upcoming” or “past”, so rows cross the boundary without waiting for refetches or other filter changes. `useCurrentChapter` in `@repo/hooks` keys the React Query cache by `chapterId` (`["chapters","current", chapterId]`) so switching the active chapter refetches; pass `chapterId` from the chapter store at call sites. `useNotifications` uses the same pattern (`["notifications", chapterId, limit]`) so the dashboard bell and drawer cannot show cached rows from another chapter. Chapter-scoped list hooks (`useEvents`, `useLeaderboard`, `useOverdueInvoices`, plus members/backwork) set `enabled: !!chapterId` so no request runs until an active chapter is selected. `AttendanceService.markAutoAbsent` uses `AttendanceRepository.createMany` (Supabase bulk `insert`) for absence rows; see [`api-architecture.md`](api-architecture.md) and [`../performance/attendance.md`](../performance/attendance.md). The dashboard ⌘K palette’s backwork search hits route `/backwork` (same as primary nav), not `/home`. In the same palette, the “Go to Points” row shows shortcut `G O` so it does not share or extend the `G P` prefix used for “Go to Profile” (avoids ambiguous chord labels if global shortcuts are added later). The Reports preview table in `apps/web/components/reports/reports-page.tsx` renders one `<td>` per shared flattened column key so heterogeneous rows stay aligned with the header (same union as CSV export). The chapter overview “Subscription status” card formats Stripe-style statuses with `replaceAll("_", " ")` so every underscore becomes a space. The dashboard home quick-actions card (`apps/web/components/home/quick-actions-card.tsx`) is a client component so permission-gated rows (`Can`) and action buttons share one explicit boundary; keep the page server-only unless the whole view needs client hooks.
