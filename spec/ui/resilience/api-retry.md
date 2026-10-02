# API request retry strategy

> Part of [Network resilience](README.md).

## Retry Configuration

```typescript
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,         // 1 second
  maxDelay: 30_000,        // 30 seconds
  backoffMultiplier: 2,    // exponential: 1s, 2s, 4s
  retryableStatusCodes: [408, 429, 500, 502, 503, 504], // reads; a write never retries a 429 (§ Writes)
  nonRetryableStatusCodes: [400, 401, 403, 404, 409, 422],
};
```

## Writes

A write is retried only when it failed in a way that may have reached the server or may pass next time: a 5xx, a failure with no status (a dropped connection, a timeout), or the 4xx an intermediary sends after the origin may have processed the request (408, and 499 and 460). A definitive client refusal, the throttler's 429 included, is never retried: the same request gets the same answer, and every repeat is another write the throttler counts. `isRetryableFailure` in `@repo/api-sdk` (`packages/api-sdk/src/api-error.ts`) is that one predicate. Web's default mutation retry is two more attempts through it (`retryMutation`, `apps/web/lib/providers/query-provider.tsx`, #3100); mobile's default mutation retry is none (`apps/mobile/lib/query-client.ts`).

Non-idempotent writes keep that default. Two kinds need more:

- A write that carries an idempotency key (a chat send's `client_message_id`, a points adjustment's key) is safe to retry, because the server dedupes the replay.
- A compare-and-set write without one (a task status change, resolving a report) sets `retry: false`, because if its first attempt lands and only the response is lost, the retry is refused and the client reports a failure for a write that happened ([`docs/hooks/README.md`](../../../docs/hooks/README.md)).

## Retry Logic

```typescript
async function fetchWithRetry(fn, config = RETRY_CONFIG) {
  let lastError;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;

      if (config.nonRetryableStatusCodes.includes(status)) {
        throw error; // Don't retry client errors
      }

      if (attempt < config.maxRetries) {
        const delay = Math.min(
          config.baseDelay * config.backoffMultiplier ** attempt,
          config.maxDelay,
        );
        // Add jitter: ±25%
        const jitter = delay * (0.75 + Math.random() * 0.5);
        await new Promise((r) => setTimeout(r, jitter));
      }
    }
  }
  throw lastError;
}
```

## Per-Endpoint Timeout Configuration

| Endpoint Category | Timeout | Retry | Notes |
|-------------------|---------|-------|-------|
| Read (GET) | 15s | 3x | Stale cache shown while retrying |
| Write (POST/PATCH) | 20s | 2x, transient failures only (§ Writes) | Optimistic UI + rollback |
| File upload (signed URL) | 60s | 1x | Large payloads |
| Webhook (POST /webhooks) | 30s | 0x | Server-initiated, not user-facing |
| Search (GET /search) | 10s | 1x | Debounced input, non-critical |
| Chat send (POST messages) | 10s | 3x | High priority, see [Sending messages](message-delivery.md#sending-messages) |

---
