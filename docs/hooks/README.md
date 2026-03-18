# Hooks

## Testing strategy

Hooks in `packages/hooks/src` are tested with Vitest, React Testing Library, and a
real `QueryClient` wrapped with `FrappClientProvider` and `QueryClientProvider`.

Core expectations for mutation hooks:

- validate request wiring (endpoint + body passed to API client)
- assert mutation state transitions (`isSuccess` / `isError`)
- verify cache invalidation side effects on success
- verify invalidation does not run on failure

## Invoice hook coverage

`useCreateInvoice` now has dedicated tests in
`packages/hooks/src/use-invoices.spec.tsx` for:

- successful invoice creation via `POST /v1/invoices`
- invalidating `["invoices"]` after a successful mutation
- propagating API errors to the hook consumer
- not invalidating invoice queries when the mutation fails

## Running hook tests

From `packages/hooks`:

- `npx vitest run src/use-invoices.spec.tsx` for the focused invoice hook tests
- `npx vitest run` for the full hooks package suite
