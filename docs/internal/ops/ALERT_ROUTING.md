# Alert Routing

## Primary channels

- **Critical production alerts:** on-call paging channel
- **Non-critical staging alerts:** engineering notifications channel
- **Error tracking:** Sentry project alerts — org `frapp-live`, projects `frapp-api` (NestJS API), `frapp-web` (Next dashboard) and `frapp-mobile` (Expo app)

> **`frapp-web` exists but is not receiving events yet.** The project was created during #865
> (`javascript-nextjs`, team `frapp-live`). What remains is adding `NEXT_PUBLIC_SENTRY_DSN` to
> **Infisical** (Staging + Production), which the `vercel-web-staging` / `vercel-web-production`
> syncs then carry into Vercel — tracked in
> [#970](https://github.com/pdcarlson/Frapp/issues/970). Until that lands, `apps/web` initializes
> Sentry not at all, so a silent `frapp-web` means "not configured", not "no errors".
>
> Two projects rather than one is deliberate: a browser error and a server error have different
> owners, different noise profiles, and different alert thresholds. `frapp-mobile` extends the same
> reasoning to the third runtime.
>
> Creating a project needs org-owner rights. During #865/#970 `frapp-live` had
> *"Let members create projects"* off, which made the Sentry MCP's `create_project` fail with
> `HTTP 403 "Your organization has disabled this feature for members."` — worth knowing, because that
> error names *members* and reads like a token-scope problem when it is an org toggle.
>
> **That no longer reproduces.** On 2026-08-29 the same MCP call created `frapp-mobile` (#1299)
> without a prompt or an error. An org toggle is not agent-observable, so what changed is not
> recorded here — only that the call now succeeds. Try it before routing a human to the dashboard.

> **`frapp-mobile` exists and the app is wired, but no event has been proven yet.** The project was
> created 2026-08-29 (`react-native`, team `frapp-live`) and `apps/mobile` initializes
> `@sentry/react-native` through `lib/sentry/options.ts` (#1299). Two things remain, and neither is
> something a PR can contain: `EXPO_PUBLIC_SENTRY_DSN` must be entered per profile in the **EAS
> dashboard** — there is no Infisical→EAS sync, so it does not arrive on its own — and a real error
> has to be captured from a **dev build on a physical device**, which needs the EAS project tracked
> in [#938](https://github.com/pdcarlson/Frapp/issues/938). Expo Go cannot exercise a native SDK's
> crash handling, so "it works in Go" is not evidence. Until both land, a silent `frapp-mobile`
> means "not configured", not "no errors".
>
> Environment tagging is per build profile in the committed `eas.json`
> (`development` / `staging` / `production`), not a dashboard value — an EAS profile exposes no
> `VERCEL_ENV` equivalent to the bundle.

> **Sentry alert rules are dashboard-only.** Sentry's issue-alert-rule API answers `HTTP 410 {"message":"This API no longer exists."}`, so no agent or script can create, read, or verify a rule. Every rule below has to be created by a human in the Sentry UI, and its existence cannot be asserted in CI — treat the dashboard as the source of truth and re-check it by hand when routing changes.

## Automated GitHub-issue alerts

These watchdogs alert through GitHub Issues rather than a provider channel — no new service, no new
token, and the issue thread doubles as the incident log. Each upserts **one** tracking issue (created
if absent, reopened if closed, otherwise commented). All of them carry `routine-state`, which
`/next` §0.2 treats as never-claimable — they track live state, not a unit of work, so do not pick
them up as backlog.

The table below is the roster. It carries no count on purpose: it previously said "four" while the
tree held five, because a count is a second copy of a fact the rows already state
(`DOCUMENTATION_CONVENTIONS.md` § one canonical place per fact). The authoritative list is every
`scripts/ci/*.mjs` that exports an `ALERT_ISSUE_TITLE` or declares one in an `ALERT_CONFIGS` entry —
`grep -rn "ALERT_ISSUE_TITLE\|alertTitle:" scripts/ci/*.mjs` enumerates them.

| Alert issue title | Raised by | Means | Clears when |
| --- | --- | --- | --- |
| *Deploy API is failing — pushes are not reaching the environment* | `deploy-outcome` job, `deploy-api.yml` | the last `Deploy API` run that tried to deploy did not succeed | a later run deploys successfully |
| *Deploy Vercel staging is failing — web and landing are not reaching staging* | `deploy-outcome` job, `deploy-vercel-staging.yml` | the last `Deploy Vercel staging` run that tried to deploy did not succeed, so at least one of `app.staging.frapp.live` / `staging.frapp.live` is serving an older commit. The job builds and aliases **web first, landing second**, so a late failure can leave web current and landing stale — the alert is per-run, not per-host, and does not say which. Check the run before assuming both. **P2, not P1:** staging only — the production frontends deploy through `deploy-production.yml`, which reports separately in its own `report` job | a later run deploys successfully |
| *Staging conformance is failing — frapp-staging has drifted* | `staging-conformance.yml` (daily 07:30 UTC) | at least one assertion about live `frapp-staging` **failed** — paused project, disabled auth hook, Auth SMTP reverted to the hosted 2/hour cap, Magic Link template lost `token_hash`, empty or non-`/health` `healthCheckPath` on `frapp-api-staging`, auto-deploy off or not tracking `main` on `frapp-api-staging`, or a failing secret sync | the assertions named in the issue's own `conformance-failing:` marker **pass again** |
| *Production Auth settings have drifted* | `production-auth-conformance.yml` (daily 07:45 UTC) | at least one assertion about live `frapp-prod` Auth **failed** — paused project, disabled auth hook, missing `https://app.frapp.live/**` / `frapp://**`, Site URL pointed at the staging origin, or Auth SMTP on with a From other than `Signet <no-reply@mail.frapp.live>` / send cap under 300/hour, or SMTP on with a Magic Link template that still uses ConfirmationURL. Empty SMTP is SKIPPED, not a fail (hosted 2/hour cap until [#1824](https://github.com/[REDACTED]/Frapp/issues/1824)). **P1.** Does not name `environment: production` (#1435) | the assertions named in the issue's own `conformance-failing:` marker **pass again** |
| *Database schema drift — a deployed database no longer matches supabase/migrations/* | `check-migration-drift.yml` (daily 07:00 UTC) | a deployed database's `schema_migrations` does not match `supabase/migrations/` — behind, or carrying a version that exists nowhere in the repo | every environment is back in sync |
| *PR base sync cannot auto-update PR branches* | `pr-base-sync.yml` (every push to `main`) | at least one open PR was behind `main` and none could be updated automatically — no App token minted, the token rejected, or the update-branch API failing. **P2, not P1:** PRs still merge, they just need `Update branch` by hand, so this is degraded rather than down | a later sweep updates a branch, or runs with a working token and blocks on nothing |
| *Production deploy guardrails have drifted — auto-deploy or production branch is wrong* | `production-guardrails.yml` (daily 07:15 UTC) | a provider-side production setting no longer matches what the guardrails assert — auto-deploy on, wrong branch, empty or non-`/health` `healthCheckPath`, or a Vercel Git link. **P1.** The title is the lookup key and was not renamed when `healthCheckPath` was added. Listed here as of #1674 — it has raised alerts since it shipped, but the roster above it said "four" and never included it, which is the drift the removed count caused | a later guardrail run finds nothing drifted |
| *Production /health/ready is failing* | `production-uptime.yml` (every 15 minutes) | live `GET https://api.frapp.live/health/ready` was not HTTP 200 with JSON `status: "ok"`. **P1.** Watches `/health/ready`, not `/health` — `/health` always 2xxes while the process is up. Does not name `environment: production` (#1435). Not a Sentry 60s monitor | a later probe returns 200 `status: "ok"` |
| *Production hosts are not on the same tagged commit* | `production-release-pin.yml` (daily 08:00 UTC) | live Render `frapp-api-prod` commit, Vercel `frapp-web` / `frapp-landing` READY production `githubCommitSha`, and a peeled `vX.Y.Z` tag do not name the same SHA — split-brain, or a named-SHA Deploy that skipped Release. Matching `main` is not required. `/health` `commit` is corroboration only. **P1.** Does not name `environment: production` (#1435) | a later run finds the three hosts on one `vX.Y.Z` |
| *production-backup has required reviewers — nightly dumps will expire* | `production-backup-env.yml` (daily 06:15 UTC) | GitHub environment `production-backup` gained `required_reviewers` or a `wait_timer`, or the GET was unreadable / the env is missing. **P1.** A `schedule:` job that hits that gate suspends and expires, so nightly dumps look covered and write nothing (#1435). Does not name `environment: production` or `environment: production-backup`. `deployment_branch_policy: null` is not this alert | a later run finds empty `protection_rules` |
| *Nightly production dump is stale or failed — recoverability is unproven* | `production-backup-freshness.yml` (daily 13:15 UTC) | the latest `db-backup.yml` `backup-production` job is missing, not success, hung more than 3h, or last success older than 36h, or the Actions GET was unreadable. **P1.** In-flight under 3h is not this alert and does not close an open one. Does not name `environment: production` or `environment: production-backup` (#1435). The hosted restore leftover stays on its own issue (1861); the reviewer watch stays on its own issue (1956) | a later run finds `backup-production` succeeded within 36h |

Unlike the others, two alerts comment only on a state *change*, not on every run: the base-sync alert (per-merge) and the production `/health/ready` probe (every 15 minutes). An already-open one is never re-commented. An
open one that has gone quiet is still live, not stale. Setup for the App the base-sync alert depends on is human-only
and tracked in [#689](https://github.com/pdcarlson/Frapp/issues/689).

**The two deploy watchdogs are one script, two configurations.** `scripts/ci/deploy-alert.mjs` serves
both `deploy-api.yml` and `deploy-vercel-staging.yml`; which one it is reporting on is chosen by the
`ALERT_CONFIG` env var set in each workflow's `deploy-outcome` job, and an unknown value is a hard
error rather than a silent fallback to the default. They are deliberately **separate alert issues**
with separate titles: the title is the lookup key, so a shared one would let a recovered API deploy
close a live Vercel outage's alert. Renaming either title orphans whatever alert is open under the old
one — it could never be found again, and so would never self-close.

`production-guardrails.mjs` is also `deploy-production.yml`'s preflight, but that invocation
(`--preflight`) **files nothing** — it exits non-zero on a violation and lets the deploy fail. So an
open alert never means someone's deploy was blocked. It does **not** follow that a scheduled run
raised it: the early exit is gated on the `--preflight` flag, not on the trigger, so a
`workflow_dispatch` of the workflow raises and clears exactly as the cron does. Read the alert's run
link rather than assuming the 07:15 window.

**The scheduled watchdogs own disjoint concerns, and are staggered.** `production-backup-env.yml`
(06:15 UTC) owns that GitHub environment `production-backup` has no required reviewers or wait
timer, fifteen minutes before `db-backup.yml` (06:30) tries to run under it; `check-migration-drift.yml`
(07:00 UTC) owns migration parity for *every* environment; `production-guardrails.yml` (07:15) owns
provider-side production settings; `staging-conformance.yml` (07:30) owns everything else about
staging and deliberately does **not** re-run the drift comparison; `production-auth-conformance.yml`
(07:45) owns Auth hook + redirect allow list + skip-until-on SMTP + skip-until-SMTP-on Magic Link on `frapp-prod`; `production-release-pin.yml` (08:00) owns the three production hosts sharing a peeled `vX.Y.Z`; `production-backup-freshness.yml` (13:15) owns that the latest `backup-production` dump succeeded within 36h. One real drift still raises exactly
one alert. If several of these alerts are open at once they are telling you about different
problems. The staggering has more than one reason — the full schedule and its rationale are
[`AGENT_INFRA.md`](../ci-cd/AGENT_INFRA.md) § Scheduled conformance, which owns that fact.

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
chain is **not** currently detected by it. A half-set `SUPABASE_URL` / `SUPABASE_ANON_KEY` pair is
a different outcome (FAIL, not SKIPPED) — owned by
[`AGENT_INFRA.md`](../ci-cd/AGENT_INFRA.md#scheduled-conformance-scriptscistaging-conformancemjs)
(#1767). Migration parity is not missing — it is covered by the
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

The minimum-attempt floor keeps one failed send in a quiet overnight period from paging. Elevated `DeviceNotRegistered` is expected background noise — it means members uninstalled the app. The token behind each such ticket is pruned from `push_tokens` automatically (`spec/behavior/notifications.md` delivery step 7), so a rising `DeviceNotRegistered` share tracks uninstalls, not a growing backlog of dead tokens — still track its share rather than paging on it, since it is expected traffic, not an outage. `provider:*` codes are the opposite: they mean the push service itself was unreachable and nothing was delivered.

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

### Billing webhooks

Source: `error`-level Sentry events `BillingService` emits when a Stripe webhook names a chapter it cannot resolve (#1710), tagged `billing_event`. Behaviour and cooldown are specified in [`spec/behavior/billing.md` § Webhook Reliability](../../../spec/behavior/billing.md#webhook-reliability) — read the window from there rather than restating it here.

| Alert | Condition | Routing |
| ------------------------------ | ------------------------------------------------------------------------------------------- | ------------ |
| Checkout paid, chapter unknown | `billing_event: checkout_unknown_chapter`, Sentry `environment: production` | critical |

The event carries a pseudonymized `chapter` tag when `ANALYTICS_HMAC_SALT` is set, which is what keeps distinct chapters from collapsing into one issue keyed on the constant message.

**There is deliberately no equivalent row for subscription-resolved events.** An unresolvable subscription stays a `warn` with no Sentry event, because what reaches that branch is expected traffic: either a **superseded reference** — `checkout.session.completed` overwrites `subscription_id` when a canceled chapter resubscribes, and the app then tells the operator to cancel the superseded subscription in Stripe, which emits `customer.subscription.deleted` for a subscription no chapter references — or a subscription whose customer this database has never seen. The one case that *was* a genuine loss, a subscription event overtaking its own checkout, no longer lands there: since #1738 it is resolved through `stripe_customer_id` and applied (`spec/behavior/billing.md` § Webhook Reliability). Alerting on the remainder would page on a flow the product itself instructs.

**Scope the rule on Sentry's `environment`, which is set from `NODE_ENV` ([`sentry-options.ts`](../../../apps/api/src/infrastructure/observability/sentry-options.ts)).** There is no live-vs-test-mode field on these events — Stripe's `livemode` is not carried — so `environment` is the only discriminator available. It is load-bearing rather than tidiness: local dev shares **both** a Stripe test-mode account ([`ENV_REFERENCE.md` § Core App Secrets](../environment/ENV_REFERENCE.md#core-app-secrets), `STRIPE_SECRET_KEY`) and a Sentry DSN ([§ API-Only Settings](../environment/ENV_REFERENCE.md#api-only-settings), `SENTRY_DSN`) with staging, so every developer checkout fans out to the staging endpoint and reports into the same project. An unscoped rule fires on routine local billing work, gets muted, and takes the live signal with it.

The API's cooldown reduces duplicates but **does not guarantee one event per occurrence** — the map is in-memory, so it is per-instance, reset by every deploy, and bounded, so a busy period can evict an entry early. Tune thresholds on "at least one", never on an exact count.

Per the note above, Sentry alert rules are dashboard-only and cannot be asserted in CI, so **the row above describes a rule a human still has to create**; until then the event lands in the default unresolved stream. Do not add a second rule for the subscription case — see the paragraph above for why it would page on an expected flow.

## Escalation

1. On-call acknowledges within 5 minutes.
2. If unresolved in 15 minutes, escalate to backend lead.
3. If customer-impacting for 30+ minutes, involve product leadership and status communications.
