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

> **`navigator.onLine` is the web half of that rule; mobile has no such property.**
> React Native defines `navigator` but never sets `onLine`, so `!navigator.onLine`
> evaluates `undefined === false` → `false` and a naive port reports *permanently
> online*. The mobile equivalent of the clause is an `expo-network` read, and the
> banner takes only the **link** half of it (`isConnected === false`). Everything
> else in this section reads the same on both surfaces: one link signal, one
> `/health` poll (30s, 5s timeout), three consecutive failures.
>
> **`isInternetReachable === false` is suspicion, not proof.** `lib/chat/network-state.ts`'s
> `isOfflineFromExpoState` ORs it with the link, and that is right *for the outbox*,
> where a false "offline" only means "queue instead of send" and costs nothing. It is
> wrong for this banner, because this value gates writes: a chapter house whose
> captive-portal validation probe is blocked reports `isInternetReachable: false`
> while the API is perfectly reachable, and folding that into OFFLINE would disable
> check-in at the door with no route back — a down link also suppresses the `/health`
> probe that would have proved otherwise. So it counts as one probe failure and
> `/health` settles it, which is also what § 2 literally says: `!navigator.onLine`
> is the OFFLINE clause, "intermittently failing" is DEGRADED.

**Two inputs, not one.** A device link is not reachability, which is why `DEGRADED`
exists at all: an API that is up, routable and failing leaves the member connected
while the app does not work, and "you're offline" is a lie they can disprove by
opening a browser.

### UI Indicators

| State | Banner | Write Actions | Read Actions |
|-------|--------|--------------|--------------|
| ONLINE | None | Enabled | Enabled (live data) |
| DEGRADED | "Slow connection. Some features may be delayed." (amber) | Enabled (with extended timeouts) | Enabled (from cache + refetch) |
| OFFLINE | "You're offline. Showing cached data." (red/amber) | **Labeled where a queue exists; disabled with "Reconnect to make changes." where none does** — see below | Enabled (from cache) |

**The copy above lost its leading ⚡ / 📡.** Those predate Signet's iconography
rule, which governs glyphs on these surfaces and does not admit emoji
([`design-system/iconography.md`](design-system/iconography.md)), and the semantic
tint already carries the severity they stood in for. The strings are otherwise
verbatim and mobile ships them exactly. `apps/web` still ships a **third** variant —
`"You're offline. Showing cached data. Changes will sync when you reconnect."` with
lucide `WifiOff` / `Zap` icons (`apps/web/components/shared/offline-banner.tsx`) —
left alone for the web reskin rather than changed from a mobile slice.

**Write gating is "labeled, never blocked, wherever an outbox exists."** The
disabled-with-tooltip rule holds only where a failed write is *lost*. It must not be
applied to a surface with a queue: the chat composer's `sendMessage` enqueues to the
outbox and returns before touching the network, so gating it would defeat the queue
built to make composing-while-offline work — it stays enabled and gains the label
"You're offline — messages send when you reconnect."

**Web violated this until the #920 chat slice.** `apps/web` passed `disabled`
into the composer on `connection === "offline"`, and `submit()` returned early
on the same flag — so Send greyed out and Enter did nothing at all, with no
explanation, on the one surface built to survive being offline. (The draft
itself survived; the loss was the send, not the text.) The composer now takes an
`isOffline` prop that only renders the label;
`packages/chat-core/src/chat-client.ts` has had the "Offline: the row is safely
queued" branch the whole time, unreachable from web.

**The split runs inside that one control**, which is the part worth carrying to
other surfaces. The text path queues, so it stays live and is labelled. The
**slash commands do not**: `/points`, `/task` and `/event` POST straight to
their controllers from `packages/chat-core/src/dispatch.ts` with no outbox
behind them, so an offline dispatch is a queueless write and refuses — before
clearing the composer, so the typed command survives to be re-sent. One control,
both halves of this rule, decided per action rather than per screen. Queueless surfaces disable and
say why: service hours (s20) and check-in (s18) both take
`writeBlockedReason` and wire it to the control's `accessibilityHint`, not merely to
a sentence beside it. Dues is already gated by its own Stripe guard. The rule lives
in `apps/mobile/lib/connection/state.ts` (`writeBlockedReason`) so the split is one
decision rather than a per-screen judgement call.

