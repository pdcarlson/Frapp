import { db, miss } from "../harness.mjs";

console.log(
  "\n=== Functional: a Stripe event is applied once, and a failed or abandoned one is retried ===",
);
{
  // `claim_stripe_webhook_event` decides whether a Stripe delivery may change a
  // chapter's billing, and every API test mocks it. This is the CI-run proof of
  // its outcomes: the first delivery claims, a repeat while it runs is told
  // in_flight, a repeat after it finished is told already_processed, a failed
  // event and one whose worker died (a claim older than the lease) are claimed
  // again with a climbing attempt count, and nobody but the API may call it.
  // The two follow-up writes copy SupabaseStripeWebhookEventRepository's
  // markProcessed and markFailed. PGlite has one connection, so two deliveries
  // at the same instant are not raced here; the function's comment explains
  // why `on conflict ... do update ... where` lets only one win.
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const claim = async (eventId, staleSeconds = 300) => {
    const { rows } = await db.query(
      `select * from claim_stripe_webhook_event($1, 'invoice.paid', $2)`,
      [eventId, staleSeconds],
    );
    return rows[0];
  };
  const row = async (eventId) =>
    (
      await db.query(
        `select status, attempts, last_error, processed_at from stripe_webhook_events where event_id = $1`,
        [eventId],
      )
    ).rows[0];

  try {
    await db.exec("begin;");

    const first = await claim("evt_once");
    check(
      "the first delivery claims the event",
      first?.claim_outcome === "claimed" && first?.claim_attempts === 1,
      first,
    );

    const again = await claim("evt_once");
    check(
      "a repeat while the first is still running is told in_flight, and claims nothing",
      again?.claim_outcome === "in_flight" &&
        (await row("evt_once")).attempts === 1,
      again,
    );

    await db.query(
      `update stripe_webhook_events set status = 'processed', processed_at = now(), last_error = null where event_id = $1`,
      ["evt_once"],
    );
    const done = await claim("evt_once");
    const doneRow = await row("evt_once");
    check(
      "a repeat after it finished is told already_processed and leaves it finished",
      done?.claim_outcome === "already_processed" &&
        doneRow.status === "processed" &&
        doneRow.processed_at !== null,
      { done, doneRow },
    );
    const doneLongAfter = await claim("evt_once", 0);
    check(
      "a finished event is never claimed again, however old",
      doneLongAfter?.claim_outcome === "already_processed",
      doneLongAfter,
    );

    await claim("evt_fails");
    await db.query(
      `update stripe_webhook_events set status = 'failed', last_error = 'Stripe API timeout' where event_id = $1`,
      ["evt_fails"],
    );
    const retry = await claim("evt_fails");
    const retryRow = await row("evt_fails");
    check(
      "a failed event is claimed again, the attempt counted and the old error cleared",
      retry?.claim_outcome === "claimed" &&
        retry?.claim_attempts === 2 &&
        retryRow.status === "processing" &&
        retryRow.last_error === null,
      { retry, retryRow },
    );

    await claim("evt_abandoned");
    await db.query(
      `update stripe_webhook_events set claimed_at = now() - interval '10 minutes' where event_id = $1`,
      ["evt_abandoned"],
    );
    const fresh = await claim("evt_abandoned", 3600);
    check(
      "a claim younger than the lease still counts as running",
      fresh?.claim_outcome === "in_flight",
      fresh,
    );
    const takeover = await claim("evt_abandoned", 300);
    check(
      "a claim older than the lease (its worker died) is taken over",
      takeover?.claim_outcome === "claimed" && takeover?.claim_attempts === 2,
      takeover,
    );
    const afterTakeover = await claim("evt_abandoned", 300);
    check(
      "the takeover renews the lease, so the next repeat is in_flight again",
      afterTakeover?.claim_outcome === "in_flight",
      afterTakeover,
    );

    const grants = (
      await db.query(
        `select
           has_function_privilege('anon', 'public.claim_stripe_webhook_event(text, text, integer)', 'execute') as anon,
           has_function_privilege('authenticated', 'public.claim_stripe_webhook_event(text, text, integer)', 'execute') as authed,
           has_function_privilege('service_role', 'public.claim_stripe_webhook_event(text, text, integer)', 'execute') as service`,
      )
    ).rows[0];
    check(
      "only the API may call it",
      grants.anon === false &&
        grants.authed === false &&
        grants.service === true,
      grants,
    );
  } catch (e) {
    check(
      "stripe-webhook-claim scenario ran",
      false,
      String(e?.message ?? e).split("\n")[0],
    );
  } finally {
    await db.exec("rollback;").catch(() => {});
  }

  for (const r of results) {
    if (r.ok) {
      console.log(`OK    ${r.name}`);
    } else {
      miss();
      console.log(
        `MISS  ${r.name}\n        ↳ ${JSON.stringify(r.detail ?? null).slice(0, 300)}`,
      );
    }
  }
}
