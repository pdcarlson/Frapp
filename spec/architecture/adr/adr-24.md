### ADR-24: Delivery platform — one control plane, build once and promote, Cloud Run for the server surfaces (2026-09-23)

**Decision.** Every deployable surface ships through one delivery contract: build an artifact once,
promote that exact artifact from staging to production, verify it before and after it takes traffic,
record what is live, and route every failure to the owner. The API, web and landing move from Render
and Vercel to Google Cloud Run, with one GCP project per environment. The move happens after the
platform-neutral work, not before it. Epic **#2504** tracks the program, one native sub-issue per
phase. This ADR records the decisions and the reasons for them.

**Context.** A research pass on 2026-09-23 read every deploy and observer workflow, 45 days of
Actions runs, and the live Render, Vercel and Sentry state. It found 16 delivery failures that were
missed or found late. The worst was #1273: `frapp-api-prod` never had a successful deploy, which
went unnoticed for 171 days. Five causes recur across surfaces:

1. **Alerts reach no one.** Every watchdog upserts an unassigned issue labelled `routine-state`
   (`scripts/ci/lib/alert-issue.mjs`), and `/next`, issue-triage and `/needs-me` all skip that label.
   #1100 opened 39 seconds after its failure and was read 16 hours later. #919 was acted on after
   34 days.
2. **The pipeline checks triggers, not outcomes.** `deploy-api.yml` goes green once Render accepts
   the deploy hook. #763, #1160 and #2431 were Render build or boot failures behind green workflows.
3. **Monitoring runs on a best-effort scheduler.** `production-uptime.yml` is scheduled `*/15`.
   Over its last 30 scheduled runs (read 2026-09-23) the median gap was 3.1 hours and the maximum
   6 hours.
4. **Dashboard state isn't code.** Render auto-deploy and branch, Vercel env scopes, the
   Infisical→Vercel syncs and the Supabase Auth settings are dashboard-only. Guardrail and
   conformance scripts assert them after the fact, and those scripts are part of about 16,000 lines
   of deploy and ops code (not counting tests).
5. **What gets verified isn't what ships.** CI, Render staging and Render production each build the
   API image, and the web bundles are built three times as well. `scripts/ci/validate-deploy-sha.mjs`
   never looks at staging, so a SHA whose staging deploy failed can reach production.

Judging each incident against the fixes, as an assessment rather than a measurement: a single cloud
with infrastructure-as-code would have prevented 6 of the 16 and helped with 3 more. Routing alerts
to a person, checking deploy outcomes, and monitoring from outside GitHub cron would have caught 12
within an hour. That comparison decides the order below.

**Decisions.** The owner took decisions 1–4 on 2026-09-23. Decisions 5 and 6 follow from them.

