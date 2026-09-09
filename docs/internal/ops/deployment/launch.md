## 8. Step-by-Step Launch Checklist

### Phase 1: Staging (do this first)

> ⚠️ **2026-09-02:** Phase 1's Vercel steps describe the retired push-deploy model — both
> projects are unlinked from Git (ADR-21), so no push deploys staging web or landing. See the dated
> note at the top of [Vercel Setup](vercel.md).

- [ ] Create Supabase staging project, apply migrations
- [ ] Create Render staging service (`main` branch), add env vars
- [ ] Import repo to Vercel 3 times (web, landing, docs)
- [ ] Add Preview env vars to each Vercel project
- [ ] Assign staging domains to `main` branch in Vercel
- [ ] Configure DNS records for staging subdomains
- [ ] Set up Stripe test mode webhook for staging API URL
- [ ] Push to `main` → verify all staging sites deploy
- [ ] Test mobile with Expo Go pointing at staging API
- [ ] Run through core flows: sign up, create chapter, invite member

### Phase 2: Production

- [ ] Create Supabase production project, apply migrations
- [ ] Create Render production service (`main` branch, **Auto-Deploy: No**), add env vars
- [ ] Add Production env vars to each Vercel project
- [ ] Assign production domains in Vercel
- [ ] Configure DNS records for production domains
- [ ] Set up Stripe live mode (after business verification)
- [ ] Enable **Required reviewers** on the `production` GitHub Environment
- [ ] Run **Deploy production** with a green `main` SHA (start with *Stop after the dry run*)
- [ ] Verify all production sites deploy
- [ ] Set up Sentry for error tracking (API + web)
- [ ] Build production mobile app with EAS

### Phase 3: Ongoing

- [ ] Store Render deploy hook URLs as GitHub secrets
- [ ] Verify CI workflow runs on PRs
- [x] In-repo uptime: `.github/workflows/production-uptime.yml` (see [`AGENT_INFRA.md`](../../ci-cd/AGENT_INFRA.md) § Scheduled conformance). A Sentry 60s monitor is still the finer-grained human path (quota; ask before creating). GitHub cron starts after this file is on `main`

---

## 9. Cost Estimate (Hobby/Starter Tier)

| Service      | Staging             | Production             | Notes                             |
| ------------ | ------------------- | ---------------------- | --------------------------------- |
| **Vercel**   | Free (Preview)      | Free (Hobby, 1 member) | Upgrade to Pro ($20/mo) for team  |
| **Render**   | Free                | $7/mo (Starter)        | Free tier sleeps after inactivity |
| **Supabase** | Free                | Free                   | 2 free projects; Pro is $25/mo    |
| **Stripe**   | Free (test mode)    | 2.9% + $0.30 per txn   | No monthly fee                    |
| **EAS**      | Free (30 builds/mo) | Free                   | Priority builds are $99/mo        |
| **Domain**   | —                   | ~$12/yr                | frapp.live                        |
| **Total**    | ~$0/mo              | ~$7–19/mo              | Before Stripe transaction fees    |

---
