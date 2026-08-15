> **FROZEN (pre-Signet).** This surface ships the legacy Frapp bone/bronze design until its Signet reskin session. Do not implement visual changes from this document and do not file spec-vs-implementation drift issues against it.

# UI/UX Specification: Web Dashboard (app.frapp.live)

> The chapter admin command center — secondary to chat in the chat-first product. This is the single surviving spec page for the surface: the navigation/permission map, gating and routing semantics, the responsive shell contract, and the data contracts that outlive the retired per-screen docs. Visual truth for the future reskin lives in [`../design-system/`](../design-system/README.md); legacy tokens live in [`packages/theme/src/globals.css`](../../../packages/theme/src/globals.css).

## Navigation map

Source of truth: [`apps/web/components/layout/nav-config.ts`](../../../apps/web/components/layout/nav-config.ts). Each item declares `requirePermission` or `requireAnyOf`; the shell hides items the caller cannot access. The caller's effective permission set is loaded once via `GET /v1/users/me/permissions` and cached with TanStack Query (resolution rules: [`spec/behavior/rbac.md`](../../behavior/rbac.md)).

| Section | Item | Route | Permission |
| --- | --- | --- | --- |
| Overview | Chat | `/chat` | — (send gated by channel permissions) |
| Overview | Profile | `/profile` | — |
| People | Members | `/members` | `members:view` |
| People | Alumni | `/alumni` | `members:view` |
| People | Roles | `/roles` | `roles:manage` |
| Operations | Events | `/events` | — |
| Operations | Points | `/points` | — |
| Operations | Tasks | `/tasks` | — (filtered to own tasks unless `tasks:manage`) |
| Operations | Service Hours | `/service` | — (log/approve gated inline via `service:log` / `service:approve`) |
| Communications | Polls | `/polls` | `polls:view_all` (chapter list + tallies; vote/create remain channel-scoped) |
| Resources | Backwork | `/backwork` | — (upload gated by `backwork:upload`) |
| Resources | Documents | `/documents` | — (upload gated by `chapter_docs:upload`, delete by `chapter_docs:manage`) |
| Resources | Study session | `/study` | — |
| Resources | Study Zones | `/geofences` | `geofences:manage` |
| Finance | Billing | `/billing` | `billing:view` |
| Finance | Reports | `/reports` | `reports:export` |
| Settings | Settings | `/settings` | — |

The standalone `/roles` page redirects to `/settings?tab=roles` (role IA canon: [`spec/behavior/settings/customization.md`](../../behavior/settings/customization.md)); `nav-config.ts` remains the source of truth for what renders. Roadmap entries render soft-disabled with a `Soon` chip (`aria-disabled="true"` + `tabIndex={-1}`).

## Gating & routing semantics

- **Module gating is hide, not grey.** Each nav item carries a `module` field; `<ProtectedNavItem>` reads `useOrgConfig().isModuleEnabled(item.module)` and **hides** items whose module is disabled — never disabled-greyed. Permission gating and module gating coexist: an item shows only when the caller holds the permission *and* the module is enabled. Disabling a module from Settings → Modules immediately removes its sidebar item, strips its slash commands from the chat palette, and mutes its system channel; data is preserved and re-enabling restores everything ([`spec/behavior/settings/README.md`](../../behavior/settings/README.md)).
- **Default route.** Chat is the post-sign-in landing surface: `/` redirects to `/chat` once a Supabase session is present, `/dashboard` is a legacy alias that also redirects to `/chat`, and `app/(dashboard)/page.tsx` (the route-group index) redirects there as well so bookmarks and internal tooling always find a segment root. The standalone `/home` overview was removed in the chat-first rework. Users with zero permissions land on `/no-access`, which explains how to request a role without dumping them back to sign-in.
- **Unauthenticated deep links keep their destination.** [`apps/web/proxy.ts`](../../../apps/web/proxy.ts) guards every protected prefix: with no Supabase session it redirects to `/sign-in?redirectTo=<pathname + search>`, and once a session exists the same proxy returns the caller there instead of the `/chat` default. The value must start with `/` or it falls back to `/chat` — the open-redirect guard, applied in the proxy and again in `resolveRedirectPath` ([`apps/web/lib/auth/redirect.ts`](../../../apps/web/lib/auth/redirect.ts)) — and it survives the sign-in ↔ sign-up hop and is reused as the magic-link `emailRedirectTo`.
- **Web study pause is server-owned.** The `/study` timer calls `POST /v1/study-sessions/pause` when the tab is hidden (Page Visibility API) or manually paused, so the server stops crediting time and starts the grace clock; returning calls `/resume` with fresh coordinates, and overrunning the zone's `pause_grace_minutes` ends the session `PAUSED_EXPIRED`. Full rules: [`spec/behavior/study-sessions.md`](../../behavior/study-sessions.md). `/geofences` configures each zone's polygon, points rate, minimum session length, and pause grace.

