### ADR-05: Dexie-backed offline queue + reconnect-with-backfill (Chunk 04)

**Decision:** The web client persists chat composer state in IndexedDB via [Dexie](https://dexie.org/) and routes every reconnect through a REST `?since=<id>` backfill before resubscribing.

**Schema (`frapp-chat` IndexedDB):**

```text
drafts([userId+channelId] PK, body, updatedAt)
outbox([userId+chapterId+clientId] PK, channelId, body, kind?, payload?, replyToId?, attempts, queuedAt, status: "queued"|"failed", lastError?)
```

Both primary keys lead with the **Supabase auth uid** of the member who wrote the row ([#2226](https://github.com/pdcarlson/Frapp/issues/2226)). Before that they were `channelId` and `clientId` alone, and on a shared browser the boot flush sent one member's queued messages under the next member's token. Keying, not clearing, is the boundary — the rows deliberately survive a sign-out, because they are unsent messages. Why the outbox carries `chapterId` and drafts do not, and what the migration drops, are in [`spec/ui/resilience/caching.md`](../../ui/resilience/caching.md#cache-layers).

- **Drafts** are written debounced from the composer (Tiptap text via `editor.getText()`, _not_ the editor JSON — keeps the schema stable across editor upgrades). Restored on tab reload so a mid-compose user never loses input.
- **Outbox** rows are enqueued _before_ the chat-send POST; the row's `clientId` doubles as `chat_messages.client_message_id`, which the NestJS chat controller dedupes on (ADR-03, ADR-11). On success the row is dequeued; on a `4xx` it moves to `failed` with an inline Retry/Discard affordance; on network/5xx it stays `queued`. The flush loop iterates `queued` rows oldest-first and **sequentially** so message order is preserved end-to-end.

**Channel-attach ordering (subscribe-then-backfill):** every channel attach — both the **initial join** for a freshly-subscribed channel and every **reconnect** after `CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED` — runs through the same `SUBSCRIBED` callback in the realtime manager. The callback (a) re-attaches the Postgres Changes subscription first, then (b) calls `GET /v1/channels/{id}/messages?since=<lastSeenMessageId>` via the api-sdk. Gating both paths on the single `SUBSCRIBED` callback guarantees the Realtime listener is genuinely attached before the REST backfill HTTP fires, so any row that lands during the overlap is still caught by the live subscription. The last-seen id is persisted per channel in `localStorage` (`chat:lastSeen:{channelId}`) and advanced only from confirmed tail rows. Subscribe-then-backfill tolerates a harmless overlap (deduped by `mergeServerRow` keyed on both `client_message_id` and server `id`) instead of risking a gap. Backoff between failed resubscribes is 1→2→4→8→16→30s capped.

**Rationale:** Mobile/laptop networks drop; without persistence, a 30-second offline window costs the user their draft and any messages they typed but didn't send. With Dexie + the idempotency index from ADR-03, the user can compose offline, reload the tab, come back online minutes later, and see their messages flush in order with zero duplicates.

**Consequences:** Dexie is web-only; the Expo mobile client uses AsyncStorage/SQLite for the analogue (Chunk 11). The reaction subscription is one **global** `chat_message_actions` channel (the table has no `channel_id` column to filter on); reactions on not-yet-loaded messages are intentionally dropped and recovered on next backfill. Reaction _removals_ go to the row directly under RLS (`chat_message_actions_delete` scopes to own rows) rather than adding a remove path to the NestJS actions endpoint — keeps the server-side surface read+insert+upsert only.
