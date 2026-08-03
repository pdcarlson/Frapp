# Chapter Billing (Stripe)

## Webhook Reliability

- Stripe webhooks are the **source of truth** for subscription status changes.
- Every webhook event is checked for idempotency using the Stripe event ID (never process the same event twice).
- Timestamp-aware: an older webhook event must not overwrite a newer subscription status. The chapter row carries a `last_stripe_webhook_at` high-water mark — the `event.created` of the most recently applied webhook. Every subscription webhook (`checkout.session.completed`, `customer.subscription.updated`/`deleted`, `invoice.paid`) ignores any event older than the mark and stamps the mark with its own `event.created` when it applies — including a renewal `invoice.paid` that doesn't change status, so a later out-of-order dunning event that predates the payment can't downgrade the chapter. On a `customer.subscription.updated`/`deleted` event the president is notified only when the mapped status actually changes — no duplicate alert for a repeated `past_due` or an already-`canceled` chapter.

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

### Member payment flow

- A member initiates payment with `POST /v1/invoices/:id/payment-intent` — **owner-only** (the invoice's `user_id` must be the caller) and only for an `OPEN` invoice. The endpoint creates a Stripe PaymentIntent (`amount` in cents, `usd`, metadata `invoice_id`/`chapter_id`/`user_id`) and returns `{ client_secret, payment_intent_id }` for client-side confirmation.
- The stored intent is **reused** when it is still confirmable (`requires_payment_method`, `requires_confirmation`, `requires_action`, `processing`); a `succeeded` intent returns 409 (payment already completed, confirmation pending); a `canceled` intent is replaced by a fresh one.
- The route is **subscription-exempt**: dues collection must stay reachable while the chapter's own subscription is `past_due`/`canceled` — collecting dues is exactly how a chapter recovers.
- Only the `payment_intent.succeeded` webhook moves an invoice to PAID on the Stripe path; the pay endpoint never does.

### Payment webhook idempotency

- `payment_intent.succeeded` resolves the invoice from the intent's **metadata** (written only by our server, delivered inside a signature-verified event). Events without invoice metadata (e.g. subscription checkouts) are ignored.
- Payment is applied by the `apply_invoice_payment` RPC: a compare-and-set (`status = 'OPEN'` → `PAID`, stamping `paid_at` and the succeeded intent's id) plus the `PAYMENT` transaction insert (with the Stripe charge id) in **one database transaction**. Duplicate deliveries, and a webhook racing an admin's manual PAID transition, update zero rows and are silent no-ops — this is invoice-level idempotency, independent of the chapter-level `last_stripe_webhook_at` mark (which orders subscription state only).
- Unique partial indexes on `financial_invoices.stripe_payment_intent_id` and `financial_transactions.stripe_charge_id` (PAYMENT rows) are the durable idempotency floor beneath the CAS.
- A `payment_intent.succeeded` for a **VOID** invoice is logged as a reconciliation warning: money was captured but no ledger row is written — resolve manually (refund or reissue).

### Ledger provenance invariant

- A `PAYMENT` transaction with a **non-null** `stripe_charge_id` was written by the webhook path and is Stripe-reconciled. A `PAYMENT` transaction with a **null** `stripe_charge_id` is a manual/offline record (admin `billing:manage` marked the invoice PAID — e.g. cash dues). The API surface cannot forge charge ids: invoice DTOs do not expose Stripe fields and validation rejects unknown properties.

## AI Usage Pricing

AI features ([`ai.md`](ai.md), meeting summarization in [`meetings.md`](meetings.md)) are gated behind the paid tier with an **allowance + at-cost overage** model. Two design goals: members never see a meter at point-of-use, and the chapter treasurer never gets a surprise bill.

### Monthly allowance

- The paid tier includes a monthly AI allowance (size: TBD — sized so that ~90% of chapters never overage based on usage analysis. Carried as `TBD: pricing analysis` until the launch number is set).
- Allowance covers LLM tokens (Q&A, summarization) and transcription minutes, normalized to a dollar equivalent of upstream provider cost.
- Allowance resets on the chapter's monthly billing anniversary.
- Unused allowance does **not** roll over.

### At-cost overage

- Usage past the monthly allowance bills the chapter at the actual upstream provider cost — zero markup.
- The treasurer sees a real-time usage dashboard per chapter: allowance used / remaining / projected overage if current pace continues.
- A configurable hard cap (default: $0 overage allowed, configurable by the treasurer) prevents runaway costs. When the cap is reached, AI features return a "monthly cap reached — contact treasurer" error rather than continuing to bill.
- Alerts fire at 75%, 90%, and 100% of allowance + at 75%, 90%, 100% of any configured overage cap.

### Member-facing UX

Members **never see a meter or "this costs X" prompt at the point of using an AI feature.** The allowance + overage cost is a chapter-level concern surfaced only to the treasurer (`billing:view`/`billing:manage`). Member-facing prompts about cost would create perverse incentives against using the feature that the chapter is already paying for.

### Implementation invariants

- Every AI request is metered: `(chapter_id, feature, tokens_in, tokens_out, transcription_seconds, upstream_cost_cents, billed_at)`. The metering row is written before the response is returned to the client.
- Allowance and overage are computed from the meter, not from a separate balance. There is no mutable "balance" column.
- The hard cap is enforced server-side; clients never compute "should this request go through" locally.

## Chat Integration

Chat integration (slash commands, rich renderers, system channel): see [`integrations.md`](integrations.md).