## Responsive contract

Shell geometry as built. Source of truth: [`apps/web/components/layout/dashboard-shell.tsx`](../../../apps/web/components/layout/dashboard-shell.tsx) against stock Tailwind v3 breakpoints (`sm` 640px, `md` 768px, `lg` 1024px) — the shared preset ([`packages/theme/src/tailwind.config.ts`](../../../packages/theme/src/tailwind.config.ts)) extends colors, radii, and motion but never overrides `screens`.

| Viewport | Primary navigation | Content column |
| --- | --- | --- |
| ≥1024px (`lg`) | Fixed 288px (`w-72`) sidebar, always expanded, its own scroll region | Remaining width inside the shell cap |
| <1024px | Sidebar hidden; header hamburger opens a left slide-out Sheet (75% of viewport width, capped at 384px from 640px up) over a modal overlay | Full width |

- **Two states, not four.** The shell switches once, at `lg`. There is no collapsed icon-rail tier and no hover-expand sidebar; adding or removing a tier is a spec change, not a refactor.
- **The cap is on the shell, not the content.** `max-w-[1400px]` with `mx-auto` bounds sidebar and content together and centers them, so above 1400px the surface gains bare-background gutters (the visual regression suite shoots at 1440px, so that is the state its baselines capture). The content column carries no max-width of its own. Horizontal padding is `px-4` below 640px and `px-6` from 640px up, applied identically to the sticky 64px header and to `<main>`.
- **The drawer is the sidebar.** Both render the same section list, so every nav item and its permission and module gates reach the drawer automatically. Navigation MUST NOT be duplicated into a separate mobile list; the trigger keeps its "Open navigation menu" accessible name and the drawer keeps its labelled title and description.
- **375px is the floor.** Every dashboard route MUST render without horizontal scroll down to 375px.
- **In-page columns collapse on their own breakpoint.** Chat stacks to one column below 768px and becomes a `260px / 1fr / 300px` grid at `md` and up ([`apps/web/components/chat/chat-shell.tsx`](../../../apps/web/components/chat/chat-shell.tsx)); Settings is a wrapped horizontal tab row below 1024px and a 224px vertical rail at `lg` ([`apps/web/components/settings/settings-page.tsx`](../../../apps/web/components/settings/settings-page.tsx)). Both tiers count as impacted responsive behavior for those routes.

## Surviving data contracts

Per-screen truths that outlive the retired screen docs. Where a fact is canonical in `spec/behavior/`, the pointer is the fact — do not restate it here.

