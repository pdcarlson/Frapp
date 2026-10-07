### ADR-04: Why presence-aware push notifications

**Decision:** Push notifications are suppressed for users who are currently online in the affected channel.

**Rationale:** Sending a push to a user who is already reading the channel is noise. It trains users to mute notifications. "Presence-aware" means: if the user's Realtime subscription to the channel is active, skip the push. If they're offline or in a different channel, send it.

**Consequences:** Requires tracking per-channel presence, not just global online status. Supabase Broadcast presence tracks this. *(Corrected 2026-10-07: presence moved to Realtime's Presence API on the chat channel topic, [ADR-10](adr-10.md); the decision is unchanged.)* Edge Function (or NestJS notification trigger) must query presence before enqueuing push. False negatives (push skipped for briefly-offline user) are acceptable; false positives (push sent to active reader) are worse.
