## 8. Step-by-Step Launch Checklist

> **Re-grounded 2026-09-29.** Phases 1 and 2 used to be the first bring-up checklist. They were
> written for Git-linked Vercel and hook-driven Render deploys, and none of their boxes was ever
> ticked, although both environments have run for months. The lists below say what is true now and
> where each fact is checked. The beta's live gate list is epic
> [#2558](https://github.com/pdcarlson/Frapp/issues/2558), not this page.

### In place

- [x] Supabase `frapp-staging` and `frapp-prod`, named in
      [`.github/environments.json`](../../../.github/environments.json). The deploy workflows
      apply migrations after a dry run; production's are first replayed against its live applied
      state. The org has been on Pro since 2026-09-28
      ([`supabase.md`](supabase.md#plan-and-quotas)).
- [x] The API on Cloud Run in each environment's Google Cloud project, behind its own load
      balancer, deployed by commit from the workflows ([`cloud-run.md`](cloud-run.md); it replaced
      Render on 2026-11-17, #5228).
- [x] Vercel `frapp-web` and `frapp-landing`, disconnected from Git. Both take their config from
      Infisical, not from Vercel's env settings
      ([`vercel.md` § 4](vercel.md#4-vercel-setup)). There is no docs project.
- [x] Staging deploys after CI goes green on every merge to `main` (`deploy-staging.yml`).
- [x] Production deploys by dispatching **Deploy production** with a green `main` SHA
      ([`ci-cd.md`](ci-cd.md)). Each `full` ship mints a `v*` tag, so the newest
      [release](https://github.com/pdcarlson/Frapp/releases) names the last ship.
- [x] **Required reviewers** on the `production` GitHub Environment, the only human gate. Last read
      on 2026-09-02; re-check it with the
      [runbook's Environments steps](../github-branch-protection-runbook.md#verification-checklist).
- [x] In-repo uptime: `.github/workflows/production-uptime.yml` (see
      [`agent-infra.md`](../../ci-cd/agent-infra.md) § Scheduled conformance). A Sentry 60 s monitor
      is still the finer-grained human path (quota; ask before creating), planned under #2505.
- [x] Stripe live mode: production has checked webhooks against the live endpoint's secret since
      2026-09-15 ([`integrations.md` § 7.2](integrations.md#72-live-mode-production)). Mobile
      production carries no Stripe key, because the beta chapter doesn't collect dues by card
      ([`mobile.md` § 6.3](mobile.md#63-environment-configuration)).

### Still open

- [ ] The first production EAS build ([`mobile.md`](mobile.md),
      [#2526](https://github.com/pdcarlson/Frapp/issues/2526),
      [#938](https://github.com/pdcarlson/Frapp/issues/938)).
- [ ] Delete the Render leftovers once nothing in the repo reads Render: both services (which
      takes the old staging deploy hook of [#2679](https://github.com/pdcarlson/Frapp/issues/2679)
      with them), the two Infisical Render syncs and the Render App Connection, and the
      `RENDER_API_KEY` GitHub environment secrets.

---

## 9. Cost Estimate (Hobby/Starter Tier)

| Service      | Staging             | Production             | Notes                             |
| ------------ | ------------------- | ---------------------- | --------------------------------- |
| **Vercel**   | Free (Preview)      | Free (Hobby, 1 member) | Upgrade to Pro ($20/mo) for team  |
| **Google Cloud** | Load balancer, plus instance time while awake | Load balancer, plus one always-on instance | Staging sleeps at min 0. Estimates in [#5228](https://github.com/frapplive/Frapp/issues/5228); paid from the Google credit until it runs out |
| **Supabase** | ~$10/mo (compute)   | $25/mo (Pro plan)      | Org on Pro since 2026-09-28; one project's compute is covered by the plan's credit. [Details](supabase.md#plan-and-quotas) |
| **Stripe**   | Free (test mode)    | 2.9% + $0.30 per txn   | No monthly fee                    |
| **EAS**      | Free (30 builds/mo) | Free                   | Priority builds are $99/mo        |
| **Domain**   | —                   | ~$12/yr                | frapp.live                        |
| **Total**    | ~$10/mo plus Google Cloud | ~$25/mo plus Google Cloud | Before Stripe transaction fees    |

---
