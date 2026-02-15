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

## 4. API Contract

### A. Initiate Onboarding
**POST** `/v1/onboarding/init`
- **Body:** `{ "name": "Sigma Chi", "university": "OSU" }`
- **Logic:**
  1.  Creates `Chapter` in DB (Status: `incomplete`).
  2.  Creates Stripe Customer.
  3.  Generates Stripe Checkout Session URL.
- **Response:** `{ "checkoutUrl": "https://stripe.com/..." }`

### B. Stripe Webhook
**POST** `/v1/webhooks/stripe`
- **Headers:** `stripe-signature`
- **Logic:**
  1.  Verifies signature.
  2.  On `checkout.session.completed`: Updates Chapter status to `active`.
  3.  On `invoice.payment_failed`: Updates Chapter status to `past_due`.

### C. Create Invite
**POST** `/v1/chapters/:id/invites`
- **Guard:** `ChapterGuard` (Admin only)
- **Response:** `{ "token": "abc-123", "url": "https://frapp.app/join/abc-123" }`

### D. Accept Invite
**POST** `/v1/onboarding/join`
- **Body:** `{ "token": "abc-123" }`
- **Logic:**
  1.  Validates token (exists, not expired, not used).
  2.  Adds current User to Chapter `members` table.
  3.  Marks token as used.

## 5. Security & Constraints
- **Idempotency:** Stripe webhooks must handle duplicate events gracefully.
- **RBAC:** Only `admin` role can generate invites (We need to add `role` to `members` table).
- **Secrets:** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` must be validated on startup.
