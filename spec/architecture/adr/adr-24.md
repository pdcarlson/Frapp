### ADR-24: Delivery platform — outcome-verified delivery on the current hosts; Cloud Run only on triggers (2026-09-23)

**Decision.** Every deployable surface ships through one delivery contract: build once, promote what
staging verified, check the outcome of every deploy, record what is live, and page the owner on
failure. Signet stays on Render (API) and Vercel (web, landing) through the v1.0 GA release. Google
Cloud Run is the destination if the hosting ever moves, in the "stateless" shape only, and only when
measured triggers fire. The owner took the decisions below on 2026-09-23, in two rounds. The first
round chose Cloud Run immediately. The owner then asked for a slower rethink, because the cost was
hard to justify at current scale, and the second round replaced that choice. This record keeps both,
because the reasons for the reversal are the part a later reader would otherwise re-argue.

Work is tracked in the v1.0 GA umbrella epic **#2523**, and delivery specifically in **#2504**. The
trigger-gated hosting move is **#2524**. The evidence is twelve research digests posted as comments
on #2504 (numbered 01–12 and cited below as "digest NN").

**Context.** A research pass read every deploy and observer workflow, 45 days of Actions runs, and
the live Render, Vercel, Sentry and Supabase state. It found **16 delivery failures** that were
missed or found late (digest 02). The worst: `frapp-api-prod` went from March to August 2026 without
a successful deploy, and nothing noticed for 171 days (#1273). Five causes recur across surfaces:

1. **Alerts reach no one.** Every watchdog upserts an issue labelled `routine-state` with no
   assignee (`scripts/ci/lib/alert-issue.mjs`), and `/next`, issue-triage and `/needs-me` all skip
   that label. #1100 opened 39 seconds after its failure and was read 16 hours later. In #763, the
   staging deploy path failed 44 of 44 runs over 71 days while runs that skipped every job read green.
2. **The pipeline checks triggers, not outcomes.** `deploy-api.yml` fires Render's staging deploy
   hook, sleeps 15 seconds, then polls `/health/ready`. That poll can answer from the instance that
   was already live, and nothing compares the running commit with the deployed SHA. When
   `API_HEALTHCHECK_URL` is unset, the poll warns and exits 0. #1160 and #2431 were Render build or
   boot failures behind a green workflow.
3. **Monitoring runs on a best-effort scheduler.** `production-uptime.yml` is scheduled `*/15`.
   Its last 30 scheduled runs had a median gap of 3.1 hours and a maximum of 6 hours. (GitHub MCP
   `actions_list list_workflow_runs`, `production-uptime.yml`, `event: schedule`, read 2026-09-23.)
4. **Dashboard state isn't code.** Render auto-deploy and branch, Vercel env scopes, the
   Infisical→Vercel syncs and the Supabase Auth settings are dashboard-only. They are checked after
   the fact by `production-guardrails.mjs`, `staging-conformance.mjs` and
   `production-auth-conformance.mjs`. At `be19721` those are 414, 1,445 and 356 lines (`wc -l`). The
   deploy and ops layer as a whole is about 16,000 lines before tests: `scripts/ci` has 12,926
   non-test `.mjs` lines, plus deploy workflow YAML and composite actions (digest 01).
5. **What gets verified isn't what ships.** CI, Render staging and Render production each build
   the API image, and the web bundles are built three times as well. `validate-deploy-sha.mjs` never
   looks at staging, so a SHA whose staging deploy failed can reach production.

Judged incident by incident (an assessment, not a measurement, digest 02), a single cloud with
infrastructure-as-code would have prevented 6 of the 16 and helped with 3 more. Routing alerts to a
person, checking deploy outcomes and monitoring from outside GitHub cron would have caught 12 within
an hour. Production on 2026-09-23 held 2 chapters, 2 users and 11 chat messages (Supabase MCP,
digest 07).

**Decisions.**

| # | Decision | Why |
| --- | --- | --- |
| 1 | **Stay on Render + Vercel through v1 GA.** CI builds the API image once and deploys it to Render by digest; staging proves first whether an image-backed Render service needs new services. Cloud Run is the destination only in the stateless shape and only on #2524's triggers. Lift-and-shift (an always-on monolith on Cloud Run) is dropped. *Round one chose Cloud Run now; replaced the same day.* | Hosting cost never favours GCP enough to justify a move now (digest 09). Stateless Cloud Run beats Render + Vercel at beta scale only with a $0 front door, breaks even at v1 and loses at growth. Lift-and-shift never wins and still can't run two instances. The costs that grow with users (Supabase, Sentry, EAS) are the same on every host. GCP's real value is delivery control: verifying a revision before it takes traffic, promoting one digest, keyless auth. That is worth buying when failures show the current hosts can't give it, not before. |
| 2 | **The pager is Sentry → a private Discord channel** with phone notifications, **email** as the second path, and every alert issue **assigned to the owner** and labelled `incident` instead of `routine-state`. Agents triage and report on incident issues but don't change provider state from them. A test firing before the beta proves the path. *Round one chose "the Sentry mobile app"; replaced.* | No current first-party Sentry phone app was found (digest 10). Round one recommended it without checking. Discord is already in the product's world. Assignment turns an alert into a notification, where a bare label never was. The agent rule guards against an alert's suggested fix being wrong, as #1564's was. |
| 3 | **Paid plans are staged by milestone.** Sentry Team at the start of the beta (about $41–45/mo with monitors). Vercel Pro before any paid invoice or public `/pricing`. Supabase Pro at the second-chapter gate. There's no fixed ceiling otherwise, and each phase records its cost. | The free Sentry plan allows 1 uptime and 1 cron monitor, which can't cover rule I4 (digest 10). Vercel Hobby is non-commercial. Supabase Free is the first scaling ceiling: 1 GB storage with a 50 MB per-file cap, 200 Realtime connections, no backups, and pausing after 7 days idle (digest 07). |
| 4 | **Supabase stays on Free through the owner-only beta; Pro at the second-chapter gate** (#1403, reopened). Until then, recovery has to be proven: a hosted restore drill (#1861), a separate production backup bucket (#1827), and, once #2506 lands, a fresh dump before every production migration. *Round one said "Free, no Pro"; revised.* | On Free the only recovery path is the nightly dump (06:30 UTC), so up to 24 hours of data can be lost. How long a restore takes is unknown until the drill runs. The drill also has to work around Free's limit of two active projects, and staging and production use both. |
| 5 | **Versions go back to 0.x until v1 GA** (#2529). The existing tags are renumbered onto the same commits: `v1.0.0`–`v1.2.0` become `v0.2.0`–`v0.4.0`, and the new tags are created before the old ones are deleted. Label-driven bumps are capped at minor while on 0.x. The mobile beta ships as 0.9.x. `v1.0.0` is dispatched by hand when #2523's definition holds. | Nothing is a stable v1, and releases were broken (11 of 16 production deploy runs failed after 2026-08-29, digest 02). Without the cap, `resolve-release-bump.mjs` would turn a `release:major` label on 0.x into 1.0.0. No App Store version has been approved yet, so 0.9.0 is still legal (digest 11). |
| 6 | **Six rules bind every surface.** **I1** promote, don't rebuild (exception: web and landing keep per-environment builds until runtime config lands with #2528). **I2** artifacts carry no environment. **I3** every surface serves `/version`, and a reconciler compares it with the ledger. **I4** every failure pages within 15 minutes, and a skip never reads green. **I5** surfaces release independently within a compatibility contract. **I6** staging and production share no credentials, buckets, quotas or CORS origins. | Each rule answers one of the causes above and can be tested. |
| 7 | **The deploy ledger is GitHub Deployments**, one environment per surface and environment. The reconciler runs after each deploy and on a schedule, with its own Sentry cron monitor. | It's free, native to where the pipeline runs, can be queried, and doesn't depend on the provider, so a later host move swaps what's underneath without touching it. |
| 8 | **Sequence by the product timeline.** The windows are: before the beta binary ships; the beta, with only the owner's chapter; the second-chapter gate (#2525); v1 GA; after v1. The beta binary's one-way doors (#2526) come first: `expo-updates` installed dormant, a minimum-version check, the Supabase publishable key, blocking API-contract checks, and frozen permanent names (`api.frapp.live`, the `frapp://` routes). | Every beta install stays as shipped until it is updated from the store. Anything missing from the first binary can't be fixed over the air, and old binaries can't be forced to upgrade (digest 06). |

**Rejected alternatives.**

- **Move to Cloud Run first, then fix detection.** Detection is the larger lever (Context), and a
  migration without it would reproduce the same silence mid-cutover. This was round one's ordering.
- **Cloud Run lift-and-shift** (an always-on 1 vCPU API per environment): about $100/mo of fixed
  spend at beta, and it can't run two instances (digest 09). Round one's $50–140/mo estimate was
  this shape's range.
- **Cloud Run stateless, now.** It is the destination, not rejected, but deferred. It needs the
  stateless refactor (#2528) and a $0 front door first, and it doesn't pay on cost at beta or v1
  scale.
- **AWS (ECS Fargate).** App Runner closed to new customers on 2026-04-30, and Amplify supports
  Next.js only up to 15. Every account also carries a load balancer, IPv4 addresses and usually a
  NAT gateway as fixed cost: about $90–210/mo for two environments (digest 04).
- **Firebase Hosting in front of the web dashboard.** It strips every cookie except `__session`,
  and the dashboard authenticates with `@supabase/ssr` cookies (digest 09).
- **Full-stack per-PR preview environments.** Supabase branching needs Pro and bills per branch
  hour. The cloud sandbox already gives each agent session a full local stack (digest 05).
- **A hosted third "dev" environment.** About $45/mo. Instead, local dev matches production
  through version pins, config parity, a synthetic seed and integration tests in CI (digest 12).
- **Kubernetes / GKE, and Argo CD.** Resume value only at this scale (digests 07, 08).

**Consequences.**

- **Render can't verify a revision before it takes traffic.** The mitigations are a staging soak,
  the promotion gate and rollback by digest. A repeat of bad revisions reaching users is one of
  #2524's triggers.
- **Staging's deploy path changes in two steps.**
  - **First (#2505).** Render auto-deploy goes off. `deploy-api.yml` deploys the CI-verified commit
    through the Render API after `migrate-staging` and polls that deploy, as production already
    does. That fixes the tip build, the double build and the migrations-first ordering that
    `spec/environments/README.md` § Deploy Ordering requires.
  - **Then (#2506).** Staging and production both switch to deploying the CI-built image by
    digest (decision 1). The commit-based path is the interim step.
- **The API isn't replica-safe yet.** The push and audit-bridge Realtime subscribers double-send
  with two instances, and deploys already overlap briefly. The `@Cron` sweeps are safe, because
  their dispatch-claim rows prevent duplicates (`docs/internal/ops/deployment/render.md` §5.6). The
  cheap fixes land during the beta (#2507): push idempotency keys, a unique key on bridged audit
  messages, a cap on the push worker's presence channels (which today fail silently at about 98), and
  a fan-out latency span that makes ADR-09's watermark measurable. The full stateless refactor, with
  scheduler-triggered sweeps, enqueued push and runtime web config, waits for #2524. It will amend
  ADR-08, ADR-09 and ADR-10 when it lands.
- **Moving hosts later means re-measuring proxy hops.** `TRUST_PROXY_HOPS = 3` in
  `apps/api/src/bootstrap.ts` was measured for Render's proxy chain, so any new ingress (Cloud Run, a
  Cloudflare proxy) must re-measure it. The in-memory throttler and auth-failure counters divide by
  the number of instances.
- **The lockstep release pin goes** (#2506). The ledger and a compatibility matrix replace
  `production-release-pin.yml`, so mixed SHAs across surfaces become normal.
- **Secrets are separated per environment.** Production secrets are readable from any same-repo PR
  branch today (#2518). The minimal fix lands before the beta, and the full split (two Infisical
  projects plus OIDC) before a second chapter.
- **Supabase's legacy keys** are promised only until the end of 2026. The beta binary ships the
  publishable key (#2526), and web and the API move before 2026-12-31 (#2532).
- **Docs change with the code, not before.** `spec/environments/README.md` describes the current
  pipeline. Each phase corrects it in the same PR as its code.
- **Other programs.** #1381 closes when #1383 and #1384 do; their open items are finished inside
  #2505 (ADR-20, amendment of 2026-09-23). #2351 is dissolved into #2526, #2511 and #2478. ADR-21 stands until #2510 retires Vercel, if it ever does.

**Trigger to revisit:**
- the v1.0 GA checkpoint, which reviews #2524's triggers;
- any Supabase Free quota above 70% (#2531), a production data-loss event or a failed restore
  drill;
- the pager test firing not arriving;
- desktop work starting (#2512 records the shell choice in its own ADR).
