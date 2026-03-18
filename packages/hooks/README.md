# `@repo/hooks`

Shared React hooks for Frapp clients, built on top of `@repo/api-sdk` and TanStack Query.

## Testing

Hook tests live next to source files in `src/*.spec.tsx` and run with Vitest (`jsdom` environment).

Run hooks tests from repo root:

- `npm exec --workspace packages/hooks vitest run`
- `npm exec --workspace packages/hooks vitest run src/use-documents.spec.tsx`
- `npm exec --workspace packages/hooks vitest run src/use-attendance.spec.tsx`

### `useDocuments` coverage

`src/use-documents.spec.tsx` validates the `useDocuments(folder?)` optional parameter behavior:

- when `folder` is provided, the hook calls `GET /v1/documents` with `params.query.folder` set to that value
- when `folder` is omitted, the hook still forms the query object with `folder: undefined`

This protects request-shape behavior during refactors of `useDocuments`.

### `useAttendance` coverage

`src/use-attendance.spec.tsx` validates:

- successful attendance fetch for a provided `eventId`
- correct API route + path params (`/v1/events/{eventId}/attendance`)
- error propagation when the API returns an error
- query disable behavior when `eventId` is empty

