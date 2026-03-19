# `use-attendance` Hook Specifications

## Target: `useCheckIn` Hook
This document specifies the behavior and test cases for the `useCheckIn` React Query hook located in `packages/hooks/src/use-attendance.ts`.

### Functionality
The `useCheckIn` hook abstracts the API interaction for a user checking in to an event. It leverages `@tanstack/react-query` to handle mutation states and interacts with the API via `FrappClient`.

### Behavior & Expectations
1.  **Endpoint Interaction**: Upon calling the mutation function (e.g., `mutateAsync(eventId)`), the hook must dispatch an HTTP `POST` request to `/v1/events/{eventId}/attendance/check-in`.
2.  **Cache Invalidation**: Upon a successful response from the server, the hook must automatically invalidate any active queries associated with the `["attendance", eventId]` query key to ensure the local cache refetches the most up-to-date attendance data.
3.  **Error Handling**: If the API request fails, the hook must throw the respective error so it can be handled by error boundaries or the consumer of the hook.

### Test Coverage (`packages/hooks/src/use-attendance.spec.tsx`)
The tests enforce the behaviors described above using Vitest and React Testing Library:
-   **Success Path**: Verifies that calling `mutateAsync` successfully resolves and triggers `queryClient.invalidateQueries` with the correct `["attendance", eventId]` key.
-   **Error Path**: Verifies that a rejected API request causes `mutateAsync` to reject with the same error instance.
