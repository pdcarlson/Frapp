# `useAttendance` and `useCheckIn` Hook Specs

## `useCheckIn`

The `useCheckIn` hook provides a mutation to allow a user to check into an event.

### Usage

```typescript
const { mutate, mutateAsync, isPending, isError, error } = useCheckIn();

// Usage
await mutateAsync("event-123");
```

### Tests

- **Happy Path:** Calling `mutateAsync(eventId)` sends a POST request to `/v1/events/{eventId}/attendance/check-in` with an empty body. On success, the `attendance` query for the corresponding event ID is invalidated in the `QueryClient`.
- **Error Path:** If the request fails, the mutation rejects with the error and the attendance query is not invalidated.
