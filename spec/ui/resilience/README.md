# Network resilience & message delivery

> Users on slow, flaky, or intermittent connections must have a reliable experience. Messages must never be silently lost. Actions must never appear to succeed when they haven't.

---

This folder is the canonical UI spec for connection state, delivery, retry, forms, Realtime, uploads, caching, and performance budgets. **Routers link; leaves assert.** Cite a leaf and a heading anchor, never `§N`.

| Leaf | What it asserts |
| --- | --- |
| [Guiding principles](principles.md) | Show state honestly; never lose a message. |
| [Connection state machine](connection-state.md) | ONLINE / DEGRADED / OFFLINE, banners, and write gating. |
| [Chat message delivery guarantees](message-delivery.md) | Send, receive (Realtime + polling), ordering, typing. |
| [API request retry strategy](api-retry.md) | Timeouts, retry counts, per-endpoint policy. |
| [Form submission resilience](form-submission.md) | Double-submit, unsaved work, concurrent edits. |
| [Supabase Realtime connection management](realtime-connection.md) | Lifecycle, channel subscriptions, cleanup. Polling copy is owned by message delivery. |
| [Image and file upload resilience](uploads.md) | Signed-URL flow, progress, failure recovery. |
| [Caching strategy](caching.md) | Layers, per-domain staleTime, invalidation triggers. |
| [Performance budgets (web dashboard)](performance-budgets.md) | Budgets and optimization techniques for the admin web app. |
