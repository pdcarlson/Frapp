# `@repo/hooks`

Shared React hooks for data access via TanStack Query and the typed Frapp API client.

## Testing

Hook tests live next to source files in `src/*.spec.tsx` and run with Vitest (`jsdom` environment).

### Documents hook coverage

`src/use-documents.spec.tsx` covers the `useDocuments(folder?)` optional parameter behavior:

- when `folder` is provided, the hook calls `GET /v1/documents` with `params.query.folder` set to that value
- when `folder` is omitted, the hook still forms the query object with `folder: undefined`

This protects request-shape behavior during refactors of `useDocuments`.

### Run only documents hook tests

From repo root:

`npx vitest run packages/hooks/src/use-documents.spec.tsx --config packages/hooks/vitest.config.ts`

