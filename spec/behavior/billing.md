# Chapter Billing (Stripe)

## Webhook Reliability

- Stripe webhooks are the **source of truth** for subscription status changes.
- Every webhook event is checked for idempotency using the Stripe event ID (never process the same event twice).
- Timestamp-aware: an older webhook event must not overwrite a newer subscription status.

## Edge Cases

| Scenario                                      | Handling                                                                                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| User pays but browser crashes before redirect | Webhook (`checkout.session.completed`) activates the chapter regardless.                                                                       |
| Stripe is down during chapter creation        | API returns 503 Service Unavailable. Chapter is NOT created in the database (no orphaned records).                                             |
| Webhook arrives before database commit        | Use upsert logic in the webhook handler; retry naturally on the next Stripe delivery.                                                          |
| Subscription lapses to `past_due`             | 3-day grace period. During grace: read access continues, invite/create actions blocked. After grace or upon `canceled`: hard lock (read-only). |
| Chapter has active members when canceled      | All members retain read access. No new actions. Data preserved indefinitely for re-activation.                                                 |
| Duplicate checkout attempts                   | Deduplicate by `stripe_customer_id` + chapter; prevent creating multiple subscriptions for the same chapter.                                   |

## Billing Adapter Pattern

Application logic talks to an `IBillingProvider` interface, never directly to the Stripe SDK. This allows future provider changes (e.g. LemonSqueezy) without touching business logic.

## Member Invoices (Dues)

- Admins with `billing:manage` create invoices for individual members (e.g. semester dues).
- Invoice statuses: DRAFT (not yet sent), OPEN (sent, awaiting payment), PAID, VOID.
- Payments tracked via Stripe PaymentIntents. Webhook confirms payment and moves invoice to PAID.
- Overdue invoices: if an invoice is OPEN past its `due_date`, a notification is sent to the member and the invoice is flagged as overdue in the admin dashboard.
- Financial transactions log all payments, refunds, and adjustments with Stripe charge IDs for reconciliation.
