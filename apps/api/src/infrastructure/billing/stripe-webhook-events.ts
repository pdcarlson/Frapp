/**
 * The Stripe event types this API acts on — one copy, two readers.
 *
 * `billing.service.ts` uses it to drop everything else before the database is
 * touched (FRA-23), and `stripe-webhook-consistency.service.ts` uses it to
 * check that the registered Stripe endpoint actually sends them.
 *
 * It lives here rather than in `billing.service.ts` because the boot-time
 * consistency check must not import that service — doing so would drag the
 * whole billing dependency graph into a check that runs before the app is
 * listening. A second hand-maintained copy is the thing this file exists to
 * prevent. Every Stripe endpoint registered so far has been missing at least one
 * of these six, and each a different one, because they are typed into the Stripe
 * dashboard by hand from a runbook that used to name no event types at all:
 *
 *   - The Signet TEST-mode pair — `we_1U93QB3Dzz3XLCb6mYeeNzUF` (staging,
 *     2026-08-27) and `we_1U9Qrn3Dzz3XLCb6VQw047AJ` (registered against the
 *     PRODUCTION url, 2026-08-28) — are missing `payment_intent.payment_failed`,
 *     never updated when it was added to the handler (#1978).
 *   - The live-mode endpoint created 2026-09-15 is missing
 *     `customer.subscription.updated` instead (#2285), and production is the only
 *     environment that runs on it.
 *
 * Read the current state from those two issues, not from this comment: this is a
 * snapshot of dashboard state, nothing checks it, and the previous snapshot here
 * survived less than a day. The list itself already lives in one place — below.
 * What drifts are the copies in the Stripe dashboard, which is why the six types
 * are now named in `docs/internal/ops/deployment/integrations.md` § 7.1, at the
 * step where an endpoint is actually created.
 *
 * None of this is a repo fact, and none of it can be read from an agent sandbox,
 * where the Stripe MCP is test-mode only. The live-mode gap was found in
 * `frapp-api-prod`'s own boot log on 2026-09-15, in the warning
 * `stripe-webhook-consistency.service.ts` emits.
 */
export const HANDLED_WEBHOOK_EVENT_TYPES: ReadonlySet<string> = new Set([
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
]);
