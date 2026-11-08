# API request retry strategy

> Part of [Network resilience](README.md).

## Retry Configuration

```typescript
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,         // 1 second
  maxDelay: 30_000,        // 30 seconds
  backoffMultiplier: 2,    // exponential: 1s, 2s, 4s
  retryableStatusCodes: [408, 500, 502, 503, 504], // reads and writes never retry a 429 (§ Reads, § Writes)
  nonRetryableStatusCodes: [400, 401, 403, 404, 409, 422, 429],
};
```

## Reads

A read is retried when it failed in a way that may pass next time: a 5xx, a failure with no status (a dropped connection, a timeout), or an intermediary's 408, 499 or 460. A definitive client refusal (a 400, 401, 403, 404, 409, 422 or 429) is never retried: the same request gets the same answer, and the backoff only holds the error state back, by about 7 s for three retries. That holds for the throttler's 429 too, though a read is safe to repeat: once a caller is over the limit the throttler blocks it for `blockDuration`, which defaults to the window's 60 s `ttl` (`apps/api/src/app.module.ts`), so every attempt inside the backoff is refused again and counted. The SDK keeps no `Retry-After` to wait on instead. A 401 is not retried because the web client reads the Supabase session on every request (`apps/web/lib/providers/frapp-client-provider.tsx`) and `getSession` refreshes a token within 90 s of its expiry before returning it, so a retry would carry the same token. Web's default query retry is three more attempts through `isRetryableFailure` (`retryQuery`, `apps/web/lib/providers/query-provider.tsx`, #3141); mobile's default query retry is one more attempt whatever the status (`apps/mobile/lib/query-client.ts`). The rule assumes the API's status is honest, as § Writes does; a guard that could not finish its lookup answers 503, so that failure is retried (#3143).

## Writes

A write is retried only when it failed in a way that may have reached the server or may pass next time: a 5xx, a failure with no status (a dropped connection, a timeout), or the 4xx an intermediary sends after the origin may have processed the request (408, and 499 and 460). A definitive client refusal, the throttler's 429 included, is never retried: the same request gets the same answer, and every repeat is another write the throttler counts. `isRetryableFailure` in `@repo/api-sdk` (`packages/api-sdk/src/api-error.ts`) is that one predicate. Web's default mutation retry is two more attempts through it (`retryMutation`, `apps/web/lib/providers/query-provider.tsx`, #3100); mobile's default mutation retry is none (`apps/mobile/lib/query-client.ts`), except for idempotent writes that fire on their own with no control to press again, which retry once through the same predicate (`setMutationDefaults` by `mutationKey` there; today only mark-read, #3747). Their retry waits for the connection monitor's foreground verdict when the app has just resumed ([`caching.md`](caching.md)). The rule assumes the API's status is honest. One answer isn't yet: the payment-intent mint's "already in progress" 409 clears on a retry (#3144). The guards' infrastructure failures are 503 since #3143 ([`multi-tenancy.md`](../../behavior/multi-tenancy.md)).

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
| Read (GET) | 15s | Web 3x, transient failures only; mobile 1x (§ Reads) | Stale cache shown while retrying |
| Write (POST/PATCH) | 20s | Web 2x, transient failures only; mobile 0x, 1x for its idempotent fire-and-forget writes (§ Writes) | Optimistic UI + rollback |
| File upload (signed URL) | 60s | 1x | Large payloads |
| Webhook (POST /webhooks) | 30s | 0x | Server-initiated, not user-facing |
| Search (GET /search) | 10s | 1x | Debounced input, non-critical |
| Chat send (POST messages) | 10s | 3x | High priority, see [Sending messages](message-delivery.md#sending-messages) |

---
