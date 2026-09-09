# API request retry strategy

> Part of [Network resilience](README.md).

## Retry Configuration

```typescript
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,         // 1 second
  maxDelay: 30_000,        // 30 seconds
  backoffMultiplier: 2,    // exponential: 1s, 2s, 4s
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  nonRetryableStatusCodes: [400, 401, 403, 404, 409, 422],
};
```

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
| Write (POST/PATCH) | 20s | 2x | Optimistic UI + rollback |
| File upload (signed URL) | 60s | 1x | Large payloads |
| Webhook (POST /webhooks) | 30s | 0x | Server-initiated, not user-facing |
| Search (GET /search) | 10s | 1x | Debounced input, non-critical |
| Chat send (POST messages) | 10s | 3x | High priority, see [Sending messages](message-delivery.md#sending-messages) |

---
