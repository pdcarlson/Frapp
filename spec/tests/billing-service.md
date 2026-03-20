# Billing Service Tests

This document describes the test suite for the `BillingService` within the API application.

## `createPortalSession`

- **should throw NotFoundException for non-existent chapter**: Ensures that trying to create a portal session for a chapter ID that does not exist in the repository correctly throws a `NotFoundException`.
- **should throw ServiceUnavailableException on Stripe failure**: Ensures that if `createCustomerPortalSession` rejects with an error (e.g., Stripe is down), the service logs the error using `logger.error` and properly transforms it into a `ServiceUnavailableException`.
- **should create a portal session for a chapter with billing**: Verifies the happy path where a valid chapter ID resolves to a valid return URL.
- **should reject portal creation when chapter has no Stripe customer**: Checks that chapters without a billing account throw a `BadRequestException`.

## `handleWebhookEvent`

- Tests cover all webhook event types (`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`).
- Tests ensure fallback paths, missing fields, and unknown states are handled correctly without throwing unhandled exceptions.
- **Coverage Details:**
  - Fallbacks for missing session properties.
  - Ignoring notification errors.
  - Handling of non-existent chapters or subscriptions during events.

## Exception Logging & Wrapping

- **Non-Error Objects**: Both `createCheckoutSession` and `createPortalSession` handle scenarios where the Stripe API or `billingProvider` rejects with non-`Error` objects (like strings), logging them appropriately via the ternary operator logic `error instanceof Error ? error.stack : error`.
- **should handle errors when notifying chapter president**: Ensures that if an internal error occurs while trying to notify the chapter president of a status change (such as `roleRepo.findByChapterAndName` throwing an error), the error is gracefully caught and a warning is logged using `logger.warn`, without throwing an exception and failing the webhook handling process.
