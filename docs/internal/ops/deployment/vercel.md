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
| Staging (web + landing) | `deploy-vercel-staging.yml`, after CI succeeds on `main` | inject Infisical `staging` → `vercel pull --environment=preview` → `vercel build` on each app's own keys → `vercel deploy --prebuilt` → alias the staging hostnames |
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

**No deploy consumes Vercel env vars for app config.** Both workflows inject Infisical (`staging` for
staging since #2672, `prod` for production since [#2673](https://github.com/pdcarlson/Frapp/issues/2673)),
give each app's build exactly the keys it reads, and keep only Vercel's system variables from the
env `vercel pull` writes. The pull still supplies the project settings and `VERCEL_ENV` (`preview`
or `production`).
Production rebuilds a named commit rather than promoting a preview
([`SECRETS_MANAGEMENT.md` § Staging web and landing](../../environment/SECRETS_MANAGEMENT.md#staging-web-and-landing-injected-at-build-not-synced),
which covers both).

**These values are not typed into the Vercel dashboard.** Infisical is the canonical store, and
the deploy jobs read it directly. An ordinary project row doesn't reach a build
([#2810](https://github.com/pdcarlson/Frapp/issues/2810)); the filter reads names, so a row named
like one of Vercel's system variables would, and none should be. The build's log names each row it
kept and each it removed, never a value. Which names count as system variables, and where a
`[SENSITIVE]` placeholder is refused rather than just removed, is the header of
[`scripts/ci/lib/vercel-build-env.mjs`](../../../../scripts/ci/lib/vercel-build-env.mjs). Both
projects' Preview env is empty and their Preview **Branch Tracking** is off (2026-09-28):
the staging syncs, their `Preview · main` rows and the unscoped Preview rows are deleted
([#834](https://github.com/pdcarlson/Frapp/issues/834)). The two production `vercel-*` syncs and their
Production rows were deleted the same day, so neither project holds an env variable in any
environment. The authoritative sync map and
the setup procedure live in
[`SECRETS_MANAGEMENT.md`](../../environment/SECRETS_MANAGEMENT.md), and the complete
variable list in [`ENV_REFERENCE.md`](../../environment/ENV_REFERENCE.md). The tables
below record what each project must end up with, and are what to check a live value against — to
change one, change it in Infisical.

#### `frapp-web` (Web Dashboard)

| Variable                        | Production                       | Staging (Infisical `staging`)       |
| ------------------------------- | -------------------------------- | ----------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | `https://<PROD_REF>.supabase.co` | `https://<STAGING_REF>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `<prod anon key>`                | `<staging anon key>`                |
| `NEXT_PUBLIC_API_URL`           | `https://api.frapp.live`         | `https://api-staging.frapp.live`    |

> ⚠️ **`NEXT_PUBLIC_API_URL` is the bare origin — no `/v1`.** The SDK's generated
> paths already include it, so a value ending in `/v1` yields `/v1/v1/...` and
> 404s every dashboard request. This table previously showed the `/v1` form, so
> **check the value in Infisical `prod` and `staging`** and drop the suffix if it is
> there. It is a build-time inlined variable: changing it requires a redeploy to
> take effect.

#### `frapp-landing` (Marketing Site)

| Variable              | Production               | Staging (Infisical `staging`)    |
| --------------------- | ------------------------ | -------------------------------- |
| `NEXT_PUBLIC_APP_URL` | `https://app.frapp.live` | `https://app.staging.frapp.live` |

### 4.3 Domain Configuration

In each Vercel project → Settings → Domains:

#### Production Domains (connected to Production environment)

| Project         | Domain                          |
| --------------- | ------------------------------- |
| `frapp-web`     | `app.frapp.live`                |
| `frapp-landing` | `frapp.live` + `www.frapp.live` |

`www.frapp.live` serves the landing. `frapp.live` is a redirect domain: Vercel answers it with its
default 307 to `www.frapp.live` and keeps the path (read from the project's domain list,
2026-09-28).

A merge to `main` never moves these hostnames. Only the `--prod` upload re-points them, and only a
Deploy production run with scope `full` that isn't a dry run and gets past the migration apply,
the Render deploy and the health check reaches that upload. A dry run, a `migrations-only` run,
or a run that fails earlier leaves them where they were. The run's `release` job then tags the
shipped commit `vX.Y.Z`. If tagging fails after a live ship, `production-release-pin.mjs` raises
its own alert. Anything merged since the last such run is on the staging hostnames, not here. On 2026-09-28 the
landing reskin had been on `main` for ten days while `www.frapp.live` still served `v1.2.0`, the
2026-09-17 deploy. That was a deploy that hadn't happened yet, not a broken alias.

#### Staging hostnames

CI aliases these after each staging deploy (`deploy-vercel-staging.yml` →
`ensure-vercel-staging-alias.mjs`), pointing each hostname at the deployment id that the deploy
step printed. The workflow fails on an empty id rather than letting the script fall back to its
`githubCommitSha` search, which can exit 0 having aliased nothing. Dashboard Preview + `main`
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

This list is not the whole zone. The zone also holds mail records, and not all of them are written down or have been read back, so a DNS move (#2508) starts from an export of the live zone, not from this list. Known so far:

- **Google Workspace mail:** `frapp.live MX 1 smtp.google.com` (read back 2026-09-24). Business Starter was added that day. `team@frapp.live`, the published support address, is an alias of its one user, `pdcarlson@frapp.live`. Before that, no `@frapp.live` address had a mailbox. Delivery to the new mailbox was still unproven when this was written (#2556). Any Workspace SPF, DKIM or site-verification TXT records at the apex have not been read back.
- **Google Search Console:** a `google-site-verification` TXT record at the apex verifies the Domain property `frapp.live` for the owner's personal Google account, which owns the Cloud project behind Google sign-in. Google's OAuth brand verification needs it: an earlier attempt was flagged "The website of your home page URL https://www.frapp.live is not registered to you" while the property was verified only under `pdcarlson@frapp.live`. **Keep it**, through a DNS move too. *2026-09-28: added in Squarespace DNS by the owner. Search Console then reported "Ownership verified", method "Domain name provider", as the owner reported on [#2758](https://github.com/pdcarlson/Frapp/issues/2758) ([#2669](https://github.com/pdcarlson/Frapp/issues/2669) has the rename session). No agent has read the record back, and its value isn't copied here.*
- **Resend:** the sending domains `mail.frapp.live` and `mail.staging.frapp.live` carry Supabase Auth SMTP (Magic Link sign-in) and invite mail. The older apex `frapp.live` Resend domain also stays until nothing uses it. Those domains and `_dmarc.frapp.live` (`v=DMARC1; p=none;`) are covered in [`supabase.md` § Auth settings](supabase.md#auth-settings-hosted-dashboard-or-management-api). The record names and values are in the Resend dashboard and aren't copied here.

The registration was bought through Google. Google Admin → Billing → Subscriptions lists it as **Domain Registration** (Active, annual plan), and Squarespace's help says Google Workspace manages the billing of a domain it resells. Nobody has yet checked whether Squarespace's own billing view carries a renewal for it too (#2527). `pdcarlson@frapp.live` is the only login to both consoles.

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
