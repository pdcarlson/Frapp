### ADR-20: CI/CD pipeline redesign — production-shaped CI, one path to production, a six-stage program (2026-08-30)

**Decision:** Rebuild the deployment pipeline rather than patch it, in six sequenced stages, each
independently valuable and revertable. Stages 1–2 are merged (#1374, #1378); stage 3 is this ADR and
the standard it points to. The program is tracked in **#1381**, a GitHub `[Epic]` with one sub-issue
per remaining stage (#1382, #1383, #1384), not a document.

**Context.** Production deploy run
[33275321347](https://github.com/pdcarlson/Frapp/actions/runs/33275321347) applied migrations and
shipped the API, then skipped both frontends and skipped the release job — leaving production split
across two commits with no tag recording what was live. Investigating it surfaced a class of
defect rather than a bug: CI proved that code compiled and tests passed, and asserted nothing about
the thing being deployed or the databases receiving it. Patching the immediate failure would have
left that premise intact, so the pipeline was taken as the unit of change instead. The eight
decisions below were taken between 2026-08-28 and 2026-08-30 and are recorded here because they are
the ones a later reader would otherwise re-litigate.

| # | Decision | Date | Why |
| --- | --- | --- | --- |
| 1 | Leave production blocked rather than hand-unblock it, until the pipeline fix landed | 2026-08-29 | Hand-unblocking would have spent the one forcing function that made the redesign urgent, and would have deployed through the path under suspicion |
| 2 | Defer production backups to stage 5, as an accepted risk | 2026-08-29 | `db-backup.yml` covers staging only, and the free tier has neither PITR nor daily backups. Until stage 5, a `frapp-prod` data-loss event is **unrecoverable**. Recorded as a risk taken knowingly, not an oversight. **Amended 2026-09-06:** `db-backup.yml` now dumps and mirrors `frapp-prod` nightly under a reviewer-free `production-backup` environment (the design #1435 asked an owner to choose — a separate reviewer-free environment rather than `environment: production` — shipped for the owner to ratify by merging; #1435 stays open until its last acceptance criterion, an unattended run that produces a restorable artifact, is met). The risk retires the night the first scheduled production dump reads back from the bucket; a production *database* restore into a hosted project is still unrehearsed, so "recoverable" is not yet "proven recoverable". **Amended 2026-09-07:** the hosted *staging Storage* restore rehearsal (#1421) passed — a canary deleted from `frapp-staging` Storage came back byte-for-byte from R2 prefix `storage/`. That closes the Storage-half drill on staging. It is not a production dump, not a production Storage rehearsal, and not a hosted production database restore. |
| 3 | Make CI production-shaped; leave staging preview-based | 2026-08-29 | `web-production-build` builds `apps/web` and `apps/landing` under `npm ci --omit=dev`, matching Vercel's production install. Staging keeps preview builds, so a build-shape difference between the two environments persists — a recorded trade-off, not a bug to rediscover |
| 4 | Six stages, sequenced, each independently valuable and revertable | 2026-08-29 | A single change large enough to carry all of it could not be reviewed or reverted; the sequence is what makes the scale safe (`spec/engineering.md` § Changing existing code) |
| 5 | Demote `migration-drift` from required to reporting-only | 2026-08-30 | It measures whether staging is behind `main` — a question no PR contains or can change. As a required check it was a merge-freeze switch, not a gate: on 2026-08-29 it turned every open PR unmergeable over state none of them touched. Detection is not lost; `check-migration-drift.yml` covers both environments daily |
| 6 | Delete `migrate-production.yml`; give `deploy-production.yml` a `scope: full \| migrations-only` input | 2026-08-30 | The deleted workflow took an arbitrary `ref` and skipped SHA validation, the guardrail preflight, the replay and the working-tree fence — the most dangerous path in the repository, kept as a backup for the safest one. ADR-19's 2026-08-29 correction records the same reversal from the other side; this row is the decision as taken, that correction is its effect on ADR-19 |
| 7 | `--include-all` exists as a human-only recovery flag no workflow sets | 2026-08-30 | It discards the ordering guarantee `migration-order` exists to enforce. `run-migration.mjs` refuses it under `CI=true` unless `MIGRATION_ALLOW_INCLUDE_ALL` is set; recovery is deliberately human |
| 8 | The master plan lives in GitHub tracking issue **#1381**; the durable standard is written before any further CI refactoring | 2026-08-30 | `docs/internal/DOCUMENTATION_CONVENTIONS.md` hard rule 3 bans narrative plan documents and names migration plans as the example; hard rule 4 sends a new initiative to an `[Epic]` parent with sub-issues |

**What replaced each piece.**

| Was | Is |
| --- | --- |
| Nothing ever ran `next build` for either frontend | `web-production-build`, a required check building both apps under the production install |
| `ignoreCommand: "npx turbo-ignore <app>"`, which skipped production builds by diffing against a baseline identical by construction | `ignoreCommand: "exit 1"` in both `vercel.json` files — an explicit always-build that cannot be overridden from the Vercel dashboard |
| A missing deployment for a SHA read as neutral | A hard failure, with `CANCELED` neutral only when a *later* deployment overtook it |
| `--env` validated, printed, then dropped — `staging` and `production` were byte-identical programs | `--env` fails closed on a project-ref mismatch before `link` or `push` |
| Migration ordering caught only after merge, by a required check that froze every PR | `migration-order`, which reads the migrations a change *introduces* against the merge-base and makes zero network calls when a change touches none |
| `ALL_REQUIRED_CHECKS` asked of any past commit, silently un-deploying every commit older than the newest check | The expected set intersected with the job ids the deployed commit's own workflows define, with a narrowing floor |
| Two paths to production, the weaker one skipping every gate | One path, two scopes |

**Consequences.**

- **The rollout is not the merge.** Live branch protection is written by
  `scripts/configure-branch-protection.mjs` and is not read back by anything, so merging a check
  into the roster changes intent, not GitHub. Worse, `scripts/ci/validate-deploy-sha.mjs` *imports*
  that array, so a check gates the **production deploy path** from the moment it merges — before
  any admin action. The two halves move at different times and always will until stage 5.
- **Branch protection cannot be verified by an agent.** `api.github.com` returns 403 to
  authenticated and unauthenticated requests alike from a cloud sandbox, and the GitHub MCP exposes
  no branch-protection tool. Step 4 of any rollout is evidenced only by a human's own run output.
  This is why #813, #1166 and #1138 recur.
- **A `frapp-prod` data-loss event is unrecoverable until stage 5** — amended 2026-09-06: the
  nightly production dump job now exists (decision 2's amendment); the exposure closes on its first
  successful scheduled run. A hosted staging Storage restore rehearsal passed 2026-09-07 (#1421);
  a production database restore into a hosted project is still unrehearsed. `frapp-prod` is
  `ACTIVE_HEALTHY` and held 54 migrations when the Management API was last read (2026-08-29) — so
  this is a live exposure, not a hypothetical about a paused project. **"held 54 … when last read"
  is a dated snapshot, not current state:** `main` has moved past the `20260829002000` high-water
  mark that read recorded. Whether either project is behind *today* is **unverified** — the applied
  counts have not been re-read, and a promotion may have happened since. No tree-side count is
  quoted here on purpose: every merge moves it, so re-derive with
  `ls supabase/migrations/*.sql | wc -l`. The dated Management-API reads of what each project
  actually holds live in `DB_PROMOTION_RUNBOOK.md` (latest 2026-09-06), not here — one home, so a
  promotion updates one place. #1620 tracks refreshing this and the matching block in
  `docs/internal/ops/DB_PROMOTION_RUNBOOK.md`.
- **Staging and production build differently on purpose.** Staging is verified through preview
  deployments; production is built through the API with `target: production`. `web-production-build`
  closes the type-check half of that gap in CI, not the deployment half.
- **`migration-order` is stricter than the databases require.** It also fails a migration that
  predates one merged while the PR was in review, even where a single `db push` would have swallowed
  both. The remedy is a free rename of an unapplied file, and the invariant — every new migration
  sorts after everything on the base branch — is one a person can hold in their head.
- **A non-transactional partial apply (`CREATE INDEX CONCURRENTLY`) still passes the rehearsal and
  fails the real apply.** Not a regression — the deleted workflow's dry run was equally blind — but
  nothing in the redesign catches it either.

- **Amendment (2026-09-01, #1383) — the rosters left `configure-branch-protection.mjs`, and the
  "cannot be verified by an agent" consequence is narrower than stated.** Two corrections to the
  consequences above, in the order they matter.

  **(a) The deploy path no longer imports a governance writer.** The consequence above notes that
  `scripts/ci/validate-deploy-sha.mjs` *imports* `ALL_REQUIRED_CHECKS` from
  `configure-branch-protection.mjs`, putting a module that PUTs live branch protection on every
  production deploy's import graph — the entry guard added in #903 being the only thing between a
  deploy and a governance write. The three arrays moved to `scripts/ci/lib/required-checks.mjs`,
  a pure data module with no entry point, no network calls and nothing to guard; both consumers
  import from there and `configure-branch-protection.mjs` no longer re-exports them, so no second
  import path can reappear. This is deliberately **not** the "split the lists" option #1375
  considered and rejected — there is still exactly one roster, because #1378 already fixed the
  backward-looking problem structurally (`jobIdsAtRef` narrowing with a floor), and a second
  hand-synced array would have re-introduced the drift class that fix removed. What was split is
  the data from the actor, not the list from itself. `scripts/check-doc-tables.mjs` parses those
  arrays as source text and its pointer moved with them.

  **(b) Branch protection was read successfully from an agent session.** The consequence above
  states that `api.github.com` "returns 403 to authenticated and unauthenticated requests alike"
  from a cloud sandbox. On 2026-09-01, `GET /repos/pdcarlson/Frapp/branches/main/protection`
  returned **HTTP 200** with the full protection object from a cloud sandbox session, using
  `GITHUB_PAT` loaded from `.env.local` through `node`'s `fetch`. The recorded 403s were `curl`
  probes through the agent proxy. **This does not retire the trigger below.** #680's evidence table
  already records this endpoint class as *session-dependent* — 403 and 200 observed on the same day
  in different sessions — so the honest statement is that the read **sometimes** works, not that it
  can be relied on. `configure-branch-protection.mjs` now reads live protection back in every mode
  and prints a before/after diff, and a `--verify` mode diffs without writing and exits non-zero on
  any difference; it **fails** rather than passes when the read is refused, so an unreadable answer
  is never mistaken for a matching one. A rollout step is now evidenceable wherever the read
  happens to work, and no less safe where it does not.

  **What that read found, as a dated observation and not a standing claim.** `CONTRIBUTING.md` and
  `spec/environments/README.md` both hold the rule that *no doc claims per-check whether a gate is
  live today*, because live protection is whatever an admin last applied and can lag the roster.
  This ADR does not get to be the exception, so: **at 2026-09-01, one read** reported `main`
  carrying all 21 roster contexts, with `migration-order` and `web-production-build` present and
  the demoted `migration-drift` absent — which, if it still holds when you read this, would mean
  step 4 of #1378's rollout had already happened. **Re-read it rather than citing this paragraph**
  (`npm run configure:branch-protection:verify`, or the `gh api` call in the runbook); an admin can
  change any of it in the UI without touching this repo.

  The same read surfaced `allow_fork_syncing` live `false` against the roster's `true`. That one is
  **not** drift an apply can fix: GitHub only honours fork-syncing on a locked branch, and this
  payload pairs it with `lock_branch: false`, so the written value is not persisted. The diff
  therefore skips it unless the branch is locked — a comparison no run could ever satisfy would
  have made `--verify` red forever, which is how a check teaches people to route around it. Both
  facts are the class of thing a write-only script structurally could not report, which is the
  point of the read-back rather than a claim about this particular repository's settings.

- **Amendment (2026-09-02) — the Vercel half of decision 3 is superseded by ADR-21, and the
  `api.github.com` 403 is a property of the route, not of the session.**

  **(a) Staging no longer builds from Git at all.** Decision 3 above records a deliberate
  build-shape difference: production built under `npm ci --omit=dev`, staging verified through
  Vercel preview deployments. The owner disconnected both Vercel projects from Git — landing
  2026-09-01, web 2026-09-02 (ADR-21) — so the staging half of that trade-off no longer exists:
  nothing deploys staging web or landing on merge, and both hosts are frozen at their last Git
  build. **ADR-21 below is the canonical record** of the unlink, the per-project freeze points and
  the breakages; read them there rather than restating them here. The `ignoreCommand: "exit 1"` row
  in the table above governs nothing while the projects stay unlinked — but **keep the key**, and
  `vercel.json`'s `git` block with it: they are the versioned form of settings that revert to
  dashboard-only state the moment Git is re-linked.
  `web-production-build` is unaffected — it runs in CI and never went through Vercel. #1381 also
  gained a **seventh** stage on 2026-09-02 — **#1578**, ADR-21's CI-driven Vercel deploys, filed
  that day as a native sub-issue of #1381 — so the "six sequenced stages" in the decision above,
  decision row 4, and the completion condition in the trigger below all now read as seven. The
  guardrail breakages the unlink left behind are **#1579**.

  **(b) Reachability of `api.github.com` is route-dependent, not session-dependent.** The
  consequence above states that branch protection "cannot be verified by an agent" because
  `api.github.com` "returns 403 to authenticated and unauthenticated requests alike"; amendment
  (2026-09-01, #1383)(b) narrowed that to a read that *sometimes* works, on #680's
  *session-dependent* framing. The session was never the variable. Measured on 2026-09-02 from one
  sandbox host, with one `GITHUB_PAT`, inside the same minute:

  - `curl`, which honours `HTTPS_PROXY`, gets **403** `{"message":"GitHub access is not enabled
    for this session"}` on **every** repo-scoped path, regardless of the `Authorization` header —
    the agent proxy's GitHub-credential layer answers, GitHub is never reached;
  - `curl` through that same proxy to `/user` gets **200**; the proxy allows non-repo paths;
  - `curl --noproxy '*' .../repos/pdcarlson/Frapp/branches/main/protection` gets **200**;
  - node's built-in `fetch` does not read `HTTPS_PROXY` (documented in the sandbox's agent-proxy
    README at /root/.ccr/README.md), so it goes direct and gets **200 from GitHub itself** — the
    response carries `server: github.com` and `x-github-request-id`.

  Direct egress is subject only to the environment's network allowlist, which includes
  `api.github.com`. So **reads are available to an agent as a ground-truth channel**:
  `npm run configure:branch-protection:verify` exits 0 from this sandbox, and step 4 of a rollout
  is evidenceable by an agent rather than only by a human's run output. Never respond to the 403 by
  regenerating the PAT with broader scopes — scope is not what it is about — and never set
  `NODE_USE_ENV_PROXY=1` for these scripts, which would push node onto the 403 route. What does
  **not** change: applying branch protection stays a human step with an admin PAT **by policy**,
  not because it is unreachable; and the GitHub MCP stays the sanctioned write path for issues, PRs
  and comments. REST is a read channel for settings the MCP exposes no tool for — not a write
  fallback, not an MCP replacement. This satisfies the read half of the trigger below; the write
  half is a policy choice and stands.

  The 2026-09-01 caution holds unchanged: a read reports what an admin last applied, so re-read
  rather than cite. Re-read on 2026-09-02, `main` still carried 21 required contexts with
  `strict: true`, `enforce_admins: true`, `required_linear_history: true`,
  `required_pull_request_reviews: null`, and `allow_fork_syncing` live `false` against the roster's
  `true` (**#1580**) — a dated observation, not a standing claim.

- **Amendment (2026-09-04, #1580) — the `allow_fork_syncing` divergence is closed, and the roster
  half of both readings above is now stale.** Both paragraphs also say 21 roster contexts, which
  was true when read: it has been **20** since #1637 (`bab7200`) dropped `docs-spec-sync` on
  2026-09-03. They record `allow_fork_syncing`
  live `false` "against the roster's `true`". The *live* half still holds (re-read 2026-09-04:
  `allow_fork_syncing: false`, `lock_branch: false`); the *roster* half does not. The roster now
  declares `false`, in [`scripts/configure-branch-protection.mjs`](../../../scripts/configure-branch-protection.mjs).
  It was closed by changing the **declaration**, not by applying: GitHub honours fork-syncing only
  on a locked branch, so an apply would have written a value GitHub does not persist, and applying
  is a human step with an admin PAT by policy. `LOCK_DEPENDENT_FLAGS` still excludes the key from
  the `--verify` diff while `lock_branch` is `false`, so **a future divergence on that key would
  still be invisible to a green `:verify`** — the exclusion is the guard for a locked branch, not a
  claim that the flag is checked. The point of closing it was the hand comparison: an audit that
  diffs roster against live now finds no difference on any flag and no longer has to re-derive the
  lock-dependence reasoning to conclude the difference did not matter. Canonical page for the
  current state: [`GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../../../docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md).

- **Amendment (2026-09-04) — the doc-table checker was deleted; the parse-as-source-text constraint
  on `required-checks.mjs` lapses with it, and the agreement it enforced is now a review
  responsibility.** Amendment (2026-09-01, #1383)(a) closes on a present-tense clause:
  "`scripts/check-doc-tables.mjs` parses those arrays as source text and its pointer moved with
  them". That is the record of 2026-09-01 and stands exactly as written; what follows corrects its
  tense, not its words.

  **The checker is gone, with no successor.** On 2026-09-04 this repository retired all four docs
  gates — the doc-table checker along with the doc-path, doc-reference and structure checkers —
  deleting their scripts, their `npm` scripts and their allowlists, and replaced them with the
  written standard in `docs/internal/DOCUMENTATION_CONVENTIONS.md` plus a docs angle in the
  diff-review skill. `.github/workflows/docs.yml` is down to one job, `env-slugs`. Nothing now
  parses `scripts/ci/lib/required-checks.mjs` as source text for the **contents** of `CI_CHECKS`,
  `DOCS_CHECKS` or `DRIFT_CHECKS`, and no gate holds a pointer into that file that has to move when
  the arrays do.

  **"Unasserted" would overstate it, and the difference is the useful part.**
  `scripts/ci/__tests__/branch-protection-diff.test.mjs` still reads that file as source text — but
  only to assert that the module stays free of entry points and side effects (no `process.argv`, no
  `fetch(`, no `main`, no module-scope statement), which is precisely what makes it safe to import
  on the production deploy path. Nothing asserts what the arrays *hold*. Their only consumers are
  `scripts/configure-branch-protection.mjs` and `scripts/ci/validate-deploy-sha.mjs`, both by
  import, so a relocation touches three code sites — those two and that test's relative path — plus
  the comments and docs that name the path by hand, none of which anything checks any more.

  **What the deletion costs, named rather than left to be rediscovered as a bug.** The deleted
  checker compared exactly one doc against these arrays:
  `docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md`, which restates the roster by hand and is
  the one doc deliberately permitted to. Until 2026-09-04 a machine held those two in step. Nothing
  does now — a roster edit that leaves that runbook stale merges green, and the same is true of
  every other doc that describes these arrays in prose. Keeping them in agreement is a reviewer's
  job from here. The counts and rosters written in docs were already dated observations rather than
  sources of truth; they are now unverified ones as well, which is an argument for re-reading the
  arrays, not for copying them somewhere new.

  **One count above moves with this change.** The amendment recording the `allow_fork_syncing`
  closure notes the roster stood at 20 contexts after #1637 dropped `docs-spec-sync`. Retiring
  `doc-paths` takes it to 19. That is the last count either amendment states, and it will go stale
  the same way the previous one did — read `ALL_REQUIRED_CHECKS` rather than either number.

**Trigger to revisit:** the six-stage program completes or is abandoned; production backups exist
(retiring the decision-2 risk); or a provider gains a readable API for branch protection from an
agent session, which would retire the write-only rollout step.
