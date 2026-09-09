### ADR-02: Why Supabase Realtime Broadcast for presence/typing

**Decision:** Typing indicators and presence (online/offline) use Supabase Realtime Broadcast, not Postgres Changes.

**Rationale:** Broadcast is ephemeral (not persisted to DB), avoiding write amplification on every keystroke. A 200-member chapter where everyone is typing would generate ~200 rows/second to `presence` if DB-backed. Broadcast routes through the Realtime server without touching Postgres. On disconnect, the presence state naturally evaporates — no cleanup job needed.

**Consequences:** Presence/typing state is lost on server restart. This is acceptable; reconnecting clients re-emit their state within 1s. Persistent state (last-seen cursor, notification preferences) stays in DB.
