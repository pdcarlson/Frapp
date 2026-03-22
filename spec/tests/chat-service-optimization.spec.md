# Chat Service Notification Optimization

## Context
In `ChatService.sendMessageNotification`, when a message is sent to a DM or Group DM channel, notifications are sent to all recipients.

## Optimization: Concurrent Notifications
The original implementation used a sequential `for...of` loop with `await`, causing each notification to wait for the previous one to complete.

### Inefficiency
- **N+1 Await Cycles:** For a channel with $N$ recipients, the total notification time was $\sum_{i=1}^{N} T_{notify}(i)$.
- **Blocking Failures:** Although the loop was inside a `try...catch` block in `sendMessage`, a failure in one `notifyUser` call (if not internally handled) could potentially stop subsequent notifications if the loop itself wasn't resilient.

### Solution
Refactored the loop to use `Promise.allSettled`.

```typescript
await Promise.allSettled(
  recipientIds.map((recipientId) =>
    this.notificationService.notifyUser(recipientId, channel.chapter_id, {
      // ... payload
    }),
  ),
);
```

### Benefits
- **Concurrency:** All notification requests are initiated simultaneously. The total time is now approximately $\max(T_{notify}(i))$, significantly improving responsiveness.
- **Resilience:** `Promise.allSettled` ensures that even if some notification deliveries fail, all others are still attempted and completed. This aligns with the repository's resilient coding patterns.

## Performance Verification
Quantitative benchmarking was attempted but could not be completed due to environment constraints (missing `node_modules` content and `npm install` timeouts preventing the execution of custom benchmark scripts or full test suites). However, the architectural improvement from $O(N)$ sequential I/O to $O(1)$ concurrent I/O (with respect to wait time) is a well-established optimization for this pattern.
