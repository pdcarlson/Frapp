# Chat message delivery guarantees

> Part of [Network resilience](README.md).

Chat messages are the most latency-sensitive and loss-sensitive data in the app. The system must handle:
- User sends message on slow 3G connection
- User sends message and immediately loses connection
- User receives a message while in DEGRADED state
- Multiple messages sent rapidly before any response

## Sending Messages

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
| UNCONFIRMED | Neutral note + "outcome unknown" — **never red** | [Retry] only — **never Delete** |
| RECORDED | Neutral note — write committed, chat card missing — **never red** | None — **never Retry, never Delete** |

`UNCONFIRMED` and `RECORDED` are the two rows in this table where the action
column is a safety rule rather than a convenience.

`UNCONFIRMED` is reached when a heavy slash command's response was lost, so the
write may already have committed
([`chat/integrations.md`](../../behavior/chat/integrations.md) § Slash command
dispatch, #1733):

- **No Delete.** The row can be the only trace of a committed ledger write. The
  `FAILED` row above may offer it because `FAILED` asserts nothing was written.
- **Not red.** A destructive presentation is what makes an officer re-type the
  command, and a re-typed `/points` mints a fresh idempotency key, misses the
  dedupe index and double-grants into an append-only ledger.
- **Retry replays the original request**, under its original
  `client_message_id` — not a fresh send.
- **The row survives a rebuild.** The reconnect that follows the outage
  refetches the channel from REST (`refetchOnReconnect: "always"`), and the
  server never wrote this row, so it and its replay handle are persisted on
  the dispatching browser (#1909). What keeps and evicts them:
  [`chat/integrations.md` § Slash command dispatch](../../behavior/chat/integrations.md#slash-command-dispatch).

`RECORDED` is reached on an explicit `card_posted: false`: the write **did**
commit and the chat card did not
(#1789). Retry is the
dangerous action here — there is no server-side dedupe on `/task` or `/event`,
and a re-typed `/points` mints a fresh key — so the row offers **no** Retry and
**no** Delete. The sticky toast is secondary and evictable (`TOAST_LIMIT = 1`);
the row is the trace that survives the next toast and a reload.

**Web ships Retry on `unconfirmed`; mobile presents both states read-only.**
Both statuses are set only by the heavy-command dispatcher, they are local to
the client that dispatched (persisted in its per-member notice store, never on
the server), and `apps/mobile` deliberately has no
slash dispatch — so no mobile row can currently *reach* `unconfirmed` or
`recorded`. The type still permits them. A fall-through to the delivered
presentation (no note; on `recorded` no "don't run again") is the worst
available look for a lost write, so mobile presents both as a muted note,
never as delivered, never with Discard, and never with Retry until it gains a
slash replay path (2026-09-09, #1910). The exhaustive `_status` switch is
what makes the next widening of `MessageStatus` a compile error rather than
another silent fall-through.

**The state machine above does not produce `UNCONFIRMED` or `RECORDED`.** It
models the outbox path (`SENDING → SENT`, timeout → `FAILED`), which heavy slash
commands deliberately bypass — they call an RPC directly rather than queueing.
`UNCONFIRMED` is reached only from a heavy command whose HTTP response was lost;
`RECORDED` only from an explicit `card_posted: false`. Wiring either off the
send-timeout edge would be wrong.

The table's names are the spec's own vocabulary and map loosely onto the
`MessageStatus` union in `@repo/chat-core` (`pending`, `confirmed`, `failed`,
`unconfirmed`, `recorded`): `FAILED`/`failed` and `UNCONFIRMED`/`unconfirmed`
correspond, `RECORDED`/`recorded` is the committed-card-lost terminal,
`SENDING` is roughly `pending`, and `SENT`/`DELIVERED` have no separate code
state — both are `confirmed`.

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

## Receiving Messages (Realtime)

**Primary channel:** Supabase Realtime (Postgres Changes subscription on `chat_messages` filtered by `channel_id`).

**It is also the only *in-app* push carrier.** Postgres Changes is not a durable backstop behind a faster
broadcast path — for messages there is no broadcast path at all. Realtime Broadcast in chat carries
`typing` only (ADR-02; `packages/chat-core/src/realtime-manager.ts`), and Presence carries the
online set on the same `chat:channel:<id>` topic (ADR-10). So an *open* client renders a new message
when the Postgres Changes row arrives, or when the polling fallback below picks it up. (A member who
is backgrounded or away learns of it a third way, outside this doc's scope: the push worker
subscribes to the same `chat_messages` INSERT server-side and fans out an Expo notification — ADR-09,
suppressed by the Presence read above.)
The API used to emit a `new_message` broadcast that looked like a second delivery path and was not
one; it was removed in #472 — see the ADR-11 amendment for why, and #1613 for whether a real
sub-second path is wanted.

**Every other channel: the inbox** (#3698). The per-channel subscription only exists while a
thread is open, so on its own it leaves everything that summarizes *all* channels (unread
badges and bold rows, the Messages order, the app badge) waiting for focus or staleness. The
realtime manager therefore also holds one global Postgres Changes subscription on
`chat_messages` INSERTs (`chat:inbox:global`), unfiltered and scoped by the `chat_messages` RLS
policy that Realtime runs per subscriber, so a member is told about exactly the messages a REST
read would return them, archive imports excluded. It carries no message into a timeline. It
reports each new message to the client (`onMessageActivity`), which, coalescing a burst into one
round, re-reads `GET /v1/channels/unread` and `/latest`. When the message landed in the thread
the member is looking at, the client first re-stamps that channel read
(`POST /v1/channels/{id}/read`) (`createChatActivityHandler` in `@repo/hooks`). "Looking at"
means the thread has claimed it on focus (`claimViewedChannel`) and the app or tab is in front of
them. Being subscribed is not enough, because a mobile thread stays mounted under a screen pushed
over it. A round's stamps wait for the previous round's, so a slow stamp can't be overtaken by a
later round's re-read, but no round waits on a re-read. A `resync` also re-stamps the channel being
looked at, which covers what arrived in it while the app was away. Each rejoin of the inbox after a drop reports a
`resync`, which re-reads both. Mobile binds the manager app-wide from `components/app-runtime.tsx`
so the inbox runs from launch. Web binds it in `ChatProvider`, so off `/chat` the nav's chat
badge still refreshes on focus and staleness only.

**Back in the foreground** (#3698). A socket can die while the app is in the background (mobile)
or the tab is hidden (web), and Realtime only notices when a heartbeat goes unanswered, on its own
schedule up to 50 s later. So the return calls `chatRealtime.resume()`: on mobile the AppState
edge from `background` to `active`, not from `inactive`; on web the tab becoming visible.
`resume()`:

- Reconnects a socket known to be down. It probes one that reads open, through Realtime's public
  heartbeat API, without sending a heartbeat of its own (one sent while another is pending would
  time out a live socket): every `RESUME_PROBE_MS` (4 s), up to three looks, it reads the
  outstanding heartbeat, usually Realtime's scheduled one that fired as the app woke. The same one
  pending at two looks in a row has gone unanswered for a whole window, and only then does it run
  Realtime's own heartbeat timeout, which errors every channel on the socket and reconnects and
  rejoins them. A socket that answers is never touched, so nothing sharing it (web's notification
  and event pings, presence) is disturbed.
- Runs the gap-recovery read below for every live open thread at once, and reopens any thread
  channel that isn't live, whose join runs the same read.
- Re-reads the summaries and re-stamps the thread the member is looking at, through a `resync`
  reported at once when the inbox is live, otherwise through the one its rejoin reports.

Offline it does nothing, and the online edge reopens everything instead. Finding a dead socket
takes one or two probe windows, then Realtime's own teardown (about 1.5 s) and first reconnect
step (1 s): up to about 11 s after the return, where the heartbeat schedule alone took up to 50 s. A message
sent in that window isn't lost: the threads' rejoin reads it and the inbox's rejoin reports a
`resync`.

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
1. Fetch the messages created after the last known message, by its id (`since=`; the API
   contract is [chat § Reconnect replay](../../behavior/chat/README.md#reconnect-replay))
2. Merge them into the local message list (deduplicate by ID), by the full-page rule below
3. Nothing is lost: what a page did not reach is read when the member scrolls back to it

Because that read is the newest page after the cursor rather than the next one (the contract
above), a page shorter than `limit` holds everything after the cursor and merges as it is. A **full
page may not reach back to the cursor**, and merged as is, the messages between them would render
as silence.
So the client also drops the cached rows older than a full page, the way a rebuild from the newest
page does, and scrolling back reads through the hole (`mergeSincePage` in
`packages/chat-core/src/cache.ts`, #2807). Rows the member had scrolled back through therefore
don't survive a reconnect that missed a full page; they load again when they scroll back.

With no cursor, as on the first join on a device, the client reads the newest page at the size the
channel's first read uses. A cursor the server no longer holds (its coded 404, in the contract
above) is dropped and the newest page read instead, and the confirmed rows the thread holds that
that page shows are gone (a purge whose deletes were missed) go with it. The cursor also lives in
memory for the session, so a browser that refuses site storage still reads after one rather than
trimming on every poll.

Polling reuses that same gap-recovery fetch on a timer rather than a second
code path, so a message delivered by both a poll and the reconnect backfill
merges to one entry. Implementation: `packages/chat-core/src/realtime-manager.ts`
(`POLL_DEGRADE_AFTER_MS`, `POLL_INTERVAL_MS`, `ConnectionStatus === "polling"`).

**The transport's state is said by the one connection indicator, not by a pill of
its own** ([`connection-state.md` § One indicator](connection-state.md#one-indicator),
2026-11-06). The open chat reports its transport (`useReportOpenChatTransport`), and
the app-wide pill folds it with the app's connection state: a slow or dead API is
said as "Slow connection" or "Offline", because a reconnecting or polling transport
is only its symptom, and only on a healthy connection does the transport speak, as
"Live updates paused" (with the normative sentence above as its accessible name and
detail; polling is a working degraded mode, and calling it "reconnecting" would
report a live surface as broken) or "Reconnecting…". Until then each chat drew its
own pill in the thread header beside the global banner (web, and a tinted band on
mobile), which put one fact on screen twice or three times.

## Message Ordering

Messages are ordered by `created_at` (server timestamp). Optimistic messages use the client's local time but are re-sorted when the server response arrives with the canonical timestamp. This prevents ordering issues when clocks are slightly off.

## Typing Indicators

Typing indicators use Supabase Realtime Broadcast (ephemeral, not persisted). They are best-effort and non-critical.

- If the Broadcast channel is disconnected, typing indicators simply don't show — no fallback needed
- What the indicator shows, who counts toward it and when a typist drops off: [`spec/behavior/chat/README.md` § Messages](../../behavior/chat/README.md#messages) ("Typing indicators")

---
