# Chapter Billing (Stripe)

## Webhook Reliability

- Stripe webhooks are the **source of truth** for subscription status changes.
- Every webhook event is checked for idempotency using the Stripe event ID persisted in `stripe_webhook_events` (never process the same event twice, including after deploys/restarts).
- Timestamp-aware: an older webhook event must not overwrite a newer subscription status.

## Edge Cases

| Scenario                                      | Handling                                                                                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| User pays but browser crashes before redirect | Webhook (`checkout.session.completed`) activates the chapter regardless.                                                                       |
| Stripe is down during chapter creation        | API returns 503 Service Unavailable. Chapter is NOT created in the database (no orphaned records).                                             |
| Webhook arrives before database commit        | Use upsert logic in the webhook handler; retry naturally on the next Stripe delivery.                                                          |
| Webhook handler fails mid-processing          | Mark the persisted event row as failed and return an error so Stripe retries. Stale in-progress claims are reclaimable on a later retry.       |
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
