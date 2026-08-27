# Chapter Billing (Stripe)

## The chapter subscription

- **$149 per chapter / month, USD, flat**, billed as a Stripe recurring subscription. Commercial framing and the free-tier split are in [`spec/product/positioning.md`](../product/positioning.md); this section is the mechanical contract.
- **One Price, one line item, `quantity: 1`.** `StripeService.createCheckoutSession` builds `line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }]` in `mode: 'subscription'`. A different `STRIPE_PRICE_ID` can therefore change **the amount and nothing else** — per-seat billing, quantity tiers, and per-chapter price variation each need a code change first, because a quantity-tiered Price would always resolve to its first tier against a hardcoded quantity of 1.
- **A 14-day trial opens at checkout**, set by `subscription_data.trial_period_days` (#913). It has to be set there: Stripe's Price object exposes no writable trial field, so a trial cannot be carried by `STRIPE_PRICE_ID` and is lost silently if that argument is dropped — the checkout would then charge on day zero while the public site still advertises a free trial. `stripe.service.spec.ts` asserts it separately for that reason.
- Stripe reports the window as `trialing`, which `mapStripeStatus` folds into `active`. No `trial` state exists in the database and none is needed — the `subscription_status` CHECK allows only `incomplete`/`active`/`past_due`/`canceled`, and a trialing chapter is deliberately a fully active one to every permission gate.
- **The trial is once per chapter, not once per checkout session.** A chapter that has ever held a subscription (`subscription_id` is set) gets no trial on a later checkout, and is charged immediately. This has to be decided by `BillingService`, which can see billing history, and is passed down as `grantTrial` — the provider adapter cannot tell a first subscription from a fifth. It is deliberately keyed on having held a subscription rather than on status, because a chapter can return to `canceled` repeatedly.
- That guard is load-bearing rather than defensive. Checkout now refuses `active` and `past_due` and reuses the chapter's stored customer (§Duplicate checkout below), so Stripe _can_ see a returning chapter's trial history — but `grantTrial` remains the boundary rather than a second line of defence, because it is keyed on our own record of having held a subscription rather than on what Stripe infers from a Customer. A `canceled` chapter still reaches checkout by design, and it is `grantTrial` alone that stops it collecting another 14 free days on every return.
- When the trial is withheld, `subscription_data` is omitted from the session entirely rather than sent with a zero-day trial. Absence is the unambiguous way to say "no trial" — a repeat checkout is then an ordinary immediate charge, with no dependence on how Stripe treats `trial_period_days: 0`.

## Webhook Reliability

- Stripe webhooks are the **source of truth** for subscription status changes.
- Every webhook event is checked for idempotency using the Stripe event ID (never process the same event twice). The check is **durable**, not per-process: the event id is claimed in `stripe_webhook_events` **before** any side effect runs, so a redelivery after a deploy, a crash, or onto a second API instance is skipped rather than re-applied. Only the five event types with side effects are claimed; anything else is logged and dropped without touching the table. Ordering (below) and event-id dedup are orthogonal — the `last_stripe_webhook_at` mark deliberately treats a same-second redelivery as fresh, so it cannot deduplicate on its own.
- The claim is a compare-and-set (`claim_stripe_webhook_event`): of N simultaneous deliveries of one event, exactly one claims it. The losers return **503 rather than acknowledging** — acking would tell Stripe the event was delivered while the winner's outcome is still unknown, so a winner that then failed would leave the event dropped with nothing to retry it. A claim left `processing` for more than 5 minutes is treated as abandoned — the worker died mid-handler — and the next delivery takes it over, so a crash cannot wedge an event permanently.
- Processing is therefore **at-least-once**, deliberately: a handler that crashes after its side effects but before the row is marked `processed` is retried once its claim goes stale. Losing a billing event is the worse failure, so the design errs toward a rare replay rather than a rare drop.
- A handler failure stamps `status = 'failed'` with the error and the attempt count, then returns 5xx so Stripe retries; a `failed` row is immediately re-claimable. `attempts` and `last_error` are the retry forensics — a poison event shows up as a climbing attempt count rather than silence.
- Metadata-resolved handlers (`checkout.session.completed`, `payment_intent.succeeded`) verify that the chapter/invoice ids in the event metadata are UUIDs before touching the database. Other integrations can share a Stripe account, and a foreign event's arbitrary metadata would otherwise reach uuid-typed columns and fail the request — which Stripe would retry for days. Foreign metadata is acknowledged and logged instead.
- Timestamp-aware: an older webhook event must not overwrite a newer subscription status. The chapter row carries a `last_stripe_webhook_at` high-water mark — the `event.created` of the most recently applied webhook. Every subscription webhook (`checkout.session.completed`, `customer.subscription.updated`/`deleted`, `invoice.paid`) ignores any event older than the mark and stamps the mark with its own `event.created` when it applies — including a renewal `invoice.paid` that doesn't change status, so a later out-of-order dunning event that predates the payment can't downgrade the chapter. On a `customer.subscription.updated`/`deleted` event the president is notified only when the mapped status actually changes — no duplicate alert for a repeated `past_due` or an already-`canceled` chapter.

## Edge Cases

| Scenario                                      | Handling                                                                                                                                                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User pays but browser crashes before redirect | Webhook (`checkout.session.completed`) activates the chapter regardless.                                                                                                                                         |
| Stripe is down during chapter creation        | API returns 503 Service Unavailable. Chapter is NOT created in the database (no orphaned records).                                                                                                               |
| Webhook arrives before database commit        | Use upsert logic in the webhook handler; retry naturally on the next Stripe delivery.                                                                                                                            |
| Subscription lapses to `past_due`             | 3-day grace period. During grace: read access continues, invite/create actions blocked. After grace or upon `canceled`: hard lock (read-only).                                                                   |
| Chapter has active members when canceled      | All members retain read access. No new actions. Data preserved indefinitely for re-activation.                                                                                                                   |
| Duplicate checkout attempts                   | Checkout is refused while the chapter holds a live subscription (`active`, `past_due`) and pointed at the Customer Portal; every session is opened against the chapter's stored `stripe_customer_id`. See below. |

### Duplicate checkout: how the dedup holds (#929)

Two independent mechanisms, because either alone leaves a hole.

**1. A live subscription refuses checkout.** `BillingService.createCheckoutSession` rejects `active` and `past_due` with a 400 pointing at the Customer Portal, which updates the existing subscription in place and cannot double-subscribe. `past_due` is the case that matters: the subscription is live and in dunning, so a second checkout would bill the chapter twice, indefinitely, while Stripe kept dunning the first.

`canceled` is deliberately **not** refused. A canceled subscription is terminal at Stripe — `mapStripeStatus` folds both `canceled` and `incomplete_expired` into it — and the Portal cannot resume one; it only reactivates a subscription still scheduled to cancel at period end, which Stripe still reports as `active`. Refusing `canceled` would leave the chapter with no way back into the product. Nothing live remains to orphan, and mechanism 2 keeps the returning chapter on one customer.

**2. Every session is opened against the chapter's own customer.** `CreateCheckoutParams` carries `customerId` and no email: `BillingService` resolves the customer (creating and persisting one only if the chapter has none) before calling the adapter, and `StripeService` passes `customer`. Stripe mints a fresh Customer for any `customer_email` it is handed, so the old email path made a repeat checkout structurally unrecognisable as the same chapter. Removing the email field entirely — rather than preferring the id when present — is what makes that unrepresentable instead of merely guarded.

This also repairs a case that was never a duplicate at all: on a **first** checkout the customer was persisted and then dropped, so it was orphaned immediately, and permanently if the treasurer abandoned checkout — leaving `POST /v1/billing/portal` opening a portal for a customer that owned no subscription.

**Reconciliation signal.** `handleCheckoutCompleted` still stores the incoming subscription (it is the one now billing the chapter; dropping it would hide a live subscription from the app), but logs at `error` with both ids when it replaces a different stored `subscription_id`, or when the session's customer differs from the stored one. The reference is therefore never replaced _silently_.

**The refusal reaches clients as a `message`, not a `code`**, because `AllExceptionsFilter` drops `code` from every error response (#1020). The two refusal strings are stable and distinct so a client can map them; `subscription-checkout-card.tsx` routes on `subscription_status` directly rather than on the response.

**Client routing.** `past_due` → Portal. `canceled` → checkout. The web card enforces this as an affordance; both are now real server boundaries as well.

## Billing Adapter Pattern

Application logic talks to an `IBillingProvider` interface, never directly to the Stripe SDK. This allows future provider changes (e.g. LemonSqueezy) without touching business logic.

## Member Invoices (Dues)

- Admins with `billing:manage` create invoices for individual members (e.g. semester dues).
- **Field bounds** (rejected with 400 at the edge, so a client form can pre-validate against them): `amount` is in cents and must be **1 – 99,999,999** — the upper bound is Stripe's own per-charge maximum for USD ($999,999.99), above which the PaymentIntent could never be created, so accepting the invoice would only defer the failure to payment time. `title` is capped at 255 characters and `description` at 2,000.
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
- **Invoice list visibility:** `GET /v1/invoices` returns the _whole chapter's_ invoices to a `billing:view` holder; a member without that permission sees only their own rows. Payment ownership is enforced by the API (the 403 below), so a client rendering the chapter-wide list must not offer a pay affordance on an invoice whose `user_id` is not the viewer's — the client gate only avoids offering an action that cannot work; the 403 is the enforcement.
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

- The paid tier includes a monthly AI allowance, sized so that ~90% of chapters never overage. **The number is still `TBD`, and the blocker is not the analysis — it is that every input to the analysis is missing.** There is no `ai` module under `apps/api/src/modules/`, no metering table anywhere in `supabase/migrations/` (no `tokens_in`, `transcription_seconds`, or `upstream_cost_cents` column exists), and no LLM or transcription provider is referenced anywhere in the API. The only AI surface that exists is the mobile s17 mock, which answers from a keyword table and is off by default. So there is no usage to analyse and no upstream unit cost to normalise against.
- **Do not set a launch number by estimate.** An allowance is a dollar promise against provider costs that no one has picked yet; a guess here converts directly into either margin loss or a treasurer's surprise bill, which is the exact failure this model exists to prevent. The allowance is also **not on the critical path for billing** — it is a future line item with no Stripe object, so `STRIPE_PRICE_ID` and the flat subscription ship without it.
- **What has to exist first, in order:** (1) the AI features and their chosen provider/model, (2) the metering row this spec already mandates below — `(chapter_id, feature, tokens_in, tokens_out, transcription_seconds, upstream_cost_cents, billed_at)`, written before the response returns, and (3) roughly a quarter of real multi-chapter usage. The allowance is then read off the 90th percentile of observed monthly cost, not chosen. Until (1) and (2) land, this stays `TBD: blocked on AI metering`.
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
