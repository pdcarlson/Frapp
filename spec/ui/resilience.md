# Network Resilience & Message Delivery Specification

> Users on slow, flaky, or intermittent connections must have a reliable experience. Messages must never be silently lost. Actions must never appear to succeed when they haven't.

---

## 1. Guiding Principles

1. **Show, don't guess.** Always show the user the true state of their action (pending, succeeded, failed).
2. **Cache aggressively, refetch quietly.** Stale data is better than no data. Refresh in the background.
3. **Retry automatically, inform manually.** Transient failures retry silently. Persistent failures require user action.
4. **Optimistic where safe, pessimistic where destructive.** Creating/updating is optimistic. Deleting/paying is pessimistic.
5. **Never lose a message.** Chat messages are the highest-priority data for reliability.

---

## 2. Connection State Machine

```
        ┌──────────┐
        │  ONLINE  │ ◄── Normal operation
        └────┬─────┘
             │ navigator.onLine → false
             │ OR 3 consecutive request failures
             ▼
        ┌──────────┐
        │ DEGRADED │ ◄── Slow/flaky connection
        └────┬─────┘
             │ All requests failing
             │ navigator.onLine → false
             ▼
        ┌──────────┐
        │ OFFLINE  │ ◄── No connection
        └────┬─────┘
             │ navigator.onLine → true
             │ AND health check succeeds
             ▼
        ┌──────────┐
        │  ONLINE  │
        └──────────┘
```

### Detection Logic

```typescript
type ConnectionState = 'ONLINE' | 'DEGRADED' | 'OFFLINE';

// Maintained by a global provider
// - 'ONLINE': navigator.onLine && recent requests succeeding
// - 'DEGRADED': navigator.onLine but requests are slow (>5s) or intermittently failing
// - 'OFFLINE': !navigator.onLine OR health check to /health fails 3 times
```

### UI Indicators

| State | Banner | Write Actions | Read Actions |
|-------|--------|--------------|--------------|
| ONLINE | None | Enabled | Enabled (live data) |
| DEGRADED | "⚡ Slow connection. Some features may be delayed." (amber) | Enabled (with extended timeouts) | Enabled (from cache + refetch) |
| OFFLINE | "📡 You're offline. Showing cached data." (red/amber) | Disabled with tooltip: "Reconnect to make changes" | Enabled (from cache) |

