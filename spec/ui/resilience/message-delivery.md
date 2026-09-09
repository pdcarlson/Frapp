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

`RECORDED` is reached on an explicit `card_posted: false`: the write **did**
commit and the chat card did not
(#1789). Retry is the
dangerous action here — there is no server-side dedupe on `/task` or `/event`,
and a re-typed `/points` mints a fresh key — so the row offers **no** Retry and
**no** Delete. The sticky toast is secondary and evictable (`TOAST_LIMIT = 1`);
the row is the trace that survives the next toast and a reload.

**Web ships Retry on `unconfirmed`; mobile presents both states read-only.**
Both statuses are set only by the heavy-command dispatcher, they are cache-only
and local to the client that dispatched, and `apps/mobile` deliberately has no
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

**The in-thread pill is reconciled with [the connection banner](connection-state.md#ui-indicators), not removed.** They answer
different questions — the pill reports the *realtime transport*, the banner reports
whether the API is reachable at all — but when both are saying "offline" they are one
fact told twice, stacked on one screen in two different sentences. So the mobile pill
**yields only its offline branch** while the global banner is already saying so, and
keeps the two states it alone can report: `"Real-time updates paused. Polling for new
messages."` (normative, above — polling is a working degraded mode, and calling it
"reconnecting" would report a live surface as broken) and `"Reconnecting…"`.

## Message Ordering

Messages are ordered by `created_at` (server timestamp). Optimistic messages use the client's local time but are re-sorted when the server response arrives with the canonical timestamp. This prevents ordering issues when clocks are slightly off.

## Typing Indicators

Typing indicators use Supabase Realtime Broadcast (ephemeral, not persisted). They are best-effort and non-critical.

- If the Broadcast channel is disconnected, typing indicators simply don't show — no fallback needed
- Typing events expire after 5 seconds of no keystrokes (client-side timer)
- Never show "User is typing..." for the current user's own messages

---
