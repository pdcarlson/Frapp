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
 * prevent. The list itself lives in one place — below. What drifts are the
 * copies typed into the Stripe dashboard by hand: every endpoint registered
 * before 2026-09-28 lacked at least one of these six (#1978, #2285), because the
 * runbook used to name none of them. That is why the six are now named in
 * `docs/ops/deployment/integrations.md` § 7.1, at the step where an
 * endpoint is created.
 *
 * What each endpoint subscribes to today is dashboard state, not a repo fact:
 * `integrations.md` § 7 and `docs/internal/environment/ENV_REFERENCE.md` record
 * it with its date and source, and only the warning
 * `stripe-webhook-consistency.service.ts` logs at boot checks it. An agent
 * sandbox cannot read it for live mode, where the Stripe MCP is test-mode only.
 */
export const HANDLED_WEBHOOK_EVENT_TYPES: ReadonlySet<string> = new Set([
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
]);
