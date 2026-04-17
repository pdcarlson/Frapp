# Frapp Admin Dashboard

## Overview
The Frapp Admin Dashboard (`apps/web`) is the central operating system for Greek Life chapter operations. It provides an interface for chapter admins to manage events, members, points, billing, and other core functions.

## Home Page (`/`)
The main landing page for the admin dashboard provides an overview card indicating that the foundation is active.

### Components
- **Card, CardHeader, CardTitle, CardDescription:** These components structure the introductory messaging for the dashboard.
- **Buttons (In Progress):** Currently, authentication workflows and internal routing are being rolled out. As such, the "Sign in" and "Dashboard routes" buttons are currently disabled with accessibility aria-labels attached. 

## Roadmap
As new administrative workflows are completed, the initial placeholder page will be expanded to support full navigation.

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
`canAny()` / `canAll()` from `apps/web/lib/auth/can.ts`.

A dedicated `/no-access` route explains the next steps for signed-in users who
have no chapter role assigned; individual screens can direct users there
rather than dumping them at the sign-in page.
