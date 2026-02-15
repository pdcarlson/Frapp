# Specification: Chapter Onboarding & Stripe Integration

## 1. Overview
This track implements the "Zero to One" flow for a new fraternity chapter. It involves:
1.  **Modularization:** Refactoring the backend to use Feature Modules (`src/modules/*`) to keep `AppModule` clean.
2.  **Billing:** Integrating Stripe Checkout to handle subscriptions.
3.  **Onboarding:** A dedicated flow to create a generic "Chapter," pay for it, and then "Activate" it.
4.  **Growth:** An invite system to add members to the active chapter.

## 2. Architecture & Patterns

### Feature Modules
To prevent `AppModule` bloat, we will introduce a `src/modules` directory.
- `AuthModule`: Exports `ClerkAuthGuard`, `UserSyncService`, `UserRepository`.
- `ChapterModule`: Exports `ChapterService`, `ChapterRepository`.
- `BillingModule`: Exports `StripeService`.

### Billing Adapter Pattern
We will define an `IBillingProvider` interface in the Domain layer. This ensures that if we switch from Stripe to LemonSqueezy (or another provider) later, our Application logic remains untouched.

```typescript
// domain/adapters/billing.interface.ts
export interface IBillingProvider {
  createCheckoutSession(customerId: string, priceId: string): Promise<string>;
  createCustomer(email: string, name: string): Promise<string>;
  verifyWebhookSignature(payload: Buffer, signature: string): Promise<StripeEvent>;
}
```

## 3. Data Model (Schema)

### `chapters` Table Expansion
| Column | Type | Notes |
| :--- | :--- | :--- |
| `stripe_customer_id` | `text` | Unique, Nullable (until payment init) |
| `subscription_status` | `enum` | `'active', 'past_due', 'canceled', 'incomplete'` |
| `subscription_id` | `text` | Stripe Sub ID |
| `university` | `text` | e.g., "Ohio State" |

### `invites` Table (New)
| Column | Type | Notes |
| :--- | :--- | :--- |
| `id` | `uuid` | PK |
| `token` | `text` | Unique, Index. The magic link code. |
| `chapter_id` | `uuid` | FK -> chapters.id |
| `role` | `text` | e.g., 'member', 'admin' |
| `expires_at` | `timestamp` | 24hr TTL |
| `created_by` | `uuid` | FK -> users.id (Audit trail) |
| `used_at` | `timestamp` | Nullable. If set, token is dead. |

## 4. Onboarding Logic & State Machine

### Chapter Life Cycle (Status)
1.  **`incomplete`**: Chapter record created, but Stripe payment not yet confirmed.
2.  **`active`**: Subscription is paid and current. Full access granted.
3.  **`past_due`**: Payment failed. 3-day grace period (Soft Lock).
4.  **`canceled`**: Subscription ended. Data preserved but read-only (Hard Lock).

### The "Initiate" Sequence (POST /v1/onboarding/init)
1.  **Atomic DB Create:** Create Chapter with `incomplete` status.
2.  **Billing Sync:** Create Stripe Customer.
3.  **Linkage:** Update Chapter with `stripe_customer_id`.
4.  **Session:** Generate Stripe Checkout URL with `chapter_id` in the `client_reference_id` or `metadata`. This is critical for matching the webhook back to our DB.
5.  **Response:** Return URL to frontend.

### Webhook Reliability (POST /v1/webhooks/stripe)
- **Problem:** Webhooks can arrive out of order or multiple times.
- **Solution:** 
  - Use `stripe_event_id` to prevent processing the same event twice (Idempotency).
  - Every update must be timestamp-aware (don't overwrite newer data with older data).

## 5. Implementation Consistency Patterns

### Error Handling
All errors in the `ChapterOnboardingService` must follow the established logging pattern:
- **Log Format:** `[Context] Message | Detail: { ... } | Error: Stack`
- **User Safety:** Catch all internal errors and throw `InternalServerErrorException` only after logging, ensuring no DB details leak.

### Decoupling (The Adapter)
The `ChapterOnboardingService` will **never** talk to the Stripe SDK directly. It will only talk to the `IBillingProvider` interface. This ensures that if we need to switch providers, we only implement a new adapter class.

## 6. Edge Case Analysis
| Scenario | Handling Strategy |
| :--- | :--- |
| User pays but browser crashes before redirect | Webhook (`checkout.session.completed`) is the source of truth. It will activate the chapter regardless of the frontend redirect. |
| Stripe is down during `/init` | Throw `503 Service Unavailable`. Do not create the Chapter in our DB if we can't create the Stripe customer. |
| Webhook arrives before DB commit | Implement a short retry logic or "Upsert" logic in the webhook handler. |
