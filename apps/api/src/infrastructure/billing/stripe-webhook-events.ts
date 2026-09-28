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
 * prevent. Every Stripe endpoint registered before 2026-09-28 was missing at
 * least one of these six, and each a different one, because they are typed into
 * the Stripe dashboard by hand from a runbook that used to name no event types:
 * the test-mode endpoints lacked `payment_intent.payment_failed`, never updated
 * when it was added to the handler (#1978), and the live-mode endpoint lacked
 * `customer.subscription.updated` (#2285). Both were fixed by hand in the
 * dashboard on 2026-09-28.
 *
 * Nothing checks the dashboards against this list except the boot-time warning,
 * so do not read "fixed" above as current state. The list itself lives in one
 * place — below.
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
