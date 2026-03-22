# `@repo/ui`

Shared UI primitives for Frapp apps.

## Purpose

This package contains reusable, style-consistent building blocks that can be shared across:

- `apps/web`
- `apps/landing`

## Current primitives

- `@repo/ui/button`
- `@repo/ui/card`
- `@repo/ui/code`

## Ownership boundary

Keep in `@repo/ui`:

- low-level primitives
- generic display components
- cross-app presentational building blocks

Keep in app-local folders (`apps/*/components`):

- product-specific composites
- feature-specific UI tied to one surface
- route-specific layouts and behaviors
