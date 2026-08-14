# Chapter Billing (Stripe)

## Webhook Reliability

- Stripe webhooks are the **source of truth** for subscription status changes.
- Every webhook event is checked for idempotency using the Stripe event ID (never process the same event twice). The check is **durable**, not per-process: the event id is claimed in `stripe_webhook_events` **before** any side effect runs, so a redelivery after a deploy, a crash, or onto a second API instance is skipped rather than re-applied. Only the five event types with side effects are claimed; anything else is logged and dropped without touching the table. Ordering (below) and event-id dedup are orthogonal — the `last_stripe_webhook_at` mark deliberately treats a same-second redelivery as fresh, so it cannot deduplicate on its own.
- The claim is a compare-and-set (`claim_stripe_webhook_event`): of N simultaneous deliveries of one event, exactly one claims it. The losers return **503 rather than acknowledging** — acking would tell Stripe the event was delivered while the winner's outcome is still unknown, so a winner that then failed would leave the event dropped with nothing to retry it. A claim left `processing` for more than 5 minutes is treated as abandoned — the worker died mid-handler — and the next delivery takes it over, so a crash cannot wedge an event permanently.
- Processing is therefore **at-least-once**, deliberately: a handler that crashes after its side effects but before the row is marked `processed` is retried once its claim goes stale. Losing a billing event is the worse failure, so the design errs toward a rare replay rather than a rare drop.
- A handler failure stamps `status = 'failed'` with the error and the attempt count, then returns 5xx so Stripe retries; a `failed` row is immediately re-claimable. `attempts` and `last_error` are the retry forensics — a poison event shows up as a climbing attempt count rather than silence.
- Metadata-resolved handlers (`checkout.session.completed`, `payment_intent.succeeded`) verify that the chapter/invoice ids in the event metadata are UUIDs before touching the database. Other integrations can share a Stripe account, and a foreign event's arbitrary metadata would otherwise reach uuid-typed columns and fail the request — which Stripe would retry for days. Foreign metadata is acknowledged and logged instead.
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
- Overdue invoices: an invoice counts as overdue once it is OPEN past its `due_date` **plus the chapter's dues grace period** (the `wf_dues_grace` workflow, enabled with a 7-day threshold by default — see the runtime-enforcement rules in [`settings/customization.md`](settings/customization.md)); a notification is sent to the member and the invoice is flagged as overdue in the admin dashboard.
- Invoice reminders are sent by a daily scheduled sweep: **1 day before `due_date`** while the invoice is still OPEN (matching the task reminder lead time in [`tasks.md`](tasks.md)), and again once it crosses `due_date` plus the dues grace. Each threshold notifies at most once per invoice — delivery is recorded in `scheduled_notification_dispatches`, so re-running a sweep, or running it on several API instances, cannot duplicate a reminder. An invoice that went overdue more than 7 days ago is not retro-notified.
- Financial transactions log all payments, refunds, and adjustments with Stripe charge IDs for reconciliation.

### Member payment flow

- A member initiates payment with `POST /v1/invoices/:id/payment-intent` — **owner-only** (the invoice's `user_id` must be the caller) and only for an `OPEN` invoice. The endpoint creates a Stripe PaymentIntent (`amount` in cents, `usd`, metadata `invoice_id`/`chapter_id`/`user_id`) and returns `{ client_secret, payment_intent_id }` for client-side confirmation.
- The stored intent is **reused** when it is still confirmable (`requires_payment_method`, `requires_confirmation`, `requires_action`, `processing`); a `succeeded` intent returns 409 (payment already completed, confirmation pending); a `canceled` intent — or one the provider no longer knows (e.g. after a key/account migration) — is replaced by a fresh one.
- Minting is idempotent per stored-intent generation: concurrent first attempts collapse into one provider-side intent, so a double-tap cannot produce two separately chargeable intents for one invoice.
- The invoice's OPEN state is re-checked **after** the provider round-trip, on both the new-intent and reuse paths, and the intent id is stamped only while it still holds; if the invoice settled or was voided in that window the request fails (409 when already paid) rather than handing out a live client secret for a non-payable invoice.
- A second request arriving while the first is still in flight at the provider gets 409 ("payment attempt already in progress"), not a 503 — the idempotency key collapses them into one intent by design.
- The route is **subscription-exempt**: dues collection must stay reachable while the chapter's own subscription is `past_due`/`canceled` — collecting dues is exactly how a chapter recovers.
- **Invoice list visibility:** `GET /v1/invoices` returns the *whole chapter's* invoices to a `billing:view` holder; a member without that permission sees only their own rows. Payment ownership is enforced by the API (the 403 below), so a client rendering the chapter-wide list must not offer a pay affordance on an invoice whose `user_id` is not the viewer's — the client gate only avoids offering an action that cannot work; the 403 is the enforcement.
- **Failure responses** for the payment-intent endpoint, for clients mapping errors: **400** — the invoice is no longer OPEN; **403** — the caller is not the invoice's owner; **409** — the two cases above (payment already completed / attempt already in flight), distinguished by the server's own message; **503** — the payment provider is unavailable.
- Only the `payment_intent.succeeded` webhook moves an invoice to PAID on the Stripe path; the pay endpoint never does.
- **A successful client-side confirmation means the money moved, not that the invoice settled.** Clients must re-read the invoice until the server reports PAID, and until then surface "payment received, confirmation pending" — never a locally-declared PAID the webhook has not written.

### Payment webhook idempotency

- `payment_intent.succeeded` resolves the invoice from the intent's **metadata** (written only by our server, delivered inside a signature-verified event). Events without invoice metadata (e.g. subscription checkouts), or whose metadata ids are not UUIDs (another integration sharing the Stripe account), are acknowledged and ignored — never surfaced as a 5xx, which would make Stripe retry the same event for days.
- Payment is applied by the `apply_invoice_payment` RPC: a compare-and-set (`status = 'OPEN'` → `PAID`, stamping `paid_at` and the succeeded intent's id) plus the `PAYMENT` transaction insert (with the Stripe charge id) in **one database transaction**. **Both** PAID writers go through it — the webhook (intent + charge ids) and the admin manual transition (nulls; any stored intent id is preserved) — so whichever side loses the race gets zero rows and writes no ledger entry. This is invoice-level idempotency, independent of the chapter-level `last_stripe_webhook_at` mark (which orders subscription state only). A manual transition that loses the race returns 400 rather than silently double-recording the payment.
- Unique partial indexes on `financial_invoices.stripe_payment_intent_id` and `financial_transactions.stripe_charge_id` (PAYMENT rows) are the durable idempotency floor beneath the CAS.
- Moving an invoice to either terminal state — **VOID or a manual PAID** — cancels its outstanding PaymentIntent, so a payment sheet the member already opened can no longer capture money (voiding would leave an unrecorded charge; a cash-marked PAID would double-charge). Cancellation is best-effort: a provider failure is logged and does not block the transition, and a refused cancel (e.g. the intent is already `processing`) is logged as a reconciliation signal rather than swallowed.
- Any `payment_intent.succeeded` that cannot be applied and whose charge has no ledger row — a VOID invoice, or a second intent on an already-PAID one — is logged as a **reconciliation warning** (money captured, nothing recorded; resolve by refund or reissue). A miss is treated as a benign redelivery **only** when its charge id is already in the ledger. An event carrying no charge id cannot be matched (a manual PAID writes a null-charge row and preserves the stored intent id, so a genuine redelivery is indistinguishable from a cash entry that raced a card capture) and is warned as ambiguous rather than assumed benign — pinning a Stripe API version that sends `latest_charge` removes the ambiguity.

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
