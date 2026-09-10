### ADR-13: Repository visibility — public → private on GitHub Pro (2026-05-31)

**Decision:** The `pdcarlson/Frapp` repository moved from **public** to **private**, on a **GitHub Pro** plan. Frapp is a commercial multi-tenant SaaS; the source, the issue backlog/roadmap, and implementation details are no longer publicly visible.

**Rationale:** Protect proprietary source (multi-tenant RLS model, Stripe billing, business logic); stop publicly exposing the roadmap (the issue backlog mirrored to GitHub was world-readable); reduce the source-disclosure attack surface. The project is effectively solo (one human collaborator + AI agents), so the open-source/community upside given up is negligible.

**Consequences:**

- **Branch protection and repository-level Actions secrets are unaffected** — both are available on private repos with Pro. The deploy pipeline resolves runtime secrets from Infisical at workflow time and uses only repo-level bootstrap secrets, so it keeps working.
- **The `production` environment's manual-approval pause is gone.** Required-reviewer **environment** protection rules are GitHub **Enterprise-only** on private repos. On Pro+private the `migrate-production` / `deploy-production` jobs no longer pause; the human gate is now solely the `main` → `production` promotion PR (branch protection: CI + an approving review + conversation resolution). Acceptable while solo. Docs updated: `deploy-api.yml`, `docs/internal/ops/deployment/`, `docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md`, `docs/internal/ci-cd/AGENT_INFRA.md`, `spec/environments/README.md`.
  - **Correction (2026-08-28), recorded rather than rewritten — this consequence did not hold.** The pause is not gone. `migrate-production` was measured waiting **29m52s** to start on run [33184010470](https://github.com/pdcarlson/Frapp/actions/runs/33184010470) while unscoped and `staging`-scoped jobs in the same runs started in about two seconds; two `workflow_dispatch` runs waited 15m19s and 3m13s. Both premises this bullet rested on had already failed — the repo's visibility was corrected to **public** on 2026-08-21, so the private-repo exemption never applied. Canonical statement, evidence table, and the limits of that evidence: [`docs/internal/ci-cd/AGENT_INFRA.md`](../../../docs/internal/ci-cd/AGENT_INFRA.md) § GitHub environments and bootstrap secrets. The decision below stands as taken; only this stated consequence was wrong.
- **GitHub Actions minutes are now metered** (public repos are unlimited; private on Pro includes 3,000 min/month, then per-minute overage). The CI suite is heavy. A dedicated CI-cost/efficiency audit is **deferred to its own effort** — intentionally not done in this change.
- **GitHub-native secret scanning, push protection, and code scanning stop** (public-repo-only / otherwise require paid GitHub Advanced Security). Mitigation: a local `gitleaks` pre-commit + CI check replaces the lost push protection — **implemented in ADR-17** ([`docs/internal/ci-cd/SECRET_SCANNING.md`](../../../docs/internal/ci-cd/SECRET_SCANNING.md)).
- **The repository's past is already disclosed.** One public fork existed at flip time; GitHub detaches it into its own network (it is not retracted), and any prior clone retains the public history. A full-history secret scan on 2026-05-31 (provider-pattern + assignment-pattern across all 50 commits, plus a committed-file check) found **no leaked secrets**, so nothing required rotation — but treat all pre-2026-05-31 history as potentially public regardless.
- **CodeRabbit's free OSS tier no longer applies** — a private repo needs a paid CodeRabbit plan. Other integrations authenticate via the GitHub App / deploy hooks (Vercel, Render, EAS, Infisical, Claude Code on the web) and are unaffected by visibility.
- **Stars/watchers were erased** by the visibility change (cosmetic; the project had ~1 of each).

- **Correction (2026-09-05) — the repo is public again, so every consequence above that turns on
  private visibility has lapsed.** The bullets stay as written: they record what was decided and
  expected on 2026-05-31, and the reasoning is the part nobody can reconstruct. What is no longer
  true of the world is that the repo is private. It is public, **observed** 2026-08-21 by an
  unauthenticated `raw.githubusercontent.com` fetch returning HTTP 200 against a 404 control
  ([`AGENT_INFRA.md`](../../../docs/internal/ci-cd/AGENT_INFRA.md) § GitHub environments and bootstrap
  secrets) and re-observed 2026-09-05 via the repository API (`"visibility": "public"`). **When the
  flip happened is not recorded anywhere**, and 2026-08-21 is the date someone first looked, not the
  date it changed — do not use it as the start of a public-exposure window. Consequently: GitHub-native secret scanning, push protection and code scanning are
  **available**, not stopped — the `secret-scan` gate is still required and still runs, but whether
  to adopt the native features as well, or instead, has not been decided; ADR-17's revisit trigger
  has fired and is unactioned. And Actions minutes are **not** metered. The CodeRabbit consequence is the
  one worth reading twice: its free OSS tier would apply again, and that constraint is exactly what
  ADR-14 gave as its reason for replacing CodeRabbit — so that decision rested on a premise that has
  since lapsed. It is moot only because the CI reviewer it introduced was itself abandoned on
  2026-06-04 in favour of a local pre-push gate, for reasons that had nothing to do with visibility.
  The required-reviewer bullet already carries its own dated correction above.

**Trigger to revisit:**

- The project open-sources again for adoption/marketing (would restore free Actions + GitHub Advanced Security and the public-tier integrations). **Fired, and unactioned (recorded 2026-09-05)** — the repo is public, so free Actions and the public tiers are already restored; see the dated correction above and ADR-17's matching trigger.
- Metered Actions cost exceeds budget (drives the deferred CI-efficiency audit). **Cannot fire as written (recorded 2026-09-05)** — Actions minutes are unmetered on a public repo. The audit this trigger deferred was not lost: it shipped the same day as **ADR-15**, which cites this 3,000-minute budget and lands five measured levers. ADR-15's own "savings still insufficient" trigger is the live one.
- Additional human collaborators are added — reconsider real approval gates (and whether GitHub Enterprise's private-repo environment protection is worth a true production-deploy approval pause).
