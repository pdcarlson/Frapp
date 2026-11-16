# Cloud Run (API)

The API is moving from Render to Google Cloud Run ([#5228](https://github.com/frapplive/Frapp/issues/5228)). Paul decided this on 2026-11-16, which changes [ADR-24](../../../spec/architecture/adr/adr-24.md) decision 1. This page is the runbook for the Google side. Until the cutover finishes, [`render.md`](render.md) still describes what serves traffic.

**State (2026-11-16):** the setup script exists, but no project has run it yet. Nothing on Google serves traffic.

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

- **`frapp-api-runtime`** is the identity the API runs as. It can read its own project's Secret Manager values.
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

## Secrets

Infisical stays the one place a value changes ([`SECRETS_MANAGEMENT.md`](../../internal/environment/SECRETS_MANAGEMENT.md)). Each environment's GCP Secret Manager sync copies its values into its own project, so the staging service can't read production's.

Cloud Run reads a secret-backed environment variable when an instance starts. So a value reaches the API only on a deploy, the deploy step pins each secret to the version that is current when it deploys. A copy that starts later, such as staging waking up, still uses the pinned version. That keeps the Render rule: change the value in Infisical, then redeploy.

Cloud Run sets `PORT` itself and rejects it as a variable, so the deploy skips that one. The container still listens on 3001, and the service declares that port.

These two still have to change in the next step of #5228:

- The read-at-boot path from #2506 (`apps/api/src/boot.ts`, [`SECRETS_MANAGEMENT.md` § Image-backed API](../../internal/environment/SECRETS_MANAGEMENT.md#image-backed-api-read-at-boot-not-synced)). Paul dropped it on 2026-11-16 in favour of a sync, because Infisical's free plan can't stop a boot-time identity from reading every environment. The next step removes that path and updates `SECRETS_MANAGEMENT.md` to match.
- Vertex AI. The API still signs in with the `GOOGLE_VERTEX_CREDENTIALS_JSON` key file, against the separate `frapp-ai-*` projects ([`ENV_REFERENCE.md`](../../internal/environment/ENV_REFERENCE.md)). Keep that key until the API can use its runtime identity: the next step adds Application Default Credentials, and `frapp-api-runtime` gets `roles/aiplatform.user` on the matching `frapp-ai-*` project.

## Setup, once per project

Run these in Cloud Shell, signed in as an owner of the frapp.live organization. Do staging first:

```bash
git clone https://github.com/frapplive/Frapp && cd Frapp
bash scripts/gcp/bootstrap.sh staging <nonprod-project-id>
bash scripts/gcp/bootstrap.sh production <prod-project-id> --staging-project <nonprod-project-id>
```

The script can be run again safely. It refuses a project that has no billing account. A first run can briefly hit "does not exist" while Google catches up on a new account. The script retries that for about a minute, and running it again finishes the job. At the end it prints the project number, region, registry, accounts and identity provider. None of these are secret, and the staging deploy step of #5228 records them in [`.github/environments.json`](../../../.github/environments.json).

**Infisical.** Run the script again with `--infisical-org-id <uuid>`, using the id from Infisical's organization settings. Then, in Infisical, add a GCP connection that uses that account, and add a GCP Secret Manager sync for each environment into its own project.

If Google refuses the grant because the principal "does not belong to a permitted customer", the organization's Domain restricted sharing policy (`iam.allowedPolicyMemberDomains`) is blocking Infisical's account. To fix it:

1. Add Infisical's customer ID `C03rsjmyl` under that policy's custom values.
2. Run the script again.

**Images.** Each registry keeps its 50 newest images and deletes older ones after 90 days. Deploy production copies a commit's image from staging's registry, so a commit whose image was cleaned up has to be built again before production can take it.

## Not built yet

These land in [#5228](https://github.com/frapplive/Frapp/issues/5228)'s later steps, and each one updates this page when it ships.

- **The deploy path.** It starts a revision with no traffic, checks that the revision's tagged URL reports the deployed commit, then moves traffic and records a GitHub Deployment. Rollback moves traffic back to the previous revision.
- **Cloudflare in front of both API hosts.** This means re-measuring `TRUST_PROXY_HOPS` and reading the client address that Cloudflare forwards.
- **Removing Render.**
