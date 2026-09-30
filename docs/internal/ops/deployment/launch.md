## 8. Step-by-Step Launch Checklist

> **Re-grounded 2026-09-29.** Phases 1 and 2 used to be the first bring-up checklist. They were
> written for Git-linked Vercel and hook-driven Render deploys, and none of their boxes was ever
> ticked, although both environments have run for months. The lists below say what is true now and
> where each fact is checked. The beta's live gate list is epic
> [#2558](https://github.com/pdcarlson/Frapp/issues/2558), not this page.

### In place

- [x] Supabase `frapp-staging` and `frapp-prod`, named in
      [`.github/environments.json`](../../../../.github/environments.json). The deploy workflows
      apply migrations after a dry run; production's are first replayed against its live applied
      state. The org has been on Pro since 2026-09-28
      ([`supabase.md`](supabase.md#plan-and-quotas)).
- [x] Render `frapp-api-staging` and `frapp-api-prod`, deployed by commit from the workflows, with
      auto-deploy off on both ([`README.md` § Current rollout status](README.md#current-rollout-status)).
- [x] Vercel `frapp-web` and `frapp-landing`, disconnected from Git. Both take their config from
      Infisical, not from Vercel's env settings
      ([`vercel.md` § 4](vercel.md#4-vercel-setup)). There is no docs project.
- [x] Staging deploys after CI goes green on every merge to `main` (`deploy-staging.yml`).
- [x] Production deploys by dispatching **Deploy production** with a green `main` SHA
      ([`ci-cd.md`](ci-cd.md)). Each `full` ship mints a `v*` tag, so the newest
      [release](https://github.com/pdcarlson/Frapp/releases) names the last ship.
- [x] **Required reviewers** on the `production` GitHub Environment, the only human gate. Last read
      on 2026-09-02; re-check it with the
      [runbook's Environments steps](../GITHUB_BRANCH_PROTECTION_RUNBOOK.md#verification-checklist).
- [x] In-repo uptime: `.github/workflows/production-uptime.yml` (see
      [`agent-infra.md`](../../../ci-cd/agent-infra.md) § Scheduled conformance). A Sentry 60 s monitor
      is still the finer-grained human path (quota; ask before creating), planned under #2505.
- [x] Stripe live mode: production has checked webhooks against the live endpoint's secret since
      2026-09-15 ([`integrations.md` § 7.2](integrations.md#72-live-mode-production)). Mobile
      production carries no Stripe key, because the beta chapter doesn't collect dues by card
      ([`mobile.md` § 6.3](mobile.md#63-environment-configuration)).

### Still open

- [ ] The first production EAS build ([`mobile.md`](mobile.md),
      [#2526](https://github.com/pdcarlson/Frapp/issues/2526),
      [#938](https://github.com/pdcarlson/Frapp/issues/938)).
- [ ] Retire the staging Render deploy hook
      ([#2679](https://github.com/pdcarlson/Frapp/issues/2679)). Nothing reads a hook since
      #2505. Staging's auto-deploy is already off; what's left is regenerating the hook and deleting
      the copies #2679 lists, so the old URL stops working
      ([`render.md` § 5.7](render.md#57-deploy-hooks-for-github-actions)).

---

## 9. Cost Estimate (Hobby/Starter Tier)

| Service      | Staging             | Production             | Notes                             |
| ------------ | ------------------- | ---------------------- | --------------------------------- |
| **Vercel**   | Free (Preview)      | Free (Hobby, 1 member) | Upgrade to Pro ($20/mo) for team  |
| **Render**   | Free                | $7/mo (Starter)        | Free tier sleeps after inactivity |
| **Supabase** | ~$10/mo (compute)   | $25/mo (Pro plan)      | Org on Pro since 2026-09-28; one project's compute is covered by the plan's credit. [Details](supabase.md#plan-and-quotas) |
| **Stripe**   | Free (test mode)    | 2.9% + $0.30 per txn   | No monthly fee                    |
| **EAS**      | Free (30 builds/mo) | Free                   | Priority builds are $99/mo        |
| **Domain**   | —                   | ~$12/yr                | frapp.live                        |
| **Total**    | ~$10/mo             | ~$32–44/mo             | Before Stripe transaction fees    |

---
