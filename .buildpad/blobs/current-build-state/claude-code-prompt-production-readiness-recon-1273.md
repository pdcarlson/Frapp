Context: #1273 found production has never deployed successfully (0-for-7 deploys) and the `production` branch is months behind `main`. A lot has shipped since that finding — I need an accurate, current picture before we scope the actual push to get it live. This is recon only — verify and report, don't fix anything yet.

1. **How far behind is `production` right now, precisely?** Commit count behind `main`, whether it shares history with `main` at all anymore (can it fast-forward, or does it need a hard reset), and whether it has any unique commits that would be lost in a reset.

2. **Exact migration gap.** How many migrations exist on `main` that have never been promoted to `production`'s database? List them or give an exact count — not an estimate.

3. **What's actually boot-required vs. just missing, in prod's Infisical env.** Re-check Stripe (still empty strings?), PostHog, Sentry, ANALYTICS_HMAC_SALT, and anything else `validateEnv` treats as mandatory. For each: is it required for the API to boot at all, or just for that feature to work? I want to know the minimum set that would let prod boot cleanly, separate from the full "everything working" list.

4. **Cheapest path to a booting prod, for an internal-only chapter beta (not collecting real payments yet).** Specifically: is it safe/reasonable to put test-mode Stripe keys in prod temporarily just to satisfy boot validation, deferring real live Stripe setup until we actually need to charge someone? Any reason that's a bad idea (e.g., does anything in the codebase assume prod always means live-mode Stripe)?

5. **Render/deploy mechanics.** Confirm frapp-api-prod still auto-deploys from `production` on commit (found in an earlier docs sweep). Anything about the free/current Render plan that would make a first real prod deploy risky or likely to fail for reasons unrelated to our own code (build timeouts, resource limits)?

6. **Anything else that would block or complicate a first real deploy** that we haven't already named — check for it rather than assuming the known list is complete.

Report back plainly: the exact current gap, the minimum-viable path to a booting prod for an internal beta, and what can be deferred vs. what's a hard requirement. Don't propose a build plan yet — just get me accurate ground truth.