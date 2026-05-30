# Web Dashboard — State, Resilience & Accessibility

> Data-fetching patterns, network resilience, and accessibility rules for the dashboard. The shell is in [README.md](README.md); screens in [screens.md](screens.md). Cross-app empty/loading/message-delivery rules also live in [`../resilience.md`](../resilience.md).

---

## State management & data fetching

### Stack

- **TanStack Query v5** — server state (API data).
- **Zustand** (where needed) — client state (sidebar open, active filters, UI preferences).
- **`@repo/api-sdk`** — typed API client.
- **`@repo/hooks`** — TanStack Query wrappers per domain.

### Query pattern

```typescript
function useMembers(chapterId: string) {
  return useQuery({
    queryKey: ["members", chapterId],
    queryFn: () =>
      client.GET("/v1/members", { headers: { "x-chapter-id": chapterId } }),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
  });
}
```

### Mutation pattern

Mutations use optimistic updates where appropriate, with rollback on error:

```typescript
function useUpdateMemberRoles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params) => client.PATCH('/v1/members/{id}/roles', { ... }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ['members'] });
      const prev = queryClient.getQueryData(['members']);
      queryClient.setQueryData(['members'], (old) => /* optimistic update */);
      return { prev };
    },
    onError: (err, vars, ctx) => {
      queryClient.setQueryData(['members'], ctx?.prev); // rollback
      toast.error('Failed to update roles. Please try again.');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['members'] }),
  });
}
```

### Loading states

Every page/section has three states:

1. **Loading (first load):** skeleton placeholders matching the exact layout shape. Never a blank white screen.
2. **Error:** an error boundary with a retry button + message. Never raw error strings.
3. **Empty:** an illustrated empty state with an action CTA ("No events yet. Create your first event →").

Background refetches (stale-data refresh) are invisible — stale data stays visible while the fresh data loads.

### Chat hot-path cache

The chat surface maintains one normalized cache per channel under `["chat", channelId, "messages"]`: `{ byId, order, actionIndex }`. Every inbound row (API response, Postgres Changes, REST backfill) flows through one idempotent `mergeServerRow`, reconciled by `client_message_id`.

- Sends go to the NestJS chat controller (`POST /v1/channels/{id}/messages`); reactions and card actions hit `POST /v1/channels/messages/{messageId}/actions`; reaction removes use a direct RLS-protected delete on `chat_message_actions` (the policy scopes deletes to the viewer's own rows). The viewer identity comes from `useFrappUser().userId` — never a literal.
- **Reconnect:** the per-channel Postgres Changes subscription status drives the "Reconnecting…" pill with exponential backoff 1→2→4→8→16→30s cap. On reconnect, the client **resubscribes first** (so live rows route through the same merge), **then** REST-backfills via `?since=<lastSeen>` so any gap closes idempotently.
- **Presence:** on every channel attach the client calls `channel.track({ userId, ts })` on the `chat:channel:<id>` topic so the push worker can skip recipients currently in the channel.

---

## Network resilience & offline handling

### Design principles

1. **Never lose user work.** A failed request must inform the user and offer recovery.
2. **Optimistic by default.** Show the result immediately; roll back on failure.
3. **Degrade gracefully.** Show cached data when offline; disable writes with clear messaging.
4. **Retry transparently.** Failed requests retry automatically with exponential backoff.

### Offline detection & banner

```typescript
const [isOnline, setIsOnline] = useState(navigator.onLine);
useEffect(() => {
  const handleOnline = () => setIsOnline(true);
  const handleOffline = () => setIsOnline(false);
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  return () => { /* cleanup */ };
}, []);
```

When `isOnline === false`, a persistent banner sits at the top of the content area — "You're offline. Showing cached data. Changes will sync when you reconnect." Amber background, slides down (200ms), auto-dismisses on reconnect.

### TanStack Query resilience config

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
      refetchOnWindowFocus: true,
      refetchOnReconnect: "always",
      networkMode: "offlineFirst",
    },
    mutations: {
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
      networkMode: "offlineFirst",
    },
  },
});
```

### Optimistic update strategy by domain

| Domain | Action | Optimistic? | Rollback strategy |
| ------ | ------ | ----------- | ----------------- |
| Members | Update roles | Yes | Revert role_ids, show toast |
| Members | Remove member | No (destructive) | Wait for confirmation |
| Events | Create event | Yes | Remove from list, show toast |
| Events | Delete event | No (destructive) | Wait for confirmation |
| Points | Adjust points | Yes | Revert transaction, show toast |
| Chat | Send message | Yes | Mark message "failed", show retry |
| Chat | Delete message | Yes | Restore message, show toast |
| Invoices | Create invoice | Yes | Remove from list, show toast |
| Invoices | Transition status | No (irreversible) | Wait for confirmation |
| Tasks | Update status | Yes | Revert status, show toast |
| Service | Approve/Reject | No (irreversible) | Wait for confirmation |

### Offline composer queue (chat)

The chat composer persists work through reloads and reconnects via **Dexie** (IndexedDB):

- `drafts(channelId, body, updatedAt)` — drafts restore on reload.
- `outbox(clientId, channelId, body, attempts, queuedAt, status)` — flushed in order on reconnect. A 4xx response moves the entry to a `failed` state surfaced inline with Retry / Discard; network/5xx stays queued.

For non-chat surfaces, a generic offline mutation queue is a future enhancement; for now a mutation attempted while offline shows a blocking toast ("You're offline. Please reconnect to make changes.").

### Error recovery patterns

- **Transient (5xx, timeout):** auto-retry with backoff; after 3 retries → "Something went wrong. [Retry] [Dismiss]".
- **Auth (401):** redirect to login, preserving the current URL for post-login redirect.
- **Validation (400):** field-level inline errors; never auto-retry.
- **Rate limit (429):** "Too many requests. Please wait a moment." — disable the button for the `Retry-After` duration, then auto-retry.
- **Conflict (409):** a specific message (e.g. "This invite has already been used") + refresh the relevant data.

---

## Accessibility

| Requirement | Implementation |
| ----------- | -------------- |
| Keyboard navigation | All interactive elements focusable, visible focus rings (`ring-2 ring-primary`) |
| Screen reader | Semantic HTML, ARIA labels on icons, `role` attributes on custom widgets |
| Color contrast | WCAG AA (4.5:1 text, 3:1 large text), tested against the theme tokens |
| Focus management | Modal open → focus first input; modal close → focus trigger |
| Reduced motion | `prefers-reduced-motion` → disable animations |
| Skip to content | Hidden "Skip to main content" link, visible on focus |
| Form errors | `aria-describedby` associates error messages; `aria-invalid` on fields |
| Command triggers | Command-menu triggers spell out shortcuts in `aria-label` (e.g. "Command K") so AT users get the shortcut, not just the visible "⌘K" glyph |
| Reaction chips | `<button aria-pressed>` reflecting the viewer's vote state |
