# Billing Controller Tests

## Scenarios

### 1. Get Billing Status
- **Goal:** Retrieve the billing status for a specific chapter.
- **Test:** Verify that `getStatus` correctly calls `billingService.getChapterBillingStatus` and returns the data.
- **Verification:** Mock `getChapterBillingStatus` to return a sample status and assert the controller result matches.

### 2. Create Checkout Session
- **Goal:** Initiate a Stripe checkout session for a chapter.
- **Test:** Verify that `createCheckout` maps DTO fields correctly to service parameters and returns the URL.
- **Verification:** Mock `createCheckoutSession` to return a URL and assert the controller response contains it.

### 3. Create Portal Session
- **Goal:** Create a Stripe Customer Portal session.
- **Test:** Verify that `createPortal` calls the service with the correct `returnUrl` and returns the resulting URL.
- **Verification:** Mock `createPortalSession` and assert the controller response format.

### 4. Error Handling
- **Goal:** Ensure service errors are propagated.
- **Test:** Verify that if the billing service throws an error, the controller throws the same error.
- **Verification:** Use `rejects.toThrow()` in Jest.
