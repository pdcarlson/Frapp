# `@repo/hooks`

Shared React hooks for Frapp clients, built on top of `@repo/api-sdk` and TanStack Query.

## Testing

Run hooks tests from repo root:

- `npm exec --workspace packages/hooks vitest run`
- `npm exec --workspace packages/hooks vitest run src/use-attendance.spec.tsx`

## `useAttendance` coverage

`packages/hooks/src/use-attendance.spec.tsx` now validates:

- Successful attendance fetch for a provided `eventId`
- Correct API route + path params (`/v1/events/{eventId}/attendance`)
- Error propagation when the API returns an error
- Query disable behavior when `eventId` is empty
