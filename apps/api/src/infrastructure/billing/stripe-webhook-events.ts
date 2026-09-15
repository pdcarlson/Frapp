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
 * prevent: the two Stripe endpoints registered on 2026-08-27 — the Signet
 * TEST-mode pair, `we_1U93QB3Dzz3XLCb6mYeeNzUF` (staging) and
 * `we_1U9Qrn3Dzz3XLCb6VQw047AJ` — enable only five of these six, having been
 * written down by hand and never updated when `payment_intent.payment_failed`
 * was added to the handler. The live-mode endpoint created 2026-09-15 has all
 * six; it is the test-mode pair that still needs correcting.
 */
export const HANDLED_WEBHOOK_EVENT_TYPES: ReadonlySet<string> = new Set([
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
]);
