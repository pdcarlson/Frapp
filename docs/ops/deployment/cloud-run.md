# Cloud Run (API)

The API is moving from Render to Google Cloud Run ([#5228](https://github.com/frapplive/Frapp/issues/5228)), by Paul's decision of 2026-11-16, which changes [ADR-24](../../../spec/architecture/adr/adr-24.md) decision 1. This page is the runbook for the Google side. Until the cutover finishes, [`render.md`](render.md) still describes what serves traffic.

**State (2026-11-16):** the setup script exists; no project has run it yet. Nothing on Google serves traffic.

## Shape

| Piece | Staging | Production |
| --- | --- | --- |
| Google Cloud project (frapp.live organization) | `nonprod` | `prod` |
| Region | `us-east5` (Columbus) | `us-east5` (Columbus) |
| Cloud Run service | `frapp-api`, 1 vCPU, 1 GiB | `frapp-api`, 1 vCPU, 1 GiB |
| Billing | instance-based, min 0 instances (sleeps when idle) | instance-based, min 1, max 1 |
| Image | built once on GitHub, pushed to `us-east5-docker.pkg.dev/<nonprod>/frapp/api` | the same digest, copied to `us-east5-docker.pkg.dev/<prod>/frapp/api` |
| Secrets | Infisical `staging` synced to this project's Secret Manager | Infisical `prod` synced to this project's Secret Manager |
| Address | the staging API host through Cloudflare | `api.frapp.live` through Cloudflare |

**Why Columbus.** Supabase runs both projects in AWS `us-east-2` (Ohio), and the API makes several database calls per request. `us-east5` is the one Google region in the same metro, as Render's Ohio region was.

**Why instance-based billing, and why one copy in production.** The API is more than a request handler. It runs every `@ReportedCron` sweep ([`render.md` § 5.6](render.md#56-in-process-scheduled-jobs)) and holds the chat push and bridge workers' Supabase Realtime subscriptions. Request-based billing throttles the CPU between requests, which would stall both. Production stays at one copy until the push worker's channel cache (#2917) and the per-process request throttler (#2307) are safe across copies. During a deploy, old and new revisions overlap briefly, which the sweeps' claims already handle ([`render.md` § 5.6](render.md#56-in-process-scheduled-jobs)).

## Identities

`scripts/gcp/bootstrap.sh` creates these in each project. None of them has a key.

- **`frapp-api-runtime`** is what the API runs as. It can read this project's Secret Manager values and call Vertex AI, so the API needs no key file for either.
- **`frapp-deployer`** is what a GitHub Actions deploy acts as. It can manage Cloud Run, push to this project's registry, list secrets, and run revisions as `frapp-api-runtime`. Production's deployer can also read staging's registry, which it needs to copy the image staging ran.
- **`infisical-sync`** is what Infisical's Secret Manager sync acts as. It can create and update this project's secrets.
- **GitHub sign-in** goes through the workload identity pool `github`, provider `frapplive-frapp`. The provider accepts a GitHub token only from `frapplive/Frapp` (matched by repository and owner id, which survive a rename) and only from a job running in that project's GitHub environment (`staging` or `production`). Staging's deploy can't act in production.

## Secrets

Infisical stays the one place a value changes ([`SECRETS_MANAGEMENT.md`](../../internal/environment/SECRETS_MANAGEMENT.md)). Each environment's Secret Manager sync copies its values into its own project, so staging's service can't read production's. Cloud Run receives each value as an environment variable when a revision starts, so a changed value reaches the API on the next deploy, as it did on Render.

Cloud Run sets `PORT` itself and rejects it as a user variable, so the deploy skips that one. The container still listens on 3001, and the service declares that port.

## Setup, once per project

Run in Cloud Shell, signed in as an owner of the frapp.live organization, staging first:

```bash
git clone https://github.com/frapplive/Frapp && cd Frapp
bash scripts/gcp/bootstrap.sh staging <nonprod-project-id>
bash scripts/gcp/bootstrap.sh production <prod-project-id> --staging-project <nonprod-project-id>
```

The script can be run again safely. It refuses a project that has no billing account. It ends by printing the project number, registry, service accounts and identity provider. None of these are secret. The staging deploy step of #5228 records them in [`.github/environments.json`](../../../.github/environments.json).

To let Infisical's sync act as `infisical-sync`, run the script again with `--infisical-principal <email>`, using the service account Infisical shows when you add its Google connection.

## Not built yet

These land in [#5228](https://github.com/frapplive/Frapp/issues/5228)'s later steps. Each step updates this page when it ships.

- The deploy path. It starts a revision with no traffic, checks that the revision's tagged URL reports the deployed commit, moves traffic, and records a GitHub Deployment. Rollback moves traffic back to the previous revision.
- Cloudflare in front of both API hosts, which means re-measuring `TRUST_PROXY_HOPS` and reading the client address that Cloudflare forwards.
- Removing Render.
