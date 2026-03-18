# Hooks

This directory documents hook-level conventions and test coverage for
`packages/hooks`.

## Testing strategy

Hooks in `packages/hooks/src` are tested with Vitest, React Testing Library, and a
real `QueryClient` wrapped with `FrappClientProvider` and `QueryClientProvider`.

- Vitest (`packages/hooks/vitest.config.ts`)
- `@testing-library/react` `renderHook`
- `FrappClientProvider` + `QueryClientProvider` wrappers for realistic hook context
- Query retries disabled in tests for deterministic assertions

Core expectations for mutation hooks:

- validate request wiring (endpoint + body passed to API client)
- assert mutation state transitions (`isSuccess` / `isError`)
- verify cache invalidation side effects on success
- verify invalidation does not run on failure

## Current focused hook coverage

`useCreateInvoice` has dedicated tests in `packages/hooks/src/use-invoices.spec.tsx` for:

- successful invoice creation via `POST /v1/invoices`
- invalidating `["invoices"]` after a successful mutation
- propagating API errors to the hook consumer
- not invalidating invoice queries when the mutation fails

`useAttendance` has dedicated tests in `packages/hooks/src/use-attendance.spec.tsx` for:

- successful fetch for a valid `eventId`
- correct endpoint wiring for `GET /v1/events/{eventId}/attendance`
- propagating API errors to the hook consumer
- disabled query behavior when `eventId` is empty

`useDocuments` has dedicated tests in `packages/hooks/src/use-documents.spec.tsx` for:

- optional `folder` query parameter behavior (`folder` provided vs omitted)
- confirming upload mutations invalidate `["documents"]` on success
- propagating upload-confirmation API errors to the hook consumer
- requesting upload URLs with exact POST payload wiring
- surfacing upload URL API errors to the hook consumer

`useMembers` has dedicated tests in `packages/hooks/src/use-members.spec.tsx` for:

- successful `GET /v1/members` data flow
- propagating API errors to the hook consumer
- preventing immediate remount refetches to guard stale-time behavior

Current targeted specs include:

- `use-documents.spec.tsx` — query + mutation request-shape and error behavior
- `use-roles.spec.tsx` — query success/error behavior for `GET /v1/roles`
- `use-attendance.spec.tsx` — query success/error/disabled behavior for attendance
- `use-members.spec.tsx` — query success/error behavior for `GET /v1/members`

## Running hook tests

From `packages/hooks` run:

- `npx vitest run --config packages/hooks/vitest.config.ts packages/hooks/src/use-roles.spec.tsx` for focused `useRoles` coverage
- `npm exec --workspace packages/hooks vitest run src/use-documents.spec.tsx` for focused `useDocuments` coverage
- `npx vitest run src/use-invoices.spec.tsx` for the focused invoice hook tests
- `npm exec --workspace packages/hooks vitest run src/use-attendance.spec.tsx` for focused `useAttendance` coverage
- `npm exec --workspace packages/hooks vitest run src/use-members.spec.tsx` for focused `useMembers` coverage
- `npx vitest run` for the full hooks package suite

## Testing Additions

- **`useCreateRole`**: Added test case in `use-roles.spec.tsx` ensuring that creating a role with only the required fields properly maps the request body and executes the correct query invalidation behavior.
