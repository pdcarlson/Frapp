# Cloud Run (API)

The API is moving from Render to Google Cloud Run ([#5228](https://github.com/frapplive/Frapp/issues/5228)). Paul decided this on 2026-11-16, which changes [ADR-24](../../../spec/architecture/adr/adr-24.md) decision 1. This page is the runbook for the Google side. Until the cutover finishes, [`render.md`](render.md) still describes what serves traffic.

**State (2026-11-16):** both projects have run the setup script (staging's project number is `211663803311`, production's is `930610426605`). Both have Infisical's sync account, and Infisical syncs each environment into its project ([`SECRETS_MANAGEMENT.md` § Cloud Run API](../../internal/environment/SECRETS_MANAGEMENT.md#cloud-run-api-synced-to-secret-manager)). Both ran the script before it turned on Vertex AI and gave `frapp-api-runtime` access to it, so both need one more run of the current script before the API can drop its Vertex key file. Nothing on Google serves traffic.

## Shape

| Piece | Staging | Production |
| --- | --- | --- |
| Google Cloud project (frapp.live organization) | `nonprod` | `prod` |
| Region | `us-east4` (Ashburn) | `us-east5` (Columbus) |
| Cloud Run service | `frapp-api`, 1 vCPU, 1 GiB | `frapp-api`, 1 vCPU, 1 GiB |
| Instances | instance-based billing, min 0, max 1 | instance-based billing, min 1, max 1 |
| Image | built once on GitHub, pushed to `us-east4-docker.pkg.dev/<nonprod>/frapp/api` | the same digest, copied to `us-east5-docker.pkg.dev/<prod>/frapp/api` |
| Secrets | Infisical `staging`, synced to this project's Secret Manager | Infisical `prod`, synced to this project's Secret Manager |
| Address | the staging API host, through Cloudflare | `api.frapp.live`, through Cloudflare |

**Why two regions.** The API makes several database calls per request, so each environment runs next to its Supabase project. `frapp-staging` is in AWS `us-east-1` (Virginia) and `frapp-prod` is in `us-east-2` (Ohio), both read through the Supabase API on 2026-11-16. Ashburn and Columbus are the Google regions in those metros. Render ran both environments in Ohio, so on Render staging always paid the trip to Virginia.

**Why instance-based billing.** The API is more than a request handler. It runs every `@ReportedCron` sweep ([`render.md` § 5.6](render.md#56-in-process-scheduled-jobs)) and holds the Supabase Realtime subscriptions for the chat push and bridge workers ([`render.md` § 5.5](render.md#55-in-process-chat-workers-chunk-05)). Request-based billing throttles the CPU between requests, which would stall both.

**Why staging sleeps.** Staging runs at min 0 to keep it cheap, the same way Render's free staging slept. Cloud Run stops the instance about 15 minutes after its last request. Until the next request arrives, no sweep runs and no chat push or bridge fires. A pre-event reminder due in that window is dropped for good, because that sweep has no lookback ([`render.md` § 5.6](render.md#56-in-process-scheduled-jobs)). Staging was already like this on Render. Raising min to 1 makes staging always on, for about $45 a month more.

**Why one copy.** Each service has max 1 until two things become safe across copies: the push worker's per-process channel cache ([#2917](https://github.com/pdcarlson/Frapp/issues/2917)) and the per-process request throttler ([#2307](https://github.com/pdcarlson/Frapp/issues/2307)). A deploy still overlaps the old and new revision for a short time. During that overlap, the sweeps rely on the multi-replica guards in [`render.md` § 5.6](render.md#56-in-process-scheduled-jobs). The channel cache's 30-second window from #2917 applies too, as it already did during a Render deploy.

## Identities

`scripts/gcp/bootstrap.sh` creates these in each project. None of them has a key.

- **`frapp-api-runtime`** is the identity the API runs as. It can read its own project's Secret Manager values and call Vertex AI in its own project.
- **`frapp-deployer`** is the identity a GitHub Actions deploy acts as. It can manage Cloud Run, push to its project's registry, list secrets, and run revisions as `frapp-api-runtime`. It holds `run.admin` because the deploy also turns off Cloud Run's invoker check, which is what makes the API public. Try narrowing it to `run.developer` once the deploy path works. Production's deployer can also read staging's registry, to copy the image staging ran.
- **GitHub sign-in** goes through the workload identity pool `github`, provider `frapplive-frapp`. It accepts a GitHub token only when all three of these hold:
  - the repository is `frapplive/Frapp`;
  - the owner is the matching owner, checked by numeric id along with the repository, so both survive a rename;
  - the job runs in that project's GitHub environment (`staging` or `production`).

  That keeps staging's deploy out of production. The script refuses to wire a project to the other environment: staging needs "nonprod" or "staging" in the project's name or id, and production needs "prod" without either. [`gcp-bootstrap.test.mjs`](../../../scripts/ci/__tests__/gcp-bootstrap.test.mjs) pins these rules.
- **`infisical-<org id prefix>`** is created only with `--infisical-org-id`. It is the account Infisical Cloud's sync acts as.
  - Infisical signs in as its own `infisical-us@infisical-us.iam.gserviceaccount.com` and impersonates this account.
  - Infisical requires the account's name to end with the first two parts of the Infisical organization id. That is how it keeps one customer from impersonating another customer's account.
  - Infisical's Secret Sync setup asks for Secret Manager Admin, so this account can read, change and delete every secret in its project.
  - It also has Service Usage Viewer, which only shows which Google services are on. Infisical checks that Secret Manager is on before it lists a project for a sync, so without it the sync's project list is empty (found 2026-11-16).

## Secrets

Infisical stays the one place a value changes ([`SECRETS_MANAGEMENT.md`](../../internal/environment/SECRETS_MANAGEMENT.md)). Each environment's GCP Secret Manager sync copies its values into its own project, so the staging service can't read production's.

Cloud Run reads a secret-backed environment variable when an instance starts. So a value reaches the API only on a deploy, the deploy step pins each secret to the version that is current when it deploys. A copy that starts later, such as staging waking up, still uses the pinned version. That keeps the Render rule: change the value in Infisical, then redeploy.

Cloud Run sets `PORT` itself and rejects it as a variable, so the deploy skips that one. The container still listens on 3001, and the service declares that port.

The API reads every value from its environment, as on Render. The read-at-boot path from #2506 is gone: Paul dropped it on 2026-11-16 for a sync, because Infisical's free plan can't stop a boot-time identity from reading every environment ([`SECRETS_MANAGEMENT.md` § Cloud Run API](../../internal/environment/SECRETS_MANAGEMENT.md#cloud-run-api-synced-to-secret-manager)).

**Vertex AI signs in without a key file.** On Cloud Run, `GOOGLE_VERTEX_PROJECT` alone is enough: with `GOOGLE_VERTEX_CREDENTIALS_JSON` unset, the API calls Vertex as `frapp-api-runtime`, which the setup script lets call Vertex AI in its own project (`roles/aiplatform.user`). Anywhere else, boot still refuses the project without a key. Staging's `GOOGLE_VERTEX_PROJECT` is already the nonprod project (checked in Infisical on 2026-11-16), and production's should be the prod project. Keep staging's key file in Infisical until Render stops serving staging, because Render still needs it. Then delete it from Infisical, and delete the key in the nonprod project (**IAM → Service accounts → Keys**).

## Projects

The frapp.live organization (`1033325313086`) holds these, read from the console on 2026-11-16. Billing is upgraded from the free trial, with a $100 monthly budget alert.

| Project | Id | Used for |
| --- | --- | --- |
| nonprod | `cs-project-6vw9f5xp` | Staging API. Also holds staging's Vertex AI. |
| prod | `cs-project-nyit2x59` | Production API. |
| development, central-logging-monitoring | `cs-project-un3otdnn`, `cs-project-cob1stf1` | Created with the organization. Not used by the API. |

## Setup, once per project

Run these in Cloud Shell, signed in as an owner of the frapp.live organization. Do staging first:

```bash
git clone https://github.com/frapplive/Frapp && cd Frapp
bash scripts/gcp/bootstrap.sh staging cs-project-6vw9f5xp
bash scripts/gcp/bootstrap.sh production cs-project-nyit2x59 --staging-project cs-project-6vw9f5xp
```

The script can be run again safely. It refuses a project that has no billing account. A first run can briefly hit "does not exist" while Google catches up on a new account. The script retries that for about a minute, and running it again finishes the job. At the end it prints the project number, region, registry, accounts and identity provider. None of these are secret, and the staging deploy step of #5228 records them in [`.github/environments.json`](../../../.github/environments.json).

**Infisical.** Run the script again with `--infisical-org-id <uuid>`, using the id from Infisical's organization settings. Then, in Infisical, add a GCP connection that uses that account, and add a GCP Secret Manager sync for each environment into its own project.

If Google refuses the grant because the principal "does not belong to a permitted customer", the organization's Domain restricted sharing policy (`iam.allowedPolicyMemberDomains`) is blocking Infisical's account. It did on 2026-11-16. The fix allows Infisical's customer ID `C03rsjmyl` in the two API projects only, on top of what the organization allows (`inheritFromParent`), rather than for the whole organization:

```bash
for p in cs-project-6vw9f5xp cs-project-nyit2x59; do gcloud services enable orgpolicy.googleapis.com --project="$p" && printf 'name: projects/%s/policies/iam.allowedPolicyMemberDomains\nspec:\n  inheritFromParent: true\n  rules:\n  - values:\n      allowedValues:\n      - is:C03rsjmyl\n' "$p" > /tmp/drs.yaml && gcloud org-policies set-policy /tmp/drs.yaml --billing-project="$p"; done
```

The org-policy service has to be on in the project a call is billed to, which Cloud Shell's default project isn't, hence the `services enable` and `--billing-project`. Wait a couple of minutes for the policy to take effect, then run the script again.

**Images.** Each registry keeps its 50 newest images and deletes older ones after 90 days. Deploy production copies a commit's image from staging's registry, so a commit whose image was cleaned up has to be built again before production can take it.

## Observability

Paul asked on 2026-11-16 for full observability from the first day. Sentry (errors, traces) and PostHog (product events) stay as they are ([`spec/behavior/observability.md`](../../../spec/behavior/observability.md)); Google adds the rest, and the privacy rules there still hold (no email, IP, token or body in the API's own logs).

- **API logs.** Cloud Run sends stdout and stderr to Cloud Logging (**Logging → Logs Explorer**, resource *Cloud Run Revision*). The API writes one JSON record per line there, with a `severity`, so a query can filter by level or by a request-log field, for example `jsonPayload.data.statusCode>=500` or `jsonPayload.requestId="req_…"` ([§ Structured Logging](../../../spec/behavior/observability.md#structured-logging)).
- **Google's request log.** Cloud Run also logs every request it serves (`run.googleapis.com/requests`), with status, latency and size. That log holds the caller's IP address, and Google offers no way to drop only that field; Paul was told on 2026-11-16 and it is kept unless he says otherwise.
- **Audit logs.** Every deploy, traffic move and permission change is in the project's audit log (**Logging → Logs Explorer**, log name `cloudaudit.googleapis.com/activity`), on by default.
- **Retention and cost.** Logs stay 30 days in the `_Default` bucket. Ingestion is free up to 50 GiB a month per project, far above the API's volume.

Built with the deploy step, because each needs the service to exist: an uptime check on `/health/ready` every minute, email alerts to Paul for it, for a 5xx spike, for crashes and restarts, for memory near the limit and for an error-log spike, and Secret Manager's data-access audit log, so every secret read is recorded. Email is the pager ([`alert-routing.md`](../alert-routing.md)).

## Not built yet

These land in [#5228](https://github.com/frapplive/Frapp/issues/5228)'s later steps, and each one updates this page when it ships.

- **The deploy path.** It starts a revision with no traffic, checks that the revision's tagged URL reports the deployed commit, then moves traffic and records a GitHub Deployment. Rollback moves traffic back to the previous revision.
- **Cloudflare in front of both API hosts.** This means re-measuring `TRUST_PROXY_HOPS` and reading the client address that Cloudflare forwards.
- **Removing Render.**
