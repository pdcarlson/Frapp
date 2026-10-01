## 5. Render Setup (API)

Create **two** Render Web Services: one for production, one for staging.

### 5.1 Create Services

1. Go to https://dashboard.render.com → **New** → **Web Service**.
2. Connect your GitHub repo.

| Setting             | Production                                | Staging               |
| ------------------- | ----------------------------------------- | --------------------- |
| **Name**            | `frapp-api-prod`                          | `frapp-api-staging`   |
| **Service ID**      | `renderServiceId` of `production` in [`.github/environments.json`](../../../.github/environments.json) ([why there](../../../spec/environments/README.md#environment-identity)) | `renderServiceId` of `staging` there |
| **Branch**          | `main`                                    | `main`                |
| **Auto-Deploy**     | **No** — deploys are API-driven by commit | **No** — same, from `deploy-staging.yml` (#2505, #2803) |
| **Root Directory**  | (leave empty — Dockerfile uses repo root) | (same)                |
| **Runtime**         | Docker                                    | Docker                |
| **Dockerfile Path** | `apps/api/Dockerfile`                     | `apps/api/Dockerfile` |
| **Instance Type**   | Starter ($7/mo) or Free                   | Free                  |

### 5.2 Environment Variables

As with Vercel ([environment variables](vercel.md#42-environment-variables-per-project)), these are **not entered by hand in the Render dashboard**. Infisical holds
the canonical values and its syncs push them into `frapp-api-staging` and `frapp-api-prod`
(`render-api-staging` and `render-api-production`); the dashboard is the destination. See
[`SECRETS_MANAGEMENT.md`](../../internal/environment/SECRETS_MANAGEMENT.md) for the sync setup
and [`ENV_REFERENCE.md`](../../internal/environment/ENV_REFERENCE.md) for the full variable list.
The full per-environment grid — every variable the API reads, with its `dev` / `staging` / `prod` value — is
[`ENV_REFERENCE.md` § "Canonical Variables — The Complete Grid"](../../internal/environment/ENV_REFERENCE.md#canonical-variables--the-complete-grid),
plus its § "API-Only Settings" and § "CD Secrets (Deploy Workflows Only)" subsections. Do not restate it here:
each sync reads path `/` and pushes the **whole** source environment ([`SECRETS_MANAGEMENT.md`](../../internal/environment/SECRETS_MANAGEMENT.md#5-configure-secret-syncs) § 5), so any short list understates what the service holds.

### 5.3 Custom Domains

- Production: `api.frapp.live` → point to `frapp-api-prod.onrender.com`
- Staging: `api-staging.frapp.live` → point to `frapp-api-staging.onrender.com`

### 5.4 Health Check

The API exposes `GET /health`, which answers `200` whether or not its dependency probes pass
([`health.controller.ts`](../../../apps/api/src/interface/controllers/health.controller.ts)). It
never throws, so a `200` proves the process booted and Nest is serving, not that the database is
reachable. The JSON body is the liveness payload in
[`spec/behavior/observability.md` § Health Check](../../../spec/behavior/observability.md#health-check).

> **This section previously claimed Render auto-detects the health check from the Dockerfile
> `HEALTHCHECK` directive. That claim is unverified and the configuration contradicts it.** Render
> exposes a per-service `healthCheckPath` setting, and on 2026-08-21 the live `frapp-api-staging`
> service reported `healthCheckPath: ""` — empty — while [`render.yaml`](../../../render.yaml)
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
> **2026-09-28 (#2805):** that loop is gone. Both environments' deploys now run
> `verify-served-commit.mjs` in the shared `_deploy.yml` job, which requires `/health/ready` to
> answer 2xx **and** report the deployed commit.
>
> **2026-09-08:** `scripts/ci/production-guardrails.mjs` asserts the live
> `serviceDetails.healthCheckPath` on `frapp-api-prod` is `/health`, daily at 07:15
> and as the `deploy-production.yml` preflight. Empty (TCP-only) and `/health/ready`
> both fail the run. The alert title was not renamed — it is the lookup key.
>
> **2026-09-08 (later):** `scripts/ci/staging-conformance.mjs` asserts the same
> nested field on `frapp-api-staging`, daily at 07:30. This path is Render's
> HTTP gate on every staging deploy. Missing
> `RENDER_API_KEY` is SKIPPED, not a pass.
>
> **2026-09-09:** the same daily job now also asserts `frapp-api-staging`
> `autoDeploy: "yes"` and `branch: "main"` (top-level fields on the live
> GET). A dashboard click that turns auto-deploy off, or points the service
> at another branch, freezes staging while healthCheckPath and Auth
> assertions stay green on a stale host. Production-guardrails still asserts
> the inverse (`autoDeploy: "no"`) under its own alert title — do not fold
> that expected value into this suite.
>
> **2026-09-25 ([#2505](https://github.com/pdcarlson/Frapp/issues/2505)):
> reversed.** Staging now expects `autoDeploy: "no"`, like production.
> `deploy-api.yml` deploys `frapp-api-staging` by commit through the Render
> API, after CI and `migrate-staging`, so auto-deploy is no longer what keeps
> staging current. Left on, it builds every push before either gate, and its
> deploy races the one `deploy-api.yml` creates. The `branch: "main"`
> assertion stands. Since [#2803](https://github.com/pdcarlson/Frapp/issues/2803)
> that workflow is `deploy-staging.yml`; the reasoning is unchanged.

### 5.5 In-process chat workers (Chunk 05)

Two background workers run inside the API Render service via NestJS `OnApplicationBootstrap` hooks — `ChatBridgeWorkerModule` (audit-log → `#chapter-audit` mirroring) and `ChatPushWorkerModule` (chat push fanout). Both open Supabase Realtime subscriptions with the service-role key on boot.

**Every replica receives every event, and the database decides which one acts (#2846).** Realtime delivers each `INSERT` to every subscribed process, so each worker claims its unit of work before any side effect:

- **Push worker:** it inserts the message id into `chat_push_dispatches` (primary key) before reading anything, and only the replica whose insert wins fans the message out. The loser stops at a `23505`. A claim insert that fails any other way skips that message's pushes and logs `chat-push: dispatch claim failed`, so on a write with an unknown outcome a missed push beats a double one. An hourly `@Cron` on every replica deletes claims older than a day (`chat-push: purged N expired dispatch claims`); the delete is idempotent.
- **Audit bridge:** each mirror is posted with `client_message_id = audit:<audit row id>`, so the existing `idx_chat_messages_dedupe` unique index refuses every insert after the first. The loser logs `chat-bridge: audit <id> already mirrored` at debug level.

The claim is at most once. It is never released, so if the winning replica is killed or errors partway through a fan-out (a deploy's SIGTERM, a failed roster read), the recipients it had not reached get no push; the other replica returned on the claim. A single instance loses the same pushes the same way. Before #2846 a second instance covered them only by sending everyone a duplicate.

Still per replica: the push worker's burst bundler, which counts in-process, so a burst whose messages land on different replicas bundles less (extra pushes in a burst, never a duplicate of one message). Also its presence subscriptions: every replica joins a channel's presence on the first message it hears there, won or not, so any replica can read who is in the channel. Each replica keeps at most 80 open (`MAX_PRESENCE_CHANNELS`) and closes the one whose last message is oldest to open another, because every channel a process opens shares one Supabase client and Supabase refuses joins past 100 per client (#2507). A refused or timed-out join logs `chat-push: presence join <status> for <channel>` and reports `chat-push presence join failed` to Sentry, at most once per 10 minutes per replica. And the channel cache (below).

This is the deliberate default for now per [**ADR-09**](../../../spec/architecture/adr/adr-09.md) (Push worker host = in-process API). The workers should be split into a standalone Render service when **either** condition is sustained:

- `p99 fanout latency > 1s` (from the `chat_messages` INSERT to `notifyUser` returning), **or**
- `worker-loop CPU > 40%` of the API instance over a 10-minute window.

The latency half is the `chat.push.fanout` Sentry transaction (op `chat.push`): one per message the replica claimed, from the row's `created_at` to the end of its fan-out, so it includes Realtime's delivery lag. It carries three counts: `chat.push.recipients`, `chat.push.sent` and `chat.push.presence_channels` (the open presence channels at that moment). Read the watermark over transactions with `chat.push.sent` above 0: a message that pushed nobody (no audience, everyone muted or reading) is a transaction too, and a fast one. The span starts on arrival instead of `created_at` when that timestamp is unreadable, in the future, or more than 10 minutes old (a redelivery after a long reconnect), so those late messages read short. It is sampled at `SENTRY_TRACES_SAMPLE_RATE` like every other transaction, and nothing alerts on it yet (#2507). The CPU half has no measure.

When the split happens, deploy `ChatPushWorkerModule` (and `ChatBridgeWorkerModule` if needed) as a separate Render Background Worker reading from the same secrets; no code changes are required beyond a new entry point that boots just those modules.

### 5.6 In-process scheduled jobs

`ScheduledJobsModule` runs eight `@Cron` sweeps inside the API Render service: attendance auto-absent (hourly), poll-expiry announcement (every 5 minutes), pre-event reminders (every 5 minutes), invoice and task due/overdue reminders (daily at 09:00), generated-report retention (hourly), the stale-palette sweep (hourly), which recomputes each chapter's stored accent palette when the accent engine has changed since it was written ([`accent-engine.md` § 4](../../../spec/ui/design-system/accent-engine.md#4-caching-and-persistence), #1165), and the chat report evidence sweep (hourly), which deletes the attachments a resolved chat report held when the release at resolve time did not finish ([`chat/README.md` § Report](../../../spec/behavior/chat/README.md#report), #2481). They are registered against the `ScheduleModule.forRoot()` in `app.module.ts`.

**These reach multi-replica safety the same way as the [§5.5 chat workers](#55-in-process-chat-workers-chunk-05), from a different trigger.** The chat workers receive every Realtime event on every replica and claim each one before acting. A `@Cron` handler instead fires on **every replica, on every tick**. Multi-instance safety therefore comes from the database, not the topology: each unit of work claims a row in `scheduled_notification_dispatches`, unique on `(entity_type, entity_id, threshold, due_date)`, and only the replica that wins the insert acts. Reminders cannot be double-sent, and auto-absent runs once per event rather than once per replica per hour.

**The report-retention sweep is the exception, and deliberately takes no claim.** The claim exists to stop a _duplicate side effect_ — the same reminder sent twice. Deleting a storage object is idempotent: both replicas list before either deletes, so the loser issues `remove()` against keys that are already gone, and Supabase reports success for those (verified against the local stack: `remove()` on a missing key returns no error and an empty result array). It needs no dispatch row, and adding one would only make the sweep skip work after a crash. It also reads its work list from storage rather than the `chapters` table — it lists the chapter folders under the `reports` bucket — so its cost scales with chapters that have _exported_, not with chapters that exist, and a prefix whose chapter row was deleted still gets reaped.

**The chat report evidence sweep takes no claim either, for the report-retention sweep's reason.** Its side effect is a Storage delete, which is idempotent, and its bookkeeping is a timestamp stamped on each report whose release finished. Two replicas can release the same report at once; both delete the same objects and both stamp it. It only takes reports resolved more than 15 minutes ago, so it stays clear of a removal whose claim may still be withdrawn back to open.

**The stale-palette sweep takes no claim either, for a different reason: its write is compare-and-set.** Every replica reads the chapters whose `theme_palette_engine_version` is `NULL` or behind the running engine and recomputes each one, but the `UPDATE` matches only while the row is still stale **and** its `branding.colors.accent` is the seed the palette was derived from. The replica that loses finds the row current and writes nothing, and an officer's accent save that lands between the read and the write is never overwritten. A second replica costs duplicated CPU (one palette derivation per stale chapter: about 4–8 ms for a seed whose scale already clears §8, and about 30–105 ms median for one the §8 lift has to lighten, which since #2605 walks until the fill, its hover and the label on the hover all clear. Single calls reach about 160 ms and a process's first call about 175 ms. Measured in a cloud sandbox on 2026-09-23, after #2605; the dearest seeds are deep reds, greens and blues such as `#8B0000`, `#006400` and `#0000FF`), not a duplicated side effect. Each derivation is followed by an awaited write, so the event loop is never held for more than one. In steady state every row is current and each tick is one query that returns nothing. The ticks that matter are the first after a deploy that bumps `SIGNET_ENGINE_VERSION` (or, once, the first after #1165 shipped, when every row started `NULL`): one `palette sweep: recomputed X/N …` log line per replica that found stale rows, where a replica that lost the race to another reports its rows as changed during the sweep. A read that fails logs `palette sweep: chapter lookup failed` each tick and no summary line at all, so silence from this sweep is not evidence it ran. A `failed` count in the summary says how many writes errored; each failed chapter also logs its own `palette sweep: chapter <id> could not be recomputed…` error line with the cause, and stays stale until a later tick succeeds.

Consequences worth knowing before scaling the API service:

- **Keep the API at one instance for now.** Adding replicas no longer multiplies the sweeps' notifications or the §5.5 chat workers' pushes and audit mirrors (#2846), but two things still assume one instance, and one of them is a disclosure path:
  - **The push worker's channel cache is per process** (`ChannelCacheService`, 30 s TTL). It holds each channel's `member_ids` and `required_permissions`, the inputs that decide who is pushed a 200-character preview, and a channel write evicts it only in the process that served the write. On two replicas, a member removed from a private channel can still be pushed a preview for up to 30 s by the replica that did not see the removal (#2917).
  - **The request throttler counts per process** (`ThrottlerModule.forRoot` in `app.module.ts` passes no `storage`, so `@nestjs/throttler` keeps the counts in memory). N replicas multiply both the read and the write limit by N, and every deploy or restart starts each count from zero, which nothing logs. These limits are what stand in front of invite redeem and every unauthenticated route (#2307). Either accept the weaker limit, or share the counts first: `forRoot` also takes `{ throttlers, storage }`, where `storage` implements Nest's `ThrottlerStorage`, so a shared store is a change to that one call. No Render Key Value instance exists in the workspace (read 2026-09-30), and the store's failure mode (fail open into no limit, or fail every request) has to be chosen before one is wired in. `frapp-api-prod` runs one instance (`numInstances: 1`, starter plan, read 2026-09-30).
  - The burst bundler and presence subscriptions above cost extra pushes, not correctness.
- The stale-palette sweep has no window at all, so a missed tick only delays it: every stale row stays in its candidate set until it is written.
- Five of the six notification and retention sweeps are self-healing across missed ticks — auto-absent looks back 24 hours, poll-expiry announcement also looks back 24 hours, overdue reminders 7 days, and due-soon reminders accept the due date itself as a late catch-up — so a deploy that skips 09:00 delays reminders rather than dropping them. Report retention re-derives what is expired from each object's stored-at timestamp on every tick, so missed ticks delay a delete rather than skipping it. A _persistent_ read failure is a different matter and is deliberately audible: the report-retention sweep logs a warning naming how many chapter prefixes it skipped, another if any object carries no stored-at timestamp (which it keeps rather than guessing), and an info line when it finds no chapter prefixes at all — the storage layer reports a missing bucket as an empty folder, so an unprovisioned or renamed `reports` bucket would otherwise be the one persistent failure that logged nothing. A sweep that silently reaps nothing forever would otherwise be indistinguishable from a healthy one.
- **The pre-event reminder sweep is the one exception, and it is not self-healing.** It has no lookback at all: its window is `(now, now + 30min]`, deliberately, so a reminder is never sent about an event that has already started. That gives each event exactly six chances at the 5-minute cadence, and anything that costs it all six **drops that event's reminder permanently** — no claim row is written, so nothing retries. When a deploy or an incident spans more than half an hour, assume the reminders due in that window did not go out; there is no backfill to run and members had no notice. This is the sweep to weigh first when scheduling a long evening maintenance window, when mandatory events cluster.
  - **A read failure is audible; a worker gap is not.** These two look identical in the outcome and completely different in the logs, which is what makes the distinction worth stating. A failing candidate query logs `event-reminder sweep: event lookup failed` once per failed page per tick — that line is the alertable signal for this class, and six of them in half an hour means reminders were dropped. A sweep that never ran logs nothing at all, and a sweep that ran and found nothing also logs nothing, so absence of output distinguishes neither. Only the error line is evidence; silence is not.
- The claim is taken _before_ sending. If every delivery for a claim fails it is released and retried next tick; if only some recipients fail the claim is kept and the shortfall is logged, so a partial failure is visible but never re-spams the recipients who did get it. Both the claim insert and the compensating delete bind `chapter_id` from the sweep row, so a failed send in one chapter cannot drop another chapter's claim.
- Timing is UTC. No `TZ` is set on the API service, so `EVERY_DAY_AT_9AM` means 09:00 UTC and the sweeps' date arithmetic is UTC-based. Setting `TZ` on the service would shift both together; do it deliberately, not incidentally.

Splitting these into a standalone Render Background Worker is not currently warranted — the sweeps are short, and the two 5-minute ones do bounded, indexed window queries — but if they are split, they must not run in _both_ places at once unless each keeps its own multi-replica guard: the dispatch claim for the reminder, poll-expiry and auto-absent sweeps, idempotent deletes for report retention, and the compare-and-set write for the stale-palette sweep. For the claiming sweeps, the claim is the only thing preventing duplicate work.

### 5.7 Deploy Hooks (for GitHub Actions)

No deploy hook is used. Both API services deploy by commit through the Render API with `RENDER_API_KEY` (a GitHub environment secret): `deploy-production.yml` for `frapp-api-prod`, and `deploy-staging.yml` for `frapp-api-staging` (by commit since [#2505](https://github.com/pdcarlson/Frapp/issues/2505)), both through the `_deploy.yml` job they call. A deploy hook can't name a commit; it builds the branch tip. A hook URL is also a bearer credential, so don't store one anywhere.

The one value the deploy workflows still take from **Infisical**, not GitHub, injected at job time ([`SECRETS_MANAGEMENT.md` § GitHub Actions is not a sync](../../internal/environment/SECRETS_MANAGEMENT.md#github-actions-is-not-a-sync)):

- `API_HEALTHCHECK_URL` → smoke-check URL, in both `staging` and `prod` (e.g. `https://api-staging.frapp.live/health` or `https://api.frapp.live/health`). The deploy workflows append `/ready` to this value themselves (`.../health/ready`) rather than polling `/health` directly, and staging's also requires the response's `commit` to be the deployed SHA; why the two differ is [`observability.md` § Health Check](../../../spec/behavior/observability.md#health-check). Set this secret to the `/health` URL, not `/health/ready` — the `/ready` suffix is added at call time.

**Don't create or store a deploy hook for either service**; [`ENV_REFERENCE.md`](../../internal/environment/ENV_REFERENCE.md) gives the reason. Earlier revisions of these docs told operators to store one. The production hook was stored and synced onward, and was regenerated and its copies removed on 2026-09-24 ([#2540](https://github.com/pdcarlson/Frapp/issues/2540)). The staging hook, stored in Infisical `staging` until #2505, gets the same treatment in [#2679](https://github.com/pdcarlson/Frapp/issues/2679). Staging's auto-deploy, the other half of that issue, read **off** on 2026-09-29 (Render API).

---
