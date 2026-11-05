# API request retry strategy

> Part of [Network resilience](README.md).

## Retry Configuration

```typescript
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,         // 1 second
  maxDelay: 30_000,        // 30 seconds
  backoffMultiplier: 2,    // exponential: 1s, 2s, 4s
  retryableStatusCodes: [408, 429, 500, 502, 503, 504], // reads (§ Reads); writes never retry a 429 (§ Writes)
  nonRetryableStatusCodes: [400, 401, 403, 404, 409, 422],
};
```

## Reads

A read is retried when it failed in a way that may pass next time: a 5xx, a failure with no status (a dropped connection, a timeout), an intermediary's 408, 499 or 460, or the throttler's 429. A definitive client refusal other than the 429 (a 400, 401, 403, 404, 409 or 422) is never retried: the same request gets the same answer, and the backoff only holds the error state back, by about 7 s for three retries. The 429 is the one refusal a read repeats, unlike a write: a read is safe to send again, and the throttler's one-minute window passes. The SDK keeps no `Retry-After`, so a throttled read backs off on the ordinary 1 s, 2 s, 4 s schedule, not the throttler's. A 401 is not retried because the web client reads the Supabase session on every request (`apps/web/lib/providers/frapp-client-provider.tsx`) and `getSession` refreshes a token within 90 s of its expiry before returning it, so a retry would carry the same token. Web's default query retry is three more attempts through `isRetryableFailure` plus the 429 (`retryQuery`, `apps/web/lib/providers/query-provider.tsx`, #3141); mobile's default query retry is one more attempt whatever the status (`apps/mobile/lib/query-client.ts`). The rule assumes the API's status is honest, as § Writes does: until #3143, a guard's infrastructure failure answered as 401/403 fails a read at once instead of being retried.

## Writes

A write is retried only when it failed in a way that may have reached the server or may pass next time: a 5xx, a failure with no status (a dropped connection, a timeout), or the 4xx an intermediary sends after the origin may have processed the request (408, and 499 and 460). A definitive client refusal, the throttler's 429 included, is never retried: the same request gets the same answer, and every repeat is another write the throttler counts. `isRetryableFailure` in `@repo/api-sdk` (`packages/api-sdk/src/api-error.ts`) is that one predicate. Web's default mutation retry is two more attempts through it (`retryMutation`, `apps/web/lib/providers/query-provider.tsx`, #3100); mobile's default mutation retry is none (`apps/mobile/lib/query-client.ts`). The rule assumes the API's status is honest. Two answers aren't yet: the auth and chapter guards answer an infrastructure failure as 401/403 (#3143), and the payment-intent mint's "already in progress" 409 clears on a retry (#3144).

Non-idempotent writes keep that default, a create without an idempotency key included. Such a create can be written twice when its first attempt commits and only the response is lost (a proxy's 502 or 408); that duplicate is the accepted price of not failing every write a transient fault interrupts. Two kinds need more:

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
| Read (GET) | 15s | Web 3x, transient failures and 429 only; mobile 1x (§ Reads) | Stale cache shown while retrying |
| Write (POST/PATCH) | 20s | Web 2x, transient failures only; mobile 0x (§ Writes) | Optimistic UI + rollback |
| File upload (signed URL) | 60s | 1x | Large payloads |
| Webhook (POST /webhooks) | 30s | 0x | Server-initiated, not user-facing |
| Search (GET /search) | 10s | 1x | Debounced input, non-critical |
| Chat send (POST messages) | 10s | 3x | High priority, see [Sending messages](message-delivery.md#sending-messages) |

---