| # | Decision | Why |
| --- | --- | --- |
| 1 | The API, web and landing move to **Google Cloud Run**, with separate `staging` and `production` projects plus a shared CI/registry project. The platform-neutral phases (#2505, #2506, #2507) come first. | A tagged revision with no traffic (`--no-traffic --tag`) gives a private URL to verify the new build on before users reach it, which neither Render nor Vercel offered this stack. Promoting one Artifact Registry digest across projects satisfies rule I1. Workload Identity Federation removes the long-lived provider tokens. Moving first would have fixed a minority of the incidents. |
| 2 | Alerts reach the owner through the **Sentry mobile app**, and every alert issue is **assigned to `pdcarlson`**. | Sentry is already the system of record (ADR-22), and it offers the uptime and cron monitors that GitHub cron can't reliably be. Assignment makes an alert a notification, where a bare label never was. Sentry alert rules are dashboard-only (API returns 410, #863), so creating them is an owner step. |
| 3 | **No fixed monthly budget ceiling.** Each phase records its cost. | The research estimated about $50–140/mo on GCP, against about $7–19/mo today. Cost isn't a reason to trade away the checks. |
| 4 | `frapp-prod` **stays on the Supabase free plan** (#1403 closed `not_planned`). | Owner's call. It makes the nightly offsite dump the only recovery path, so the consequences below make that path something to prove, not assume. |
| 5 | Six rules bind every surface: **I1** promote, don't rebuild; **I2** artifacts carry no environment; **I3** every surface serves `/version` and a reconciler compares it with the ledger; **I4** every failure pages within 15 minutes and a skip never reads green; **I5** surfaces release independently within a compatibility contract; **I6** staging and production share no credentials, buckets, quotas, projects or CORS origins. | Each rule answers one of the causes above, and each can be tested. The epic's phases are how the repo gets there. |
| 6 | The deploy ledger is **GitHub Deployments**, one environment per surface and environment. | It is free and native to where the pipeline already runs, and it can be queried. It also doesn't depend on the provider, so the hosting phases can swap hosts underneath it. |

**Rejected alternatives.**

- **Migrate first, then fix detection.** Rejected because detection is the larger lever (see Context).
  A migration without it would reproduce the same silence on GCP, in the middle of a cutover.
- **AWS (ECS Fargate).** App Runner closed to new customers on 2026-04-30. Amplify Hosting supports
  Next.js only up to 15, and OpenNext's AWS adapter is unfinished. Every account also carries a load
  balancer, IPv4 addresses and usually a NAT gateway as fixed cost, estimated at about $90–210/mo
  for two environments, with the most assembly of any option.
- **Stay and fix on Render and Vercel Pro.** This was the cheapest option (about $35–95/mo). Render
  can deploy a prebuilt image by digest, so the API could satisfy I1 there. It was rejected because
  Render has no revision to verify before it takes traffic. Dashboard state would also remain, so
  most of the guardrail and conformance layer would stay, and there would be two providers where
  the owner wants one.
- **API on GCP, web on Vercel.** Keeps two providers' tooling layers and Vercel's per-environment
  build model, for a Next.js hosting benefit this app barely uses: no ISR, no edge runtime, and no
  `@vercel/*` packages.
- **Firebase App Hosting for web.** It builds each backend from its own branch, so there's no
  artifact to promote, and it expects a single app at the repo root.

**Consequences.**

- **The API must be replica-safe before it moves.** The chat push and audit-bridge workers
  subscribe to Realtime in every process, so a second instance sends each push twice. This includes
  the overlap during a deploy and any canary. #2507 moves the `@Cron` sweeps behind
  scheduler-triggered endpoints and runs the subscribers in a leased single worker. That **amends
  ADR-09**, and #2507 makes the amendment. It also sets the cost: the worker needs an always-on
  1 vCPU instance per environment, which is the high end of the GCP range.
- **Environment leaves the build.** Web and landing stop inlining environment-specific
  `NEXT_PUBLIC_*`. `APP_ENV` and `APP_COMMIT_SHA` replace `VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA` and
  `RENDER_GIT_COMMIT`. Off Vercel, the production env-var guards keyed on `VERCEL_ENV` would
  otherwise silently do nothing. This supersedes the build-shape trade-off in ADR-20 decision 3.
- **The lockstep release pin goes.** `production-release-pin.yml` requires every host on one SHA,
  and the ledger plus a compatibility matrix (#2506) replace it. From then on, mixed SHAs across
  surfaces are expected, and the matrix, not identity, decides whether they're allowed.
- **Recovery has to be proven, not assumed (decision 4).** The recovery point for production data
  is up to 24 hours: the nightly dump at 06:30 UTC. Recovery time is unknown until the hosted restore
  drill runs (#1861). Every production migration takes a fresh dump immediately before `db push` and
  fails closed without one (#2506). Production dumps move out of the staging bucket (#1827).
- **Vercel Hobby until #2510.** Vercel's fair-use guidelines limit Hobby to non-commercial use, and
  production web and landing run on Hobby until #2510 moves them. #2505 asks the owner to either
  upgrade to Pro in the meantime or accept that window.
- **DNS leaves Squarespace.** Cloudflare DNS, managed in OpenTofu, is a prerequisite for any cutover
  (#2508).
- **Docs change as the code does, not before.** `spec/environments/README.md` states that
  production is rebuilt, never promoted. That stays true of the code until #2509 and #2510 land, and
  each phase corrects the spec in the same PR as its code. This ADR records the decision, not the
  current state.
- **Other programs.** #1381's open stages, #1383 (alert routing) and #1384 (production parity),
  finish inside #2505, and #1381 closes with them (ADR-20 amendment 2026-09-23). #2351 (Signet
  Release Train) keeps release preflight, store submission and OTA sequencing. #2511 adds only the
  ADR-24 contract on top: a staging app variant, update groups that can be promoted, and ledger and
  crash-rate gates. ADR-21 is retired when #2510 deletes the Vercel projects.

**Trigger to revisit:** #2504 completes or is abandoned; GCP spend for both environments passes
about $200/mo with no plan to bring it down; a production data-loss event or a failed restore drill
(which reopens decision 4); or desktop work starts (#2512 records the shell choice in its own ADR).