- **Global query defaults.** One browser-wide `QueryClient` ([`apps/web/lib/providers/query-provider.tsx`](../../../apps/web/lib/providers/query-provider.tsx)) defaults queries to `staleTime: 30_000`, `gcTime: 10 * 60_000`, `retry: 3`, `retryDelay: min(1000 * 2 ** attempt, 30_000)`, `refetchOnWindowFocus: true`, `refetchOnReconnect: "always"`, and mutations to `retry: 2` with the same backoff capped at 10s. Both retry policies are status-blind — no `networkMode` and no non-retryable-status predicate ship — so a 4xx is retried like a 5xx unless the caller sets its own `retry`; the one systematic status-driven behavior is the unauthenticated redirect under [Gating & routing semantics](#gating--routing-semantics). The chat message cache opts out with `staleTime: Infinity` because realtime, not polling, keeps it fresh.
- **Mutation optimism is opt-in, not the default.** The domain hooks in [`packages/hooks/src/`](../../../packages/hooks/src) are pessimistic — `mutationFn`, then `invalidateQueries` on success; the only `onMutate`/rollback paths that ship are the chat send ([`apps/web/lib/chat/cache.ts`](../../../apps/web/lib/chat/cache.ts)) and the chapter-config PATCH ([`apps/web/lib/hooks/use-org-config.ts`](../../../apps/web/lib/hooks/use-org-config.ts)). Two writes must stay pessimistic whatever the default becomes: invoice status transitions (`useTransitionInvoiceStatus`) and service approve/reject (`useReviewServiceEntry`) are irreversible, so the UI waits for server confirmation rather than rendering a state it cannot roll back.
- **Billing pay affordance (client gate).** The Pay action renders only when the invoice is `OPEN`, its `user_id` is the signed-in member's, and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is configured (absent → the affordance does not render, so local dev, CI, and the build prerender are unaffected). The Stripe Elements dialog confirms against the `client_secret` from `POST /v1/invoices/:id/payment-intent` with `redirect: "if_required"` (3-D Secure stays in-page), then re-reads the invoice until the server reports PAID. List scoping, failure-code mapping, and the webhook-is-truth-for-PAID rule: [`spec/behavior/billing.md`](../../behavior/billing.md) §Member payment flow.
- **Billing subscription card (checkout entry point).** `/billing` renders the subscription card first, because when a chapter is locked it is the only control on the screen that can succeed. It reads `subscription_status` from the chapter payload — the same query the subscription gate uses, never a second source — and renders nothing while that is unresolved, so a slow or failed fetch never asserts a lock. Checkout is offered **only** at `incomplete`; `past_due` and `canceled` route to the Customer Portal instead ([`spec/behavior/billing.md`](../../behavior/billing.md) §Known gap explains why a second checkout is unsafe). Stripe returns to `/billing?checkout=success|cancelled`; because the webhook — not the redirect — activates the chapter, `success` polls for the flip on a bounded schedule (10 × 3s) and invalidates both the `["chapters"]` and `["billing"]` caches so the page cannot half-update. The card reads `?checkout=` via `useSearchParams`, so it must stay under a `<Suspense>` boundary. A stale `?checkout=success` never suppresses the recovery control for a chapter that has since lapsed.
- **Slash palette fails closed.** The `cmdk` palette reads its catalog from `@repo/chat-integrations` filtered by `useOrgConfig().isModuleEnabled(requiredModule)`. While the chapter-config query is pending it renders an explicit "Loading commands…" panel; on error, a "Modules unavailable" panel with Retry — never the unfiltered catalog. Empty match → "No matching command."
- **Chat reconnect order (web client).** The client gates REST backfill (`GET /channels/:id/messages?since=<lastSeen>`) on the realtime subscription reaching `SUBSCRIBED` — subscribe first, then backfill — relying on the single idempotent per-channel merge keyed by `client_message_id` to dedupe overlap (`apps/web/lib/chat/`); that merge lands in one normalized cache per channel under query key `["chat", channelId, "messages"]`, shaped `{ byId, order, actionIndex }`. Message-delivery guarantees: [`spec/behavior/chat/README.md`](../../behavior/chat/README.md) and [`../resilience.md`](../resilience.md).
- **Chat drafts & outbox (Dexie).** `drafts(channelId, body, updatedAt)` restore on reload; `outbox(clientId, channelId, body, attempts, queuedAt, status)` flushes in order on reconnect — a 4xx moves the entry to `failed` (surfaced inline with Retry / Discard), network errors and 5xx stay queued.
- **Realtime primitive.** Live surfaces (event attendance rosters, the events list) subscribe to Postgres changes via the shared `useRealtimeTable` hook ([`apps/web/lib/realtime/use-realtime-table.ts`](../../../apps/web/lib/realtime/use-realtime-table.ts)), and one shared browser Supabase client multiplexes every subscription over a single websocket ([`apps/web/lib/realtime/supabase-realtime.ts`](../../../apps/web/lib/realtime/supabase-realtime.ts)).
- **Notification drawer.** Endpoint + realtime contract and the web-push scope decision: [`spec/behavior/notifications.md`](../../behavior/notifications.md).
- **Event role targeting.** `required_role_ids` wire semantics (omit-on-create → `null`; `[]` on update clears; empty ≡ untargeted): [`spec/behavior/events.md`](../../behavior/events.md) §Event Creation.
- **Onboarding wizard.** Trigger, re-trigger signal, and server-side config materialization via `POST /v1/chapters/onboard`: [`spec/behavior/onboarding.md`](../../behavior/onboarding.md). Wizard UI contract: full-screen overlay at [`apps/web/components/onboarding/chapter-wizard.tsx`](../../../apps/web/components/onboarding/chapter-wizard.tsx), holds the [375px mobile floor](#responsive-contract), directory combobox debounced 250ms against `GET /v1/chapter-directory/search` with explicit idle/loading/no-results/error states, and a manual-entry path that is always available.
- **Custom roles & fields CRUD.** Endpoint permissions and status-code semantics (400 wildcard capability, 403 core-role delete, 409 duplicate key, `key`/`type` immutability): [`spec/behavior/settings/customization.md`](../../behavior/settings/customization.md).
- **Points audit.** `GET /v1/points/transactions` (`points:view_all`, `limit` clamped 1–200, default 50) and anomaly flagging: [`spec/behavior/points.md`](../../behavior/points.md).
- **Config, theme, archetype.** Config reads/writes go through `GET`/`PATCH /chapters/:id/config` and every write produces an audit row mirrored to `#chapter-audit`; palette saves go through `POST /chapters/:id/theme-palette` (server recompute, applied without reload): [`spec/behavior/chapter-config.md`](../../behavior/chapter-config.md). Archetype switching resets modules/role pack/vocabulary and preserves identity, branding, and custom fields: [`spec/behavior/settings/README.md`](../../behavior/settings/README.md).

## Future reskin

The dashboard's Signet visual system — palette, type, radii, iconography, states — is specified in [`../design-system/`](../design-system/README.md). Until the reskin session lands, the implementation intentionally ships the legacy bone/bronze theme and this document stays visual-change frozen.