Banner behavior:
- Appears at the top of the content area (below header bar)
- 200ms slide-down animation
- Auto-dismisses when state improves
- User can manually dismiss (it reappears if state hasn't changed after 30s)

---

## 3. Chat Message Delivery Guarantees

Chat messages are the most latency-sensitive and loss-sensitive data in the app. The system must handle:
- User sends message on slow 3G connection
- User sends message and immediately loses connection
- User receives a message while in DEGRADED state
- Multiple messages sent rapidly before any response

### 3.1 Sending Messages

**State machine for each outgoing message:**

```
   SENDING → SENT → DELIVERED
      │
      ├──(timeout 10s)──→ RETRY_1 → RETRY_2 → RETRY_3 → FAILED
      │
      └──(immediate error)──→ FAILED
```

**UI representation:**

| State | Indicator | User Action |
|-------|-----------|-------------|
| SENDING | Subtle spinner or clock icon next to message | None needed |
| SENT | Single checkmark (✓) | None needed |
| DELIVERED | Double checkmark (✓✓) — future, requires read receipts | None needed |
| FAILED | Red warning icon (⚠) + "Failed to send" | [Retry] [Delete] buttons |

**Implementation:**

```typescript
// In ChatService (frontend, not API)
async function sendMessage(channelId: string, content: string) {
  const tempId = crypto.randomUUID();
  const optimisticMessage = {
    id: tempId,
    content,
    sender_id: currentUser.id,
    created_at: new Date().toISOString(),
    _status: 'SENDING', // local-only field
  };

  // 1. Add to local message list immediately (optimistic)
  queryClient.setQueryData(
    ['messages', channelId],
    (old) => [...(old ?? []), optimisticMessage],
  );

  // 2. Send to API with retry
  try {
    const response = await mutateWithRetry(
      () => api.POST('/v1/channels/{id}/messages', { ... }),
      { maxRetries: 3, baseDelay: 1000 }
    );

    // 3. Replace optimistic message with real one
    queryClient.setQueryData(
      ['messages', channelId],
      (old) => old.map((m) => m.id === tempId ? { ...response, _status: 'SENT' } : m),
    );
  } catch (error) {
    // 4. Mark as failed (keep in list so user can retry)
    queryClient.setQueryData(
      ['messages', channelId],
      (old) => old.map((m) => m.id === tempId ? { ...m, _status: 'FAILED' } : m),
    );
  }
}
```

### 3.2 Receiving Messages (Realtime)

**Primary channel:** Supabase Realtime (Postgres Changes subscription on `chat_messages` filtered by `channel_id`).

**Fallback:** If Supabase Realtime disconnects or fails, fall back to polling.

```
Supabase Realtime (preferred)
       │
       ├── Connected → receive inserts/updates in real-time
       │
       └── Disconnected (>10s) → switch to polling mode
                                  Poll every 5s for new messages
                                  Show banner: "Real-time updates paused. Polling for new messages."
                                  
                                  When Realtime reconnects → switch back
                                  Fetch any messages missed during the gap
```

**Gap recovery:** When Realtime reconnects after a disconnect:
1. Fetch messages created after the last known message timestamp
2. Merge into the local message list (deduplicate by ID)
3. This ensures no messages are lost during the disconnect window

### 3.3 Message Ordering

Messages are ordered by `created_at` (server timestamp). Optimistic messages use the client's local time but are re-sorted when the server response arrives with the canonical timestamp. This prevents ordering issues when clocks are slightly off.

### 3.4 Typing Indicators

Typing indicators use Supabase Realtime Broadcast (ephemeral, not persisted). They are best-effort and non-critical.

- If the Broadcast channel is disconnected, typing indicators simply don't show — no fallback needed
- Typing events expire after 5 seconds of no keystrokes (client-side timer)
- Never show "User is typing..." for the current user's own messages

---

## 4. API Request Retry Strategy

### Retry Configuration

```typescript
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,         // 1 second
  maxDelay: 30_000,        // 30 seconds
  backoffMultiplier: 2,    // exponential: 1s, 2s, 4s
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  nonRetryableStatusCodes: [400, 401, 403, 404, 409, 422],
};
```

### Retry Logic

```typescript
async function fetchWithRetry(fn, config = RETRY_CONFIG) {
  let lastError;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;

      if (config.nonRetryableStatusCodes.includes(status)) {
        throw error; // Don't retry client errors
      }

      if (attempt < config.maxRetries) {
        const delay = Math.min(
          config.baseDelay * config.backoffMultiplier ** attempt,
          config.maxDelay,
        );
        // Add jitter: ±25%
        const jitter = delay * (0.75 + Math.random() * 0.5);
        await new Promise((r) => setTimeout(r, jitter));
      }
    }
  }
  throw lastError;
}
```

### Per-Endpoint Timeout Configuration

| Endpoint Category | Timeout | Retry | Notes |
|-------------------|---------|-------|-------|
| Read (GET) | 15s | 3x | Stale cache shown while retrying |
| Write (POST/PATCH) | 20s | 2x | Optimistic UI + rollback |
| File upload (signed URL) | 60s | 1x | Large payloads |
| Webhook (POST /webhooks) | 30s | 0x | Server-initiated, not user-facing |
| Search (GET /search) | 10s | 1x | Debounced input, non-critical |
| Chat send (POST messages) | 10s | 3x | High priority, see §3.1 |

---

## 5. Form Submission Resilience

### Preventing Double Submission

Every form submission button:
1. Disables on click
2. Shows loading spinner
3. Re-enables on success or failure
4. Uses a mutation lock (TanStack Query's `isPending` state)

```tsx
<Button disabled={mutation.isPending} onClick={handleSubmit}>
  {mutation.isPending ? <Spinner /> : 'Save'}
</Button>
```

### Preserving Unsaved Work

For long forms (event creation, invoice creation, settings):
1. Auto-save draft to `sessionStorage` every 5 seconds while the form is dirty
2. On page load, check for a saved draft and offer to restore: "You have unsaved changes. [Restore] [Discard]"
3. Clear the draft on successful submission

### Handling Concurrent Edits

When two admins edit the same resource simultaneously:
1. The API returns the updated resource with its `updated_at` timestamp
2. If the client's known `updated_at` is older than the server's, show: "This resource was modified by another user. [Refresh] [Overwrite]"
3. For v1: last-write-wins is acceptable for most resources. Chat messages are append-only so this doesn't apply.

---

## 6. Supabase Realtime Connection Management

### Connection Lifecycle

```typescript
// Global Realtime connection manager
class RealtimeManager {
  private channels = new Map<string, RealtimeChannel>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000; // starts at 1s, exponential to 30s

  // Called on app startup after auth
  connect() {
    this.supabase.realtime.onOpen(() => {
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      this.resubscribeAll();
    });

    this.supabase.realtime.onClose(() => {
      this.scheduleReconnect();
    });

    this.supabase.realtime.onError(() => {
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      // Show persistent banner: "Real-time updates unavailable. Falling back to polling."
      this.startPollingFallback();
      return;
    }
    
    const delay = Math.min(
      this.reconnectDelay * 2 ** this.reconnectAttempts,
      30_000,
    );
    setTimeout(() => {
      this.reconnectAttempts++;
      this.supabase.realtime.connect();
    }, delay);
  }
}
```

### Channel Subscriptions

For each open chat channel, subscribe to Postgres changes:

```typescript
supabase
  .channel(`messages:${channelId}`)
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'chat_messages',
    filter: `channel_id=eq.${channelId}`,
  }, (payload) => {
    // Add to local message list if not already present (dedup by ID)
    queryClient.setQueryData(['messages', channelId], (old) => {
      if (old?.some((m) => m.id === payload.new.id)) return old;
      return [...(old ?? []), payload.new];
    });
  })
  .subscribe();
```

### Cleanup

When navigating away from a channel, unsubscribe from its Realtime channel to avoid unnecessary bandwidth:

```typescript
useEffect(() => {
  const channel = supabase.channel(`messages:${channelId}`);
  // ... subscribe
  return () => {
    supabase.removeChannel(channel);
  };
}, [channelId]);
```

---

## 7. Image and File Upload Resilience

### Upload Flow

```
[User selects file]
       │
       ▼
[Request signed URL from API]  ← retry 2x on failure
       │
       ▼
[Upload file to Supabase Storage via signed URL]
       │ ← show progress bar (XHR progress event)
       │ ← timeout: 60s for files up to 25MB
       │
       ▼
[Confirm upload with API (send metadata)]  ← retry 2x
       │
       ▼
[Success: show uploaded file/image]
```

### Progress Indicator

For file uploads, show a progress bar with percentage:

```typescript
const xhr = new XMLHttpRequest();
xhr.upload.onprogress = (e) => {
  if (e.lengthComputable) {
    setProgress(Math.round((e.loaded / e.total) * 100));
  }
};
```

### Upload Failure Recovery

| Failure Point | Recovery |
|---------------|----------|
| Signed URL request fails | Retry 2x. On persistent failure: "Upload failed. Please try again." |
| Upload to Storage fails (network) | Show "Upload interrupted. [Retry]". Do NOT re-request signed URL (reuse). |
| Upload to Storage fails (timeout) | Show "Upload timed out. Check your connection and try again." |
| Confirm metadata fails | File is in storage but not tracked. Retry confirm 3x. On persistent failure: "File uploaded but not saved. [Retry]" |

### Chunked Upload (Future Enhancement)

For files > 5MB, consider chunked upload for resumability. Not in v1 scope, but the signed URL flow supports it.

---

## 8. Caching Strategy

### Cache Layers

| Layer | Storage | TTL | Purpose |
|-------|---------|-----|---------|
| TanStack Query memory | In-memory | `staleTime` per query | Active session data |
| TanStack Query persistence | `localStorage` via `persistQueryClient` | 24 hours | Survive page refreshes |
| Service Worker (future) | Cache API | Varies | Offline asset caching |

### Per-Domain Cache Configuration

| Domain | staleTime | gcTime | Rationale |
|--------|----------|---------|-----------|
| Members | 60s | 10min | Changes rarely, can tolerate staleness |
| Roles | 60s | 10min | Changes very rarely |
| Events | 30s | 5min | New events / check-ins moderately frequent |
| Points / Leaderboard | 30s | 5min | Points change frequently during events |
| Chat messages | 0s (always fresh via Realtime) | 30min | Real-time primary, cache for history |
| Chat channels | 60s | 10min | Channel list changes rarely |
| Notifications | 10s | 5min | Time-sensitive, refresh often |
| Backwork | 60s | 10min | Content changes infrequently |
| Settings | 5min | 30min | Very rarely changes |
| Invoices | 30s | 5min | Status transitions are time-sensitive |
| Service entries | 30s | 5min | Approval queue is time-sensitive |
| Tasks | 30s | 5min | Status changes are frequent |

### Cache Invalidation Triggers

| Event | Invalidate |
|-------|-----------|
| User sends message | `['messages', channelId]` |
| User creates event | `['events', chapterId]` |
| User adjusts points | `['points', chapterId]`, `['leaderboard']` |
| User changes roles | `['members', chapterId]`, `['roles']` |
| Supabase Realtime event | Relevant query key (auto-updated) |
| Window focus (tab switch) | All stale queries (TanStack built-in) |
| Network reconnect | All queries (forced refetch) |

---

## 9. Performance Budgets (Web Dashboard)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Initial page load (FCP) | < 1.5s | Lighthouse |
| Time to Interactive | < 3.0s | Lighthouse |
| Route transition | < 300ms | Performance observer |
| API response display | < 500ms | From fetch to render |
| Chat message send → display | < 200ms | Optimistic (local) |
| Chat message receive → display | < 500ms | Realtime → render |
| Bundle size (initial JS) | < 200KB gzipped | Webpack analyzer |
| Bundle size (per-route chunk) | < 50KB gzipped | Code splitting |

### Optimization Techniques

- **Code splitting:** Each route is a dynamic import (`next/dynamic` or route-based splitting)
- **Tree shaking:** ShadCN imports are per-component (no barrel exports)
- **Image optimization:** `next/image` for all images, WebP/AVIF
- **Font optimization:** `next/font` for Geist Sans (self-hosted, subset)
- **Prefetching:** `<Link prefetch>` for likely navigation targets (sidebar items)
- **Virtualization:** `@tanstack/react-virtual` for long lists (members, messages, transactions)
