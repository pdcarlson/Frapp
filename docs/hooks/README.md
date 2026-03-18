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

Current targeted specs include:

- `use-documents.spec.tsx` — mutation success/error behavior
- `use-roles.spec.tsx` — query success/error behavior for `GET /v1/roles`

## Running hook tests

From `packages/hooks` run:

- `npx vitest run --config packages/hooks/vitest.config.ts packages/hooks/src/use-roles.spec.tsx` for focused `useRoles` coverage
- `npx vitest run src/use-invoices.spec.tsx` for the focused invoice hook tests
- `npx vitest run` for the full hooks package suite
