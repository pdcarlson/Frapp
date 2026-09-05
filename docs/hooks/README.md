# Hooks

This directory documents hook-level conventions and test coverage for
`packages/hooks`.

## Query keys and chapter scope

Endpoints that return data for the active chapter must include the active
chapter id in the TanStack Query cache key (see `useActiveChapterId` in
`use-frapp-client.tsx`). For example, `useSearch` uses
`["search", chapterId, query]` so the command palette and chat search cannot
show results cached from another chapter after a switch.

Tasks use the `taskKeys` factory in `use-tasks.ts` — `taskKeys.lists(chapterId)`
and `taskKeys.detail(chapterId, id)`. Two things it fixes are worth knowing
before adding a family of your own:

- The old keys were `["tasks", assigneeId]` and `["tasks", id]`, neither
  chapter-scoped. On web the bleed was masked by the wholesale
  `queryClient.clear()` in `apps/web/lib/providers/frapp-client-provider.tsx`.
  Mobile's `FrappProvider` now runs the same clear (#1042), so both platforms
  hold the invariant — but **do not rely on either clear**: it is defense in
  depth, not the scoping. A key without the chapter id in it is still a bug, and
  `createChapterQueryKeys` is what makes that a type error.
- `["tasks", undefined]` (the list) and `["tasks", "<uuid>"]` (a detail) are
  structurally indistinguishable, so no prefix could mean "every list" without
  also matching every detail. The explicit `"list"` / `"detail"` segment is what
  lets a mutation invalidate precisely.

**New families use `createChapterQueryKeys` in `chapter-query-keys.ts`.** It is
the same shape as `taskKeys`, with `chapterId: string` as a mandatory first
argument — omitting it, or passing `null`, is a type error. Existing call sites
still use ad-hoc literals (some still `string | null`); those migrate in a
later pass. Do not add `string | null` to the factory to make a disabled query
type-check — leave the query `enabled: false` instead of building an unscoped
key.

## Optimistic mutations

`useUpdateNotificationPreference` (`use-notifications.ts`) and the three task
lifecycle mutations (`use-tasks.ts`) are the reference implementations. A new
one should follow this shape:

- `onMutate` — `cancelQueries` first (an in-flight GET that started before the
  write has not observed it, and letting it land looks like the write was lost),
  then snapshot, then write.
- **Never write into an entry that is `undefined`.** That means the query has
  never resolved, so there is no server answer to predict against — and it is
  unrollbackable, because query-core ignores a `setQueryData` of `undefined`.
  Leave shapes you do not recognise byte-identical for the same reason.
- `onError` — revert **surgically**, field by field or row by row, and only
  while the cache still holds what this mutation wrote. Mutation-level callbacks
  always fire in v5, so a slow failure can land after a fast success on the same
  record; restoring a whole snapshot there silently undoes the newer write.
- `onSettled`, not `onSuccess` — a failed write must reconcile too, or the
  rolled-back value stays unverified against the server.
- Keep the user-facing failure message at the call site, passed as a
  per-`mutate()` `onError`. This package has no toast and React Native has none
  at all. v5 drops the per-call callback for a superseded mutation, which is
  right for a toast and wrong for a rollback — hence the split.
- **Set `retry: false` on a non-idempotent mutation.** `apps/web` defaults every
  mutation to `retry: 2` (`apps/web/lib/providers/query-provider.tsx`). For a
  compare-and-set transition — the task status/confirm/reject routes — a first
  attempt whose response is merely lost leaves the retry to be answered with a
  guaranteed 400, so the rollback undoes a write that actually landed and
  reports a failure for an action that succeeded.

Two existing optimistic mutations do **not** follow the surgical-revert rule and
should not be copied as templates: `useUpdateUserSettings` (`use-notifications.ts`)
and `usePatchOrgConfig` (`use-org-config.ts`) both restore a
whole snapshot. Each writes a single object edited from one form, so the race is
narrower there — but it is the same race, and neither is the shape to imitate.

## Testing strategy

Hooks in `packages/hooks/src` are tested with Vitest, React Testing Library, and a
real `QueryClient` wrapped with `FrappClientProvider` and `QueryClientProvider`.

## Event query keys

`useEvent` caches each event under `["events", chapterId, id]` (see `use-events.ts`), not `["events", id]`. Any TanStack Query invalidation that should refresh the event detail after related data changes (for example realtime attendance updates in the web app) must include the same `chapterId` segment from `useActiveChapterId()` so prefix matching hits the mounted query.

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

From the repo root, `npm run test -w packages/hooks` runs the whole suite — this
is the command CI uses. The `web-tests` job in
[`ci.yml`](../../.github/workflows/ci.yml) runs it, reached via that job's `packages/**` path
filter. Which other workspaces share that job is owned by
[`GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md)
§ Required Status Checks and by `scripts/ci/lib/required-checks.mjs`; this page does not restate it,
because the copy that used to live here had already gone stale.

`web-tests` **is a required status check** (ADR-15 2026-08-19 amendment — see
[`spec/architecture/README.md`](../../spec/architecture/README.md)). The
required-check list lives in
[`scripts/ci/lib/required-checks.mjs`](../../scripts/ci/lib/required-checks.mjs).

Collection is pinned to `src` by `packages/hooks/vitest.config.ts`. That is
load-bearing: `npm run build` compiles the specs to `dist/` as CommonJS, and
Vitest 4 no longer excludes `dist` by default, so an unscoped run collects the
twins and fails (#762).

## Testing Additions

- **`useCreateRole`**: Added test case in `use-roles.spec.tsx` ensuring that creating a role with only the required fields properly maps the request body and executes the correct query invalidation behavior.
  Update: Added tests for useCheckIn hook
- **`useSearch`**: `use-search.spec.tsx` covers success wiring, disabled states without a chapter or query, and cache isolation per chapter for the same search string.
