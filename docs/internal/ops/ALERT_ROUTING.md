# Alert Routing

## Primary channels

- **Critical production alerts:** on-call paging channel
- **Non-critical staging alerts:** engineering notifications channel
- **Error tracking:** Sentry project alerts — org `frapp-live`, projects `frapp-api` (NestJS API) and `frapp-web` (Next dashboard)

> **`frapp-web` exists but is not receiving events yet.** The project was created during #865
> (`javascript-nextjs`, team `frapp-live`). What remains is adding `NEXT_PUBLIC_SENTRY_DSN` to
> **Infisical** (Staging + Production), which the `vercel-web-staging` / `vercel-web-production`
> syncs then carry into Vercel — tracked in
> [#970](https://github.com/pdcarlson/Frapp/issues/970). Until that lands, `apps/web` initializes
> Sentry not at all, so a silent `frapp-web` means "not configured", not "no errors".
>
> Two projects rather than one is deliberate: a browser error and a server error have different
> owners, different noise profiles, and different alert thresholds.
>
> Creating a project needs org-owner rights. `frapp-live` had *"Let members create projects"* off,
> which made the Sentry MCP's `create_project` fail with
> `HTTP 403 "Your organization has disabled this feature for members."` — worth knowing, because that
> error names *members* and reads like a token-scope problem when it is an org toggle.

> **Sentry alert rules are dashboard-only.** Sentry's issue-alert-rule API answers `HTTP 410 {"message":"This API no longer exists."}`, so no agent or script can create, read, or verify a rule. Every rule below has to be created by a human in the Sentry UI, and its existence cannot be asserted in CI — treat the dashboard as the source of truth and re-check it by hand when routing changes.

## Automated GitHub-issue alerts

Three watchdogs alert through GitHub Issues rather than a provider channel — no new service, no new
token, and the issue thread doubles as the incident log. Each upserts **one** tracking issue (created
if absent, reopened if closed, otherwise commented). All three carry `routine-state`, which `/next` §0.2
treats as never-claimable — they track live state, not a unit of work, so do not pick them up as
backlog.

| Alert issue title | Raised by | Means | Clears when |
| --- | --- | --- | --- |
| *Deploy API is failing — pushes are not reaching the environment* | `deploy-outcome` job, `deploy-api.yml` | the last `Deploy API` run that tried to deploy did not succeed | a later run deploys successfully |
| *Staging conformance is failing — frapp-staging has drifted* | `staging-conformance.yml` (daily 07:00 UTC) | at least one assertion about live `frapp-staging` **failed** — paused project, disabled auth hook, or a failing secret sync | the assertions named in the issue's own `conformance-failing:` marker **pass again** |
| *Database schema drift — a deployed database no longer matches supabase/migrations/* | `check-migration-drift.yml` (daily 07:00 UTC) | a deployed database's `schema_migrations` does not match `supabase/migrations/` — behind, or carrying a version that exists nowhere in the repo | every environment is back in sync |

**Two scheduled watchdogs, two separate concerns.** `check-migration-drift.yml` owns migration
parity for *every* environment; `staging-conformance.yml` owns everything else about staging and
deliberately does **not** re-run the drift comparison, so one real drift raises exactly one alert.
If both alerts are open at once they are telling you about different problems.

**Read the conformance alert's clearing condition literally — an open issue does not always mean
"broken right now."** It closes only when the specific assertions it names pass, not merely when
nothing fails, because an assertion that stops being *runnable* would otherwise read as a recovery
(deleting a credential would resolve the alert). So an alert can stay open on a staging that is
fine, because the thing it was raised for can no longer be checked. The daily run in that state is
**green and exits 0** while the issue stays open, and its step summary says
*"Nothing failed, but the open alert is not cleared"* — check the latest run's summary before
opening an investigation.

One conformance assertion is **not runnable** as of this workflow's merge: the end-to-end sign-in
needs a smoke credential that is not provisioned (#893), so it reports SKIPPED and a broken sign-in
chain is **not** currently detected by it. Migration parity is not missing — it is covered by the
migration-drift row above.

No watchdog closes on a run that proved nothing: a no-op deploy run and an all-skipped
conformance run both leave an open alert open. Mechanics and rationale:
[`AGENT_INFRA.md`](../ci-cd/AGENT_INFRA.md) § "Deploy visibility" and § "Scheduled conformance".

## Critical alerts

- API health check down
- sustained 5xx error-rate threshold breaches
- webhook delivery failure spikes
- push notification delivery failure spikes
- database latency saturation impacting request SLAs

## Thresholds

### Push notification delivery

Source: the `push_delivery` structured log records the API emits once per push attempt. Field-by-field shape: [`spec/behavior/observability.md`](../../../spec/behavior/observability.md#push-delivery).

| Alert | Condition | Routing |
| ------------------------------ | ------------------------------------------------------------------------------------------ | ------------ |
| Push delivery failure spike | `sum(failures) / sum(attempted)` over a 15-minute window exceeds **20%**, with at least **20** attempts in that window | critical |
| Push transport degraded | any `errorCodes` key matching `provider:*` within a 15-minute window | non-critical |

The minimum-attempt floor keeps one failed send in a quiet overnight period from paging. Elevated `DeviceNotRegistered` is expected background noise — it means members uninstalled the app, and stale tokens are not pruned yet (tracked separately in [#524](https://github.com/pdcarlson/Frapp/issues/524), formerly FRA-218) — so track its share rather than paging on it. `provider:*` codes are the opposite: they mean the push service itself was unreachable and nothing was delivered.

### Security events

Source: the `security_event` structured log records the API emits on every 401, 403, and 429. Field-by-field shape: [`spec/behavior/observability.md`](../../../spec/behavior/observability.md#security-events).

| Alert | Condition | Routing |
| ------------------------------ | ------------------------------------------------------------------------------------------- | ------------ |
| Auth-failure spike | one `originHash` produces **20** `kind: auth_failure` records within **5 minutes** | critical |
| Authorization-denial spike | `kind: authorization_denied` rate over a 15-minute window exceeds its trailing weekly baseline by 10× | non-critical |
| Throttle saturation | `kind: rate_limit_rejected` exceeds **5%** of all requests over a 15-minute window | non-critical |

Only the first is currently **implemented**, as an in-process counter that emits a `warning`-level Sentry event tagged `security_event: auth_failure_spike`. The other two rows are the intended thresholds, not live rules — they need a provider-side query over the log stream.

The in-process counter is per-instance, reset by deploys, and evadable by origin rotation (reasoning in the spec section linked above). It is a first-alert mechanism, not a complete count, and a provider-side rule over the same records is the layer that closes those gaps.

**A denial spike is not automatically an attack.** A botched deploy that invalidates sessions, an expired signing key, or a client shipping a bad token all present as an auth-failure spike. Check whether the failures share one `originHash` (an attacker) or fan out across many (something of ours broke) before escalating.

## Escalation

1. On-call acknowledges within 5 minutes.
2. If unresolved in 15 minutes, escalate to backend lead.
3. If customer-impacting for 30+ minutes, involve product leadership and status communications.
