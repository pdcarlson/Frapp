# Guiding principles

> Part of [Network resilience](README.md).

1. **Show, don't guess.** Always show the user the true state of their action (pending, succeeded, failed).
2. **Cache aggressively, refetch quietly.** Stale data is better than no data. Refresh in the background.
3. **Retry automatically, inform manually.** Transient failures retry silently. Persistent failures require user action.
4. **Optimistic where safe, pessimistic where destructive.** Creating/updating is optimistic. Deleting/paying is pessimistic.
5. **Never lose a message.** Chat messages are the highest-priority data for reliability.

---
