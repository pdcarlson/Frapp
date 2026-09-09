## 4. Vercel Setup

Two projects: `frapp-web` (`apps/web`) and `frapp-landing` (`apps/landing`). Both are
**disconnected from Git** ([ADR-21](../../../../spec/architecture/adr/adr-21.md)). Do not re-import
the repo or set a Production Branch — a present Git link is a guardrail violation
(`assertVercelNoGitLink` in `scripts/ci/production-guardrails.mjs`). The decision, dates, freeze
points, and what broke on unlink live on ADR-21; this section is the operator console.

**How deploys work.** Both channels build on a GitHub Actions runner and upload the result;
neither asks Vercel to fetch a commit.

| Channel | Workflow | Path |
| --- | --- | --- |
| Staging (web + landing) | `deploy-vercel-staging.yml`, after CI succeeds on `main` | `vercel pull --environment=preview` → `vercel build` → `vercel deploy --prebuilt` → alias the staging hostnames |
| Production (web + landing) | `deploy-production.yml`, on a dispatched SHA | `vercel pull --environment=production` → `vercel build --prod` → `vercel deploy --prebuilt --prod` |

**Uploads are one archive per deploy, not one request per file (`--archive=tgz`, since
2026-09-06).** The team is on Vercel's free plan, whose upload API allows **5000 requests per 24
hours** (`code: "api-upload-free"`). A per-file prebuilt Next.js upload is thousands of requests —
every traced `node_modules` file under `functions/*.func` — and six merges to `main` on 2026-09-06
exhausted the budget: staging run 34062542629 failed with `Too many requests - try again in 24
hours`, and the same failure on the production path lands in the upload step, after the apply and
the Render deploy. With `--archive=tgz` the CLI tars `.vercel/output` and uploads a handful of
parts, so the cap stops mattering. If the cap is ever hit anyway, the deploy fails closed (nothing
partial is aliased) and clears on its own 24 hours after the first counted upload — or sooner on a
paid plan, which is the owner's call, not a workflow's.

Both run [`scripts/ci/deploy-vercel.mjs`](../../../../scripts/ci/deploy-vercel.mjs).

### 4.2 Environment Variables per Project

Vercel scopes env vars to **Production** and **Preview**. Staging deploys consume Preview vars
(`vercel pull --environment=preview` in `deploy-vercel-staging.yml`). Production deploys consume
Production vars (`vercel pull --environment=production` in `deploy-production.yml`) — the
workflow rebuilds a named commit rather than promoting a preview. Unlinking did not delete those
scopes or their Infisical syncs; `vercel pull` inlines whatever the matching scope currently holds.

**These values are not typed into the Vercel dashboard.** Infisical is the canonical store and its
syncs push the values into each project's Production and Preview scopes (the four `vercel-*` syncs); the
dashboard is the destination, not the place a human enters anything. The authoritative sync map and
the setup procedure live in
[`SECRETS_MANAGEMENT.md`](../../environment/SECRETS_MANAGEMENT.md), and the complete
variable list in [`ENV_REFERENCE.md`](../../environment/ENV_REFERENCE.md). The tables
below record what each project must end up with, and are what to check a live value against — to
change one, change it in Infisical.

#### `frapp-web` (Web Dashboard)

| Variable                        | Production                       | Preview (Staging)                   |
| ------------------------------- | -------------------------------- | ----------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | `https://<PROD_REF>.supabase.co` | `https://<STAGING_REF>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `<prod anon key>`                | `<staging anon key>`                |
| `NEXT_PUBLIC_API_URL`           | `https://api.frapp.live`         | `https://api-staging.frapp.live`    |

> ⚠️ **`NEXT_PUBLIC_API_URL` is the bare origin — no `/v1`.** The SDK's generated
> paths already include it, so a value ending in `/v1` yields `/v1/v1/...` and
> 404s every dashboard request. This table previously showed the `/v1` form, so
> **check the value currently set in Vercel for both environments** and drop the
> suffix if it is there. It is a build-time inlined variable: changing it
> requires a redeploy to take effect.

#### `frapp-landing` (Marketing Site)

| Variable              | Production               | Preview (Staging)                |
| --------------------- | ------------------------ | -------------------------------- |
| `NEXT_PUBLIC_APP_URL` | `https://app.frapp.live` | `https://app.staging.frapp.live` |

### 4.3 Domain Configuration

In each Vercel project → Settings → Domains:

#### Production Domains (connected to Production environment)

| Project         | Domain                          |
| --------------- | ------------------------------- |
| `frapp-web`     | `app.frapp.live`                |
| `frapp-landing` | `frapp.live` + `www.frapp.live` |

#### Staging hostnames

CI aliases these after each staging deploy (`deploy-vercel-staging.yml` →
`ensure-vercel-staging-alias.mjs`, lookup by `githubCommitSha`). Dashboard Preview + `main`
branch filters are leftover from the Git integration and do not attach hostnames any more.

| Project         | Domain                   |
| --------------- | ------------------------ |
| `frapp-web`     | `app.staging.frapp.live` |
| `frapp-landing` | `staging.frapp.live`     |

Manual recovery: `vercel alias set <deployment-url> app.staging.frapp.live` (same idea as the API).

### 4.4 DNS Records (Squarespace Domains)

In Squarespace Domains → `frapp.live` → DNS Settings → Custom Records:

```
# Production
frapp.live          A      76.76.21.21
www.frapp.live      CNAME  cname.vercel-dns.com
app.frapp.live      CNAME  cname.vercel-dns.com

# Staging
staging.frapp.live       CNAME  cname.vercel-dns.com
app.staging.frapp.live   CNAME  cname.vercel-dns.com

# API (Render — fill in after creating Render services)
api.frapp.live           CNAME  <frapp-api-prod>.onrender.com
api-staging.frapp.live   CNAME  <frapp-api-staging>.onrender.com
```

### Retired: `frapp-docs` and docs.frapp.live

The monorepo **no longer contains** `apps/docs`. Developer documentation is markdown under `docs/guides/` in GitHub.

**Operator checklist (outside git):**

1. **Vercel** — Pause or delete the `frapp-docs` project (builds would fail: missing `apps/docs`).
2. **DNS** — Remove or repoint `docs.frapp.live` and `docs.staging.frapp.live` if they still CNAME to Vercel.
3. **Infisical** — Remove any integration row that synced only to `frapp-docs`, if still present.

A future public documentation site is possible post-launch; treat as a separate initiative.

### 4.5 `vercel.json` pins (do not delete)

While unlinked, `git.deploymentEnabled` and `ignoreCommand: "exit 1"` in `apps/web/vercel.json` and
`apps/landing/vercel.json` govern nothing — `--prebuilt` has already built. **Do not delete either
key.** They are the versioned form of dashboard-only settings: re-link Git and branch filtering plus
the Ignored Build Step fall back to unversioned dashboard state. See
[ADR-21](../../../../spec/architecture/adr/adr-21.md).

Confirm the unlink (not a setup step): a present `link` is the guardrail going red.

```bash
curl -s -H "Authorization: Bearer $VERCEL_API_KEY" \
  "https://api.vercel.com/v10/projects/<project-id>" \
  | jq '{name, link, productionBranch: .link.productionBranch, targets: .targets}'
```

`link` should be `null`.

---
