## 5. Render Setup (API)

Create **two** Render Web Services: one for production, one for staging.

### 5.1 Create Services

1. Go to https://dashboard.render.com → **New** → **Web Service**.
2. Connect your GitHub repo.

| Setting             | Production                                | Staging               |
| ------------------- | ----------------------------------------- | --------------------- |
| **Name**            | `frapp-api-prod`                          | `frapp-api-staging`   |
| **Branch**          | `main`                                    | `main`                |
| **Auto-Deploy**     | **No** — deploys are API-driven by commit | Yes (on commit)       |
| **Root Directory**  | (leave empty — Dockerfile uses repo root) | (same)                |
| **Runtime**         | Docker                                    | Docker                |
| **Dockerfile Path** | `apps/api/Dockerfile`                     | `apps/api/Dockerfile` |
| **Instance Type**   | Starter ($7/mo) or Free                   | Free                  |

### 5.2 Environment Variables

As with Vercel ([environment variables](vercel.md#42-environment-variables-per-project)), these are **not entered by hand in the Render dashboard**. Infisical holds
the canonical values and its syncs push them into `frapp-api-staging` and `frapp-api-prod`
(`render-api-staging` and `render-api-production`); the dashboard is the destination. See
[`SECRETS_MANAGEMENT.md`](../../environment/SECRETS_MANAGEMENT.md) for the sync setup
and [`ENV_REFERENCE.md`](../../environment/ENV_REFERENCE.md) for the full variable list.
The full per-environment grid — every variable the API reads, with its `dev` / `staging` / `prod` value — is
[`ENV_REFERENCE.md` § "Canonical Variables — The Complete Grid"](../../environment/ENV_REFERENCE.md#canonical-variables--the-complete-grid),
plus its § "API-Only Settings" and § "CD Secrets (Deploy Workflows Only)" subsections. Do not restate it here:
each sync reads path `/` and pushes the **whole** source environment ([`SECRETS_MANAGEMENT.md`](../../environment/SECRETS_MANAGEMENT.md#5-configure-secret-syncs) § 5), so any short list understates what the service holds.

### 5.3 Custom Domains

- Production: `api.frapp.live` → point to `frapp-api-prod.onrender.com`
- Staging: `api-staging.frapp.live` → point to `frapp-api-staging.onrender.com`

### 5.4 Health Check

The API exposes `GET /health`, which answers `200` in both states — `status: ok` when the database
round-trip succeeds, `status: degraded` when it does not
([`health.controller.ts`](../../../../apps/api/src/interface/controllers/health.controller.ts)). It
never throws, so a `200` proves the process booted and Nest is serving, not that the database is
reachable. The JSON body is the liveness payload in
[`spec/behavior/observability.md`](../../../../spec/behavior/observability.md) § Health Check.

> **This section previously claimed Render auto-detects the health check from the Dockerfile
> `HEALTHCHECK` directive. That claim is unverified and the configuration contradicts it.** Render
> exposes a per-service `healthCheckPath` setting, and on 2026-08-21 the live `frapp-api-staging`
> service reported `healthCheckPath: ""` — empty — while [`render.yaml`](../../../../render.yaml)
> declares `healthCheckPath: /health` for both API services. So the blueprint is **not** applied to
> that service, whatever Render does with the Dockerfile directive.
>
> What Render actually does with `HEALTHCHECK`, and whether an empty `healthCheckPath` disables
> health-gated deploys, is **not established here** — `render.com` is unreachable from agent
> sessions (egress-blocked), so it was not checked against Render's documentation. Confirm before
> relying on either behaviour. Reconciling the drift is tracked on #1160.
>
> **2026-09-06:** the drift was closed from the other side. `PATCH /v1/services/{id}` set
> `healthCheckPath: /health` on **both** `frapp-api-staging` and `frapp-api-prod` (read back as
> `/health` on each), so the live services now match the blueprint. The open question above was
> also settled that day from Render's own documentation
> ([render.com/docs/health-checks](https://render.com/docs/health-checks), read from an unrestricted
> session): with an **empty** `healthCheckPath` Render's probe is a plain **TCP socket check** on the
> open port; with a path set it sends `GET <path>` and treats `2xx`/`3xx` within five seconds as
> healthy. On a new deploy Render routes no traffic to the new instances until all of them pass, and
> **cancels the deploy** if they have not within 15 minutes. So the empty value never disabled
> deploy gating — it gated on "opened a port" rather than "answered HTTP". The page does not mention
> the Dockerfile `HEALTHCHECK` directive at all, so whether Render reads it remains unestablished.
> `/health` is the right value here because it is the plain liveness probe that always 2xxs; the
> readiness half is the `/health/ready` smoke loop in `deploy-production.yml`.
>
> **2026-09-08:** `scripts/ci/production-guardrails.mjs` asserts the live
> `serviceDetails.healthCheckPath` on `frapp-api-prod` is `/health`, daily at 07:15
> and as the `deploy-production.yml` preflight. Empty (TCP-only) and `/health/ready`
> both fail the run. The alert title was not renamed — it is the lookup key.
>
> **2026-09-08 (later):** `scripts/ci/staging-conformance.mjs` asserts the same
> nested field on `frapp-api-staging`, daily at 07:30. Staging auto-deploys
> `main` on commit, so this path is the HTTP gate on those deploys. Missing
> `RENDER_API_KEY` is SKIPPED, not a pass.
>
> **2026-09-09:** the same daily job now also asserts `frapp-api-staging`
> `autoDeploy: "yes"` and `branch: "main"` (top-level fields on the live
> GET). A dashboard click that turns auto-deploy off, or points the service
> at another branch, freezes staging while healthCheckPath and Auth
> assertions stay green on a stale host. Production-guardrails still asserts
> the inverse (`autoDeploy: "no"`) under its own alert title — do not fold
> that expected value into this suite.

### 5.5 In-process chat workers (Chunk 05)

Two background workers run inside the API Render service via NestJS `OnApplicationBootstrap` hooks — `ChatBridgeWorkerModule` (audit-log → `#chapter-audit` mirroring) and `ChatPushWorkerModule` (chat push fanout). Both open Supabase Realtime subscriptions with the service-role key on boot.

This is the deliberate default for now per [**ADR-09**](../../../../spec/architecture/adr/adr-09.md) (Push worker host = in-process API). The workers should be split into a standalone Render service when **either** condition is sustained:

- `p99 fanout latency > 1s` (measured per recipient, from `chat_messages` INSERT to `notifyUser` returning), **or**
- `worker-loop CPU > 40%` of the API instance over a 10-minute window.

When the split happens, deploy `ChatPushWorkerModule` (and `ChatBridgeWorkerModule` if needed) as a separate Render Background Worker reading from the same secrets; no code changes are required beyond a new entry point that boots just those modules.

### 5.6 In-process scheduled jobs

`ScheduledJobsModule` runs six `@Cron` sweeps inside the API Render service: attendance auto-absent (hourly), poll-expiry announcement (every 5 minutes), pre-event reminders (every 5 minutes), invoice and task due/overdue reminders (daily at 09:00), and generated-report retention (hourly). They are registered against the `ScheduleModule.forRoot()` in `app.module.ts`.

**These differ from the [§5.5 chat workers](#55-in-process-chat-workers-chunk-05) in one way that matters for scaling.** The chat workers each hold a single Supabase Realtime subscription, so extra replicas mostly duplicate a stream. A `@Cron` handler instead fires on **every replica, on every tick**. Multi-instance safety therefore comes from the database, not the topology: each unit of work claims a row in `scheduled_notification_dispatches`, unique on `(entity_type, entity_id, threshold, due_date)`, and only the replica that wins the insert acts. Reminders cannot be double-sent, and auto-absent runs once per event rather than once per replica per hour.

**The report-retention sweep is the exception, and deliberately takes no claim.** The claim exists to stop a _duplicate side effect_ — the same reminder sent twice. Deleting a storage object is idempotent: both replicas list before either deletes, so the loser issues `remove()` against keys that are already gone, and Supabase reports success for those (verified against the local stack: `remove()` on a missing key returns no error and an empty result array). It needs no dispatch row, and adding one would only make the sweep skip work after a crash. It also reads its work list from storage rather than the `chapters` table — it lists the chapter folders under the `reports` bucket — so its cost scales with chapters that have _exported_, not with chapters that exist, and a prefix whose chapter row was deleted still gets reaped.

Consequences worth knowing before scaling the API service:

- Adding replicas does **not** multiply notifications, and needs no configuration change.
- Five of the six sweeps are self-healing across missed ticks — auto-absent looks back 24 hours, poll-expiry announcement also looks back 24 hours, overdue reminders 7 days, and due-soon reminders accept the due date itself as a late catch-up — so a deploy that skips 09:00 delays reminders rather than dropping them. Report retention re-derives what is expired from each object's stored-at timestamp on every tick, so missed ticks delay a delete rather than skipping it. A _persistent_ read failure is a different matter and is deliberately audible: the report-retention sweep logs a warning naming how many chapter prefixes it skipped, another if any object carries no stored-at timestamp (which it keeps rather than guessing), and an info line when it finds no chapter prefixes at all — the storage layer reports a missing bucket as an empty folder, so an unprovisioned or renamed `reports` bucket would otherwise be the one persistent failure that logged nothing. A sweep that silently reaps nothing forever would otherwise be indistinguishable from a healthy one.
- **The pre-event reminder sweep is the one exception, and it is not self-healing.** It has no lookback at all: its window is `(now, now + 30min]`, deliberately, so a reminder is never sent about an event that has already started. That gives each event exactly six chances at the 5-minute cadence, and anything that costs it all six **drops that event's reminder permanently** — no claim row is written, so nothing retries. When a deploy or an incident spans more than half an hour, assume the reminders due in that window did not go out; there is no backfill to run and members had no notice. This is the sweep to weigh first when scheduling a long evening maintenance window, when mandatory events cluster.
  - **A read failure is audible; a worker gap is not.** These two look identical in the outcome and completely different in the logs, which is what makes the distinction worth stating. A failing candidate query logs `event-reminder sweep: event lookup failed` once per failed page per tick — that line is the alertable signal for this class, and six of them in half an hour means reminders were dropped. A sweep that never ran logs nothing at all, and a sweep that ran and found nothing also logs nothing, so absence of output distinguishes neither. Only the error line is evidence; silence is not.
- The claim is taken _before_ sending. If every delivery for a claim fails it is released and retried next tick; if only some recipients fail the claim is kept and the shortfall is logged, so a partial failure is visible but never re-spams the recipients who did get it. Both the claim insert and the compensating delete bind `chapter_id` from the sweep row, so a failed send in one chapter cannot drop another chapter's claim.
- Timing is UTC. No `TZ` is set on the API service, so `EVERY_DAY_AT_9AM` means 09:00 UTC and the sweeps' date arithmetic is UTC-based. Setting `TZ` on the service would shift both together; do it deliberately, not incidentally.

Splitting these into a standalone Render Background Worker is not currently warranted — the sweeps are short, and the two 5-minute ones do bounded, indexed window queries — but if they are split, they must not run in _both_ places at once unless the dispatch claim is preserved, since that is the only thing preventing duplicate work.

### 5.7 Deploy Hooks (for GitHub Actions)

In each Render service → Settings → Deploy Hook → copy the URL. Store secrets as GitHub **environment-scoped** secrets (same names in both environments, different values):

- `RENDER_DEPLOY_HOOK_URL` → deploy hook URL for that environment
- `API_HEALTHCHECK_URL` → smoke-check URL for that environment (e.g. `https://api-staging.frapp.live/health` or `https://api.frapp.live/health`). The deploy workflows append `/ready` to this value themselves (`.../health/ready`) rather than polling `/health` directly — `/health` is Render's own `healthCheckPath` and always returns 2xx, while `/health/ready` 503s on a degraded dependency (see `spec/behavior/observability.md` § Health Check). Set this secret to the `/health` URL, not `/health/ready` — the `/ready` suffix is added at call time.

---
