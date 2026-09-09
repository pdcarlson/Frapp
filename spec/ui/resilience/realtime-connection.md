# Supabase Realtime connection management

> Part of [Network resilience](README.md).

> **[Receiving messages (Realtime)](message-delivery.md#receiving-messages-realtime) is normative for the polling fallback.** The sketch below shows the
> connection lifecycle; where the two sections differ, that leaf wins. In particular
> the degrade trigger is **any channel non-live for >10s** (not an exhausted
> reconnect-attempt budget), and the banner copy is that leaf's
> *"Real-time updates paused. Polling for new messages."*
>
> Implemented in `packages/chat-core/src/realtime-manager.ts` — `POLL_DEGRADE_AFTER_MS`
> / `POLL_INTERVAL_MS`, surfaced through the `"polling"` `ConnectionStatus`.
> Reconnect backoff keeps running underneath the poll loop, so recovery is
> automatic and polling stops on the next `SUBSCRIBED`.

## Connection Lifecycle

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

## Channel Subscriptions

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

## Cleanup

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
> `offline-queue.spec.ts`, and `parsers.spec.ts`.
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
> presence on the same topic (§ ADR-10, [`spec/architecture/adr/adr-10.md`](../../architecture/adr/adr-10.md)), so
> re-keying it to dodge a collision would silently disable push suppression.

---
