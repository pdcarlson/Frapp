---
name: realtime-resilience
description: >
  Invariants for chat realtime, connection state, topic teardown, and message delivery. Breaking
  one brings back a disconnect/reopen bug that was already fixed. Use when touching
  packages/chat-core, realtime subscriptions, offline/outbox behavior, network banners,
  useRealtimeTable, or spec/ui/resilience/.
---

# Realtime resilience

The spec is [`spec/ui/resilience/`](../../../spec/ui/resilience/README.md). These rules are the parts
of it that, skipped, reintroduce a fixed bug. Read the spec leaf a rule names before changing its
code. Code comments cite the rules by number, so keep the numbering.

One implementation per concern; don't fork another:

| Concern | Home |
| --- | --- |
| Topic attach/release | `packages/chat-core/src/topic-registry.ts` (`releaseTopic`); import it as `@repo/chat-core/topic-registry` from web or mobile |
| Realtime + polling fallback | `packages/chat-core/src/realtime-manager.ts` |
| Web subscriptions (`useRealtimeTable`) | `apps/web/lib/realtime/supabase-realtime.ts`, which queues attach/release per topic |
| Mobile connection banner / write gating | `apps/mobile/lib/connection/` |
| Chat outbox network port | Mobile: `createMonitorNetworkState(connectionMonitor)`. Web: chat-core `NetworkState`. |

## 1. Reopening a topic requires a completed teardown

`supabase.channel(topic)` returns the existing instance while one is still registered, and
`removeChannel()` only `teardown()`s after `unsubscribe()` resolves `"ok"`. So re-creating a channel
before its predecessor has left hands back the old, already-subscribed instance, and
`.on('postgres_changes', …)` on it throws (`cannot add …callbacks for <topic> after subscribe()`).
A `leaving` or `errored` leftover throws nothing and never delivers a row.

Free the topic before every attach: `unsubscribe()` and an unconditional `teardown()`. Tag attaches
with a sequence number (`attachSeq`) so overlapping reopens can't interleave. Keep attach failures in
reconnect backoff, out of any React render pass.

This binds every subscription, not just chat. `useRealtimeTable` derives its topic from `table` +
`scopeId` alone, so an effect re-run (new `queryClient`, StrictMode remount) reopens an unchanged
topic. A `useEffect` cleanup is synchronous and freeing a topic is not, so serialize attach and
release per topic through a queue; otherwise a cleanup's teardown lands after its successor
registered and kills the live channel. Use the one `releaseTopic`; don't write a second.

## 2. Do not re-key the chat topic to dodge a collision

The topic stays `chat:channel:<id>`, because the push worker reads presence on that same topic
(ADR-10). Re-keying it silently disables push suppression.

## 3. One mobile monitor; do not re-split the outbox

Both consumers read one monitor (one `expo-network` subscription, one `/health` poll), each for the
failure it guards against:

| Consumer | Guards against | Offline signal |
| --- | --- | --- |
| Banner / write gating (`apps/mobile/lib/connection/`) | A disabled control the member can disprove | Link down, or `/health` failing three times. `isInternetReachable === false` is one probe failure, not OFFLINE. |
| Chat outbox (`NetworkState` in chat-core) | A lost message | `isOffline()` is OFFLINE only; `DEGRADED` still sends. Inject `createMonitorNetworkState(connectionMonitor)`; don't add a second `expo-network` subscription. |

Folding `isInternetReachable === false` into banner OFFLINE re-breaks check-in. Putting the outbox
back on a link-only `expo-network` read re-breaks sending while the API is down.

## 4. `navigator.onLine` is web-only

React Native defines `navigator` but never sets `onLine`, so `!navigator.onLine` is always false.
Mobile takes the link half from `expo-network` (`isConnected === false`).

## 5. Polling fallback is Receiving messages, not the reconnect-budget sketch

Degrade when a channel has been non-live for more than 10s, not when a reconnect-attempt budget runs
out. Copy: *"Real-time updates paused. Polling for new messages."* On reconnect, fetch after the last
known timestamp, merge, and dedupe by ID; polling reuses that fetch. Constants:
`POLL_DEGRADE_AFTER_MS` / `POLL_INTERVAL_MS` in `realtime-manager.ts`.

The in-thread pill reports transport; the global banner reports API reachability. The pill drops
only its offline branch when the banner already says offline.

## 6. Never lose a message; never fake success

Optimistic send is required, and a failed send stays in the list with Retry/Delete. Create and
update may be optimistic; delete and pay are pessimistic. A composer that queues stays enabled
offline and says so; a write with no queue disables and says why.

## 7. One `deriveConnectionState` — do not fork a third

`@repo/validation` owns `deriveConnectionState` and `healthProbeIsReachable`
(`spec/ui/resilience/connection-state.md`). Web's `NetworkProvider` and mobile's `lib/connection`
feed that function rather than keeping copies, so the surfaces can't drift. Three consecutive
`/health` failures are OFFLINE on both. A 429 is reachability, not a failure. Presence gates on the
link, not on `isOffline`, because Realtime is a different service from `/health`.

If a rule here is wrong, change the shared function and the spec together, never the spec alone to
match a local fork.

## Before you change realtime or connection code

1. Read the spec leaf the change touches: `connection-state.md`, `message-delivery.md`, or
   `realtime-connection.md`.
2. Grep every attach and subscribe on that topic across chat-core, web realtime, and mobile
   connection code.
3. Test the failure mode, not only the happy-path subscribe: reopening the same topic, an
   overlapping attach, a StrictMode remount.
