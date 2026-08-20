---
name: realtime-resilience
description: >
  Rules for chat realtime, connection state, topic teardown, and message delivery — the invariants
  that prevent the same disconnect/reopen bug from being "fixed" twice. Use when touching
  packages/chat-core, realtime subscriptions, offline/outbox behavior, network banners,
  useRealtimeTable, or spec/ui/resilience.md.
---

# Realtime resilience

> Substance lives in [`spec/ui/resilience.md`](../../../spec/ui/resilience.md). This skill is the
> short list of rules that, if skipped, reproduce a bug already paid for. Read the spec section
> named in each rule before changing the code.

Implementation homes (do not fork a third):

| Concern | Home |
| --- | --- |
| Topic attach/release | `packages/chat-core/src/topic-registry.ts` (`releaseTopic`) |
| Realtime + polling fallback | `packages/chat-core/src/realtime-manager.ts` |
| Mobile connection banner / write gating | `apps/mobile/lib/connection/` |
| Chat outbox network port | `@repo/chat-core` `NetworkState` (more conservative than the banner) |
| Web dashboard ping subscriptions | `apps/web/lib/realtime/` — must use the same release |

## 1. Reopening a topic requires a completed teardown

`supabase.channel(topic)` returns the **existing** instance while one is still registered.
`removeChannel()` is async and only `teardown()`s when `unsubscribe()` resolves `"ok"`. Re-creating
a channel before its predecessor has finished leaving hands back the old, already-subscribed
instance, and `.on('postgres_changes', …)` on it **throws** (`cannot add …callbacks for <topic>
after subscribe()`). A `leaving`/`errored` leftover throws nothing but never delivers a row.

**Do:** free the topic — `unsubscribe()` **and** an unconditional `teardown()` — before every
attach. Tag attaches with an epoch so overlapping reopens cannot interleave. Contain attach
failures in reconnect backoff; never let them reach a React render pass.

This binds **every** subscription, not just chat. `useRealtimeTable` derives its topic from
`table` + `scopeId` alone, so an effect re-run (new `queryClient`, StrictMode remount) reopens an
unchanged topic and hits the same case. A `useEffect` cleanup is synchronous and freeing a topic
is not — serialize attach and release per topic through a queue, or a cleanup's teardown lands
*after* its successor has registered and kills the live channel.

**Do not** invent a second `releaseTopic`. Import `packages/chat-core/src/topic-registry.ts`
(`@repo/chat-core/topic-registry`) from web and mobile. There is one implementation.

## 2. Do not re-key the chat topic to dodge a collision

The topic string stays `chat:channel:<id>`. The push worker reads presence on the same topic
(ADR-10). Re-keying it silently disables push suppression.

## 3. Two connection models, on purpose — do not "unify" them casually

| Model | Failure mode it optimizes | Offline signal |
| --- | --- | --- |
| **Banner / write gating** (`apps/mobile/lib/connection/`) | Disabled control the member can disprove | Link down, or `/health` failing three times. `isInternetReachable === false` is **one probe failure**, not OFFLINE. |
| **Chat outbox** (`NetworkState` in chat-core) | Lost message | More conservative: `isInternetReachable === false` counts as offline so a doubtful network queues rather than sends. |

Asymmetry is correct. Unifying them without naming that tradeoff re-breaks one of the two.

## 4. `navigator.onLine` is web-only

React Native defines `navigator` but never sets `onLine`, so `!navigator.onLine` is permanently
false. Mobile uses `expo-network` for the **link** half (`isConnected === false`). Do not port the
web clause literally.

## 5. Polling fallback is §3.2, not the reconnect-budget sketch

Degrade when a channel is non-live for **>10s** (not an exhausted reconnect-attempt budget).
Copy: *"Real-time updates paused. Polling for new messages."* On reconnect: fetch after the last
known timestamp, merge, deduplicate by ID. Polling reuses that same fetch. See
`POLL_DEGRADE_AFTER_MS` / `POLL_INTERVAL_MS` in `realtime-manager.ts`.

The in-thread pill reports **transport**; the global banner reports **API reachability**. The pill
yields only its offline branch when the banner is already saying so.

## 6. Never lose a message; never fake success

Optimistic send is required. Failed sends stay in the list with Retry/Delete. Creating/updating
may be optimistic; deleting/paying is pessimistic. Queued composers stay enabled offline and say
so; queueless writes disable and say why.

## 7. Do not "fix" the spec to match web drift

`apps/web/lib/providers/network-provider.tsx` maps three consecutive health failures to `DEGRADED`
and never reaches `OFFLINE` from probing. The spec says three failures is `OFFLINE`. Mobile
follows the spec. Record web as drift; do not rewrite `resilience.md` to match it from a chat or
mobile change.

## Before you change realtime or connection code

1. Read the spec section this change touches (`resilience.md` §2, §3.2, or §6).
2. Grep for every attach/subscribe on that topic — chat-core, web realtime, mobile connection.
3. Confirm teardown is complete before re-attach (rule 1).
4. Confirm you have not mixed banner rules into the outbox, or the reverse (rule 3).
5. Add a test that would have failed on the last incident: reopen-the-same-topic, overlapping
   attach, or StrictMode remount — not only the happy-path subscribe.
