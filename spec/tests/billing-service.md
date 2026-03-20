# Billing Service Tests

This document describes the test suite for the `BillingService` within the API application.

## `createPortalSession`

- **should throw NotFoundException for non-existent chapter**: Ensures that trying to create a portal session for a chapter ID that does not exist in the repository correctly throws a `NotFoundException`.
- **should throw ServiceUnavailableException on Stripe failure**: Ensures that if `createCustomerPortalSession` rejects with an error (e.g., Stripe is down), the service logs the error using `logger.error` and properly transforms it into a `ServiceUnavailableException`.
- **should create a portal session for a chapter with billing**: Verifies the happy path where a valid chapter ID resolves to a valid return URL.
- **should reject portal creation when chapter has no Stripe customer**: Checks that chapters without a billing account throw a `BadRequestException`.
