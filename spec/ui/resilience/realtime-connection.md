# Supabase Realtime connection management

> Part of [Network resilience](README.md).

> **[Receiving messages (Realtime)](message-delivery.md#receiving-messages-realtime) is normative for the polling fallback.** The sketch below shows the
> connection lifecycle; where the two sections differ, that leaf wins. In particular
> the degrade trigger is **any channel non-live for >10s** (not an exhausted
> reconnect-attempt budget; a channel whose join is refused for good doesn't count, per
> [§ A refused join is not a drop](#a-refused-join-is-not-a-drop)), and the banner copy is that leaf's
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

## A refused join is not a drop

A private channel's join is authorised by RLS on `realtime.messages`. When a member may not read the topic (the channel was deleted, or their access went), Realtime answers the join with `Unauthorized: You do not have permissions to read from this Channel topic: <topic>`, which realtime-js reports as `CHANNEL_ERROR`. Asking again gets the same answer, and phoenix asks anyway: it rejoins an errored channel on its own timer (1, 2, 5, then every 10 s) for as long as the channel stays registered. On staging on 2026-11-20 one phone asked about 385 times in 80 minutes for a channel deleted while it was open, each attempt one more RLS check (#5765).

So a refused join (`isJoinDenied`, `packages/chat-core/src/join-denied.ts`) is handled apart from every other failure, once it holds:

- **It has to hold for `REFUSAL_CONFIRM_MS` (5 s).** A join can be refused for a moment: one sent before the client has the member's token (a cold start refreshing a stored session) is checked as nobody, and the next attempt goes through. So the first refusal is a failed join like any other, backoff and all, and only a refusal still coming back 5 s later counts. A deleted channel stops after about 8 s.
- **The channel is released** through `releaseTopic`, which stops phoenix's timer with it, and nothing schedules a retry. It is not polled, and it doesn't count toward Reconnecting or the polling fallback.
- **It is asked for again, once, only when something could change the answer:** the session's access token becomes a different one (a refresh, or another member signing in; `onAccessTokenChange`, a second later so Realtime has it), the channel list shows the channel again after leaving it out (read access is decided by the database when the join is checked, so a role given back changes the answer without a new token), a different viewer is configured, or the thread opens it afresh. A chat thread stays `unavailable` while it asks, and a refusal then counts at once. Coming back to the app, the network returning, and a web tab becoming visible (which auth-js announces as `SIGNED_IN` with the same token) are not reasons.
- **Chat threads say so.** The manager reports `unavailable`, the clients read the channel list again (`invalidateChannelSet`), and the open thread shows `This channel is no longer available` on both clients ([`writing.md` § Chat (dashboard)](../design-system/writing.md#chat-dashboard)). On web the note holds until something else is opened: another channel, the other list, another chapter, or Browse channels.
- **The other private topics** (`notif:`, `events:`, `attendance:`, `presence:chapter:`) go through `attachTopicChannel`, which applies the same 5 s rule, then logs the refusal once, reports it through `onDisconnected`, releases the channel and asks again on the next new token.

A timeout, a dropped socket, a `postgres_changes` stream that couldn't start, and any other `CHANNEL_ERROR` keep the backoff above.

## Channel Subscriptions

For each open chat channel, subscribe to Postgres changes. This sketch and the one under Cleanup below show the pattern only and are not code to copy: the implementation is `RealtimeManager` (`packages/chat-core/src/realtime-manager.ts`), which owns the `chat:channel:<id>` topic as a private channel and writes a normalized `ChannelCache` under `chatMessagesKey(channelId)`, not an array.

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
> import `@repo/chat-core` by subpath
> ([its package row](../../architecture/README.md#4-shared-packages)). The six #937
> S3 re-export shims are deleted. `packages/chat-core/src/topic-registry.ts` is
> imported directly (`@repo/chat-core/topic-registry`); the #937 web
> topic-registry re-export shim is gone. `apps/web/lib/chat/offline-queue.ts` type-
> imports `OutboxStore` from `@repo/chat-core/adapters`.
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
