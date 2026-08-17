# Frapp Admin Dashboard

## Overview
The Frapp Admin Dashboard (`apps/web`) is the central operating system for Greek Life chapter operations. It provides an interface for chapter admins to manage events, members, points, billing, and other core functions.

## Entry point (`/`)
`/` is the **unauthenticated landing page** — headline, highlight cards, and live sign-in / sign-up / join CTAs. Once a Supabase session exists it redirects to `/chat`. `/dashboard` and the `(dashboard)` route-group index redirect to `/chat` unconditionally.

There is no dashboard home screen. The standalone `/home` overview was removed in the chat-first redesign; chapter health at a glance is re-homed as an inline chat artifact, the pulse card — see [`spec/behavior/chat/catch-up.md`](../../spec/behavior/chat/catch-up.md). Post-sign-in navigation is the sidebar described below, not a landing dashboard.

### Offline Support and Testing
The admin dashboard includes an `OfflineBanner` component to gracefully handle network degradation and offline scenarios. The component logic is fully covered by unit tests configured using `vitest` and `@testing-library/react`.

### Permission-aware navigation
The sidebar and mobile sheet render from a single nav config
(`apps/web/components/layout/nav-config.ts`) grouped into Overview / People /
Operations / Communications / Resources / Finance / Settings sections. Each
entry declares an optional `requirePermission` or `requireAnyOf` rule; the
shell hides items the caller cannot access and disables roadmap items with a
`Soon` chip. The caller's effective permission set is loaded once per chapter
via `GET /v1/users/me/permissions` (backed by
`RbacService.getEffectivePermissions`), cached with TanStack Query, and reused
by any component that wraps controls in `<Can>` or calls `can()` /
`canAny()` / `canAll()` from `@repo/validation`
(`packages/validation/src/permissions.ts`). Those helpers moved out of
`apps/web` when `apps/mobile` needed the same gate for its host check-in screen
— the wildcard `*` rule has to match the server's `PermissionsGuard`, and a
per-app copy is how that drifts.

A dedicated `/no-access` route explains the next steps for signed-in users who
have no chapter role assigned; individual screens can direct users there
rather than dumping them at the sign-in page.
