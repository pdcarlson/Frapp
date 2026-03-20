# Billing Service Test Specifications

## Webhook Handling
- **Idempotency**: The `BillingService`'s `handleWebhookEvent` method must skip processing if an event has already been seen. It checks `processedEventIds` and logs `Skipping already-processed event {event.id}`. The test verifies this debug log and asserts internal logic (like database updates) executes only once for duplicate webhook payloads.