Banner behavior:
- Appears at the top of the content area (below header bar). **Mobile deviates,
  deliberately:** the banner is mounted above the navigator in `app/_layout.tsx`, not
  below each screen's header. "Below the header bar" is a web-shaped rule written for
  a dashboard chrome; a global banner belongs above every screen, and moving it under
  each header would mean editing the frozen `apps/mobile/components/screen-shell.tsx`
  ([`mobile/navigation.md`](mobile/navigation.md) § Hotspot freeze). It does take the
  safe-area inset, which it previously did not — it rendered outside every
  `SafeAreaView` and painted under the status bar on a notched device.
- 200ms slide-down animation. **Mobile ships the 200ms as an opacity transition, not a
  translate** — the duration is the spec's, the motion is not. It runs on the JS driver
  (opacity here animates alongside a non-transform property), which is the right trade for
  something that fires once per connectivity change rather than once per frame of a
  gesture. Recorded as drift rather than smuggled: nothing about the placement forces a
  fade, so a later pass may make it a real slide.
- Auto-dismisses when state improves
- User can manually dismiss (it reappears if state hasn't changed after 30s). On mobile a
  dismissed bar fades to transparent but **stays laid out**, so its space is not reclaimed
  until the state changes or the 30s timer fires — also known drift
- Announced, not merely drawn: `accessibilityRole="alert"` +
  `accessibilityLiveRegion="polite"` on mobile, `role="alert"` + `aria-live="polite"`
  on web. A member using a screen reader needs to know a write is about to fail as
  much as a sighted one does.

### Implementation

**Mobile has one connection model for the UI.** `apps/mobile/lib/connection/`:
`state.ts` holds the pure rules (`deriveConnectionState`, `connectionBannerCopy`,
`writeBlockedReason`), `monitor.ts` is the process singleton that feeds them
(`expo-network` link state plus the `/health` poll), `use-connection.ts` is how a
component reads it through `useSyncExternalStore`, and `components/app-runtime.tsx`
starts it once above the auth gate. `components/network-banner.tsx` takes **no
props** — it used to be handed two raw `expo-network` booleans and derive its own
flags inline, which made it a third opinion about connectivity, and the readings
could and did disagree on screen.

**`@repo/chat-core` keeps its own, deliberately.** `chatNetworkState`
(`lib/chat/use-chat-runtime.ts`) still holds a separate `expo-network` subscription
behind the `NetworkState` port, and it is *more* conservative than this model: it
counts `isInternetReachable === false` as offline so a doubtful network queues
rather than sends. That asymmetry is correct — the outbox's failure mode is a lost
message, the banner's is a disabled control — but it has a consequence worth naming:
when the link is up and the **API** is dead, this model reaches OFFLINE after three
failed probes while the outbox still believes it is online, so a send is attempted
and lands as a failed bubble rather than being queued, and no link event fires to
flush it on recovery. Unifying the two (the monitor already satisfies the port's
shape) is tracked separately.

**Known divergence, web vs. mobile — do not "fix" the spec to match web.**
`apps/web/lib/providers/network-provider.tsx` maps three consecutive health failures
to `DEGRADED` and never reaches `OFFLINE` from probing at all; the detection rule
above says three failures is `OFFLINE`, with `DEGRADED` reserved for slow or
intermittent. Mobile follows the spec. The web provider is recorded here as drift to
be reconciled in its own pass.

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

Polling reuses that same gap-recovery fetch on a timer rather than a second
code path, so a message delivered by both a poll and the reconnect backfill
merges to one entry. Implementation: `packages/chat-core/src/realtime-manager.ts`
(`POLL_DEGRADE_AFTER_MS`, `POLL_INTERVAL_MS`, `ConnectionStatus === "polling"`).

**The in-thread pill is reconciled with §2's banner, not removed.** They answer
different questions — the pill reports the *realtime transport*, the banner reports
whether the API is reachable at all — but when both are saying "offline" they are one
fact told twice, stacked on one screen in two different sentences. So the mobile pill
**yields only its offline branch** while the global banner is already saying so, and
keeps the two states it alone can report: `"Real-time updates paused. Polling for new
messages."` (normative, above — polling is a working degraded mode, and calling it
"reconnecting" would report a live surface as broken) and `"Reconnecting…"`.

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

> **§3.2 is normative for the polling fallback.** The sketch below shows the
> connection lifecycle; where the two sections differ, §3.2 wins. In particular
> the degrade trigger is **any channel non-live for >10s** (not an exhausted
> reconnect-attempt budget), and the banner copy is §3.2's
> *"Real-time updates paused. Polling for new messages."*
>
> Implemented in `packages/chat-core/src/realtime-manager.ts` — `POLL_DEGRADE_AFTER_MS`
> / `POLL_INTERVAL_MS`, surfaced through the `"polling"` `ConnectionStatus`.
> Reconnect backoff keeps running underneath the poll loop, so recovery is
> automatic and polling stops on the next `SUBSCRIBED`.

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

> **Reopening a topic requires a completed teardown.** The sketch above is a
> mount/unmount pair; a *reopen* on the same topic is the sharp case.
> `supabase.channel(topic)` returns the **existing** instance while one is still
> registered under `realtime:<topic>`, and `removeChannel()` is async — worse,
> it only calls `teardown()` (the step that unregisters the channel) when
> `unsubscribe()` resolves `"ok"`. So re-creating a channel before its
> predecessor has finished leaving hands back the old, already-subscribed
> instance, and `.on('postgres_changes', …)` on it **throws**
> (`cannot add …callbacks for <topic> after subscribe()`); a `leaving`/`errored`
> leftover throws nothing but never delivers a row.
>
> The implementation therefore frees the topic — `unsubscribe()` **and** an
> unconditional `teardown()` — before every attach, tags attaches with an epoch
> so overlapping reopens cannot interleave, and contains attach failures in the
> reconnect backoff rather than letting them reach a React render pass. See
> `releaseTopic` in `packages/chat-core/src/topic-registry.ts` — the single
> implementation, imported directly by both attach paths (web's
> `apps/web/lib/realtime/supabase-realtime.ts` and `attachChannel` in
> `packages/chat-core/src/realtime-manager.ts`).
>
> **Maintenance (Item 4 / #1076, follow-up):** web chat and non-chat realtime
> import `@repo/chat-core` by subpath (`types`, `cache`, `chat-client`,
> `dispatch`, `realtime-manager`, `topic-registry`, `adapters`). The six #937
> S3 re-export shims are deleted. `packages/chat-core/src/topic-registry.ts` is
> imported directly (`@repo/chat-core/topic-registry`); the #937 web
> topic-registry re-export shim is gone. `apps/web/lib/chat/offline-queue.ts` type-
> imports `OutboxStore` from `@repo/chat-core/adapters`, not the package
> barrel. `apps/web/lib/chat/` retains only the web glue:
> `use-chat-channel.ts`, `chat-provider.tsx`, `offline-queue.ts`,
> `offline-queue.test.ts`, and `parsers.test.ts`.
>
> **The same rule binds every non-chat subscription.** `useRealtimeTable`
> derives its topic from `table` + `scopeId` alone, so an effect re-run driven by
> any *other* dependency — a new `queryClient`, React StrictMode's dev remount —
> reopens an unchanged topic and lands on exactly the
> case above. (A changed *invalidate key* deliberately no longer re-runs it: the
> keys are read through a ref, and because the broadcast carrier has no replay,
> a needless detach/re-attach would silently drop any ping landing inside the
> cycle.) `attachRealtimeChannel`
> (`apps/web/lib/realtime/supabase-realtime.ts`) therefore attaches through the
> same release. Because a `useEffect` cleanup is synchronous and freeing a topic
> is not, it serializes every attach and release for a topic through a per-topic
> queue: without that ordering, a cleanup's teardown can land *after* its
> successor has registered and tear down the live channel.
>
> The topic string itself must stay `chat:channel:<id>`: the push worker reads
> presence on the same topic (§ ADR-10, `spec/architecture/README.md`), so
> re-keying it to dodge a collision would silently disable push suppression.

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
| Study sessions | 30s | 5min | The **live** session is not served from this cache at all — s10 holds it in screen state and refreshes it from each mutation's own response, because a session can end by returning 200 and a 30s window would keep a dead timer ticking. The cached list backs the history and the recovery-on-mount read |
| Study zones | 60s | _(default)_ | A chapter's zones change about as often as its roles. `useGeofences` sets only `staleTime`, so `gcTime` is TanStack's 5-minute default — recorded as-is rather than as an intent nothing implements |

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

**Those last two rows are delivered on mobile, not merely specified.** They depend on
TanStack's `onlineManager` and `focusManager`, which nothing wired until
`apps/mobile/lib/connection/query-connectivity.ts` bound both to the connection
monitor — so `refetchOnReconnect` (a TanStack default) now actually fires. Two mobile
specifics: `DEGRADED` is published as **online**, because requests there are slow or
intermittent rather than impossible and telling TanStack otherwise would pause every
retry exactly when a retry is what recovers; and there is no window, so `focusManager`
is driven by `AppState` — `"active"` only, since iOS `inactive` is Control Center and
the app switcher, not a background. The explicit retry controls on s04/s06 stay
regardless: they are still the only recovery from a *server* error, which no amount of
connectivity signalling fixes.

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
