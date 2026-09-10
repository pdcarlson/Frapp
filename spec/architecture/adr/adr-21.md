### ADR-21: Retire the Vercel Git integration — deploys move into CI (landing 2026-09-01, web 2026-09-02)

This ADR is the **canonical record** of the Vercel Git unlink: the dates, the freeze points, the
live breakages and the work that repairs them. Other docs carry a sentence of current state and
link here; the detail belongs on this page only.

**Decision:** Disconnect both Vercel projects — `frapp-web` and `frapp-landing` — from Git. The
owner did this deliberately, and not as one event: `frapp-landing` was unlinked on **2026-09-01**
and `frapp-web` roughly six and a half hours later, on **2026-09-02** (measured boundaries under
**Consequences**). Vercel no longer observes the repository at all: no push produces a preview, no
branch is a Production Branch, and no Vercel dashboard setting decides what ships from a push.
Deploying moves into GitHub Actions.

**Context.** The Git integration did two jobs, and both had become liabilities. It built a preview
for every push to `main` — the staging verification path ADR-20 decision 3 recorded; both
`vercel.json` files pin `git.deploymentEnabled` to `{"main": true, "**": false}`, so feature-branch
and PR pushes never produced a deployment — and it held the settings that decided what a push to
`main` did: the Production Branch, and auto-deploy from push.
The Production Branch exists only in the Vercel dashboard: this repository could assert it
(`assertVercelProductionBranch` in `scripts/ci/production-guardrails.mjs`, daily and again as a
preflight before every deploy) but could never enforce it. It is the Vercel half of the pair ADR-19
recorded as "load-bearing, dashboard-only, and **fail open**"; the other half is Render auto-deploy,
which this ADR does not touch. Auto-deploy from push is the second liability the unlink removes — no
guardrail ever asserted it, and it was partly repo-governed through `git.deploymentEnabled` in both
`vercel.json` files. Removing the integration removes both.

Evidence for the state as of 2026-09-02: Vercel's `list_projects` reports `link: null` for **both**
projects. The last Git-sourced deployment each project accepted — its **freeze point**, and the
build that staging host still serves — is **landing `2bf143b` at 2026-09-01T20:19Z** and **web
`0372c6d` at 2026-09-02T02:41:42Z**; the web one carries `githubDeployment: 1` and
`githubCommitRef: main` in Vercel's deployment list, and `verify-deployments.yml` run #436 verified
it green. Nothing was failing beforehand — production-guardrails run #4 passed, and every push to
`main` produced previews only. This is a decision taken, not a breakage worked around.

**What it retires.** The Production Branch guardrail (`assertVercelProductionBranch` in
`scripts/ci/production-guardrails.mjs`) now asserts a setting the API no longer exposes. The
auto-deploy-from-push path is gone outright. The `git` settings and the `ignoreCommand: "exit 1"`
pin in both `vercel.json` files — ADR-20's always-build row — have no integration left to govern
while the projects stay unlinked, which makes the **premise** of **#1376** (that nothing enforces
the `ignoreCommand` pin) moot for exactly as long as that holds. #1376 is open; its disposition is
decided on the issue, not by this prose. **Do not delete either key.** `git.deploymentEnabled` and
`ignoreCommand` are the versioned form of settings that are otherwise dashboard-only — re-link Git
and branch filtering and the Ignored Build Step fall straight back to unversioned dashboard state.
And `scripts/ci/deploy-vercel-production.mjs` passes a `gitSource` to Vercel's create-deployment
API, an argument that only means anything while the integration exists.

**What replaces it.** CI-driven deploys: `vercel build` in a GitHub Actions job, then
`vercel deploy --prebuilt --prod` — or the `files` upload form of the create-deployment API —
shipping the artifact that job produced. That model is **designed, not built**: no workflow does it
today, and nothing in the repository deploys Vercel without the integration. It is tracked as
**#1578**, filed 2026-09-02 as CI/CD stage 7 — a native sub-issue of the #1381 epic.

**Consequences.** Four breakages are live as of 2026-09-02, recorded here as current known-broken
state rather than as history:

- **The daily 07:15 UTC production-guardrails run is red.** `assertVercelProductionBranch` reads
  `project?.link?.productionBranch` and treats an absent value as a violation; with `link: null` it
  is always absent. The same assertion runs as a preflight inside `deploy-production.yml`, so it
  **blocks every production deploy** — including a `--migrations-only` run, which drops only
  `frapp-landing`'s assertion and still makes `frapp-web`'s. Tracked as **#1579**.
- **`verify-deployments.yml`'s two Vercel jobs fail on every push to `main`** — they look for a
  deployment the integration used to create. The two jobs broke ~6.5 hours apart, one per project,
  which is how the unlink itself is dated:

  | Job | Last green run | First failing run |
  | --- | --- | --- |
  | `verify-vercel-landing` | #427, `2bf143b`, 2026-09-01T20:19:18Z | #428, `7f94528`, 2026-09-01T20:28:41Z |
  | `verify-vercel-web` | #436, `0372c6d`, 2026-09-02T02:41:42Z | #437, `b62a142`, 2026-09-02T03:04:00Z |

  Every run from #428 on has `verify-vercel-landing = failure`; `verify-vercel-web` kept succeeding
  through #436, i.e. for six and a half hours after landing broke. **Only the verify step fails.**
  `scripts/ci/ensure-vercel-staging-alias.mjs` is *not* failing and emits nothing to grep for: its
  step is a plain sequential step after the verify step in the same job with no `if:` guard, so a
  failed verify ends the job before it runs — measured `skipped` on both Vercel jobs of runs #437
  and #443. (Run on its own it would exit 0 as a skip.) Tracked as **#1579** with the guardrail
  above.
- **`scripts/ci/deploy-vercel-production.mjs` is presumed broken**, because its `gitSource` argument
  requires the integration. Presumed rather than measured, and structurally so rather than by
  accident of scheduling: the `assertVercelProductionBranch` preflight in the bullet above fails
  first, so `deploy-production.yml` never reaches this step — the `gitSource` path **cannot be
  exercised at all until #1579 lands**. That is also the sequencing constraint on the replacement:
  **#1579 has to land before #1578's production path can be tested at all.**
- **Nothing deploys staging web or landing on merge any more.** Both staging hosts are frozen at
  the freeze points named above, and stay there until stage 7 (**#1578**) exists.

**A superseded auto-filed diagnosis: #1564.** The daily guardrails run auto-filed **#1564**
("Production deploy guardrails have drifted") on 2026-09-02; it is open and P1. Its body reads the
red run as Vercel falling back to "the repository default branch (main)", so that "every merge to
main would become a production deployment", and tells the reader to fix it by setting a Production
Branch in the dashboard. That was correct while the project was linked. It is **impossible** now —
with `link: null` Vercel is not watching the repository at all — and its remedy would mean
re-linking Git, reversing this ADR. **Do not act on #1564 as written**; the repair is **#1579**, the
inversion described below.

Against those four: the **Vercel half** of the fail-open risk ADR-19 and ADR-20 mitigated is now
removed at the source rather than asserted after the fact. While the projects stay unlinked there is
no Production Branch to point at `main` and no push path to deploy from. But *staying unlinked* is
itself unversioned dashboard state — exactly the shape of thing this repo does not trust — so the
guardrail is not moot, it is **pointed the other way**: #1579's fix is to **invert**
`assertVercelProductionBranch` so that a **present** Git link is the violation, not to delete the
assertion. An audit of Vercel keeps an item; the item is now "both projects are still unlinked".
The Render half is untouched — `assertRenderService` still runs in the same daily job and the same
`deploy-production.yml` preflight, and is why `production-guardrails.mjs` still exists. That
Vercel-side removal is the durable gain, and it is why the breakages are worth carrying rather than
undoing by re-linking. Repairing them is CI work, tracked separately in **#1579** (the guardrails)
and **#1578** (the replacement deploys); this ADR records the state and changes no workflow and no
script.

**Amendment (2026-09-02) — two of the four breakages are repaired (#1579).** The bullets under
*Consequences* above stand as the record of what the unlink left broken. Two of them no longer
describe current state:

- **The guardrail.** `assertVercelProductionBranch` was **inverted**, not deleted, exactly as this
  ADR and #1579 called for. It is now `assertVercelNoGitLink` in
  `scripts/ci/production-guardrails.mjs`: a **present** Git link is the violation, and an absent one
  is the pass. The daily 07:15 run and the `deploy-production.yml` preflight therefore no longer
  fail on the intended post-ADR-21 state.

  Inverting flipped *absent* from meaning "violation" to meaning "pass", which converts a
  fail-closed check into a fail-open one unless something else holds the line: an error envelope, an
  empty body, or a future response shape has no `link` either, and would otherwise read as
  unlinked-and-green on the only path to production. `looksLikeVercelProject` is that line — a
  response that is not recognisably a project object is a violation. It is the load-bearing half of
  the change, and is unit-tested separately from the assertion so the two cannot collapse into one
  answer.

- **The verify jobs.** `verify-vercel-web` and `verify-vercel-landing` were **removed** from
  `verify-deployments.yml`. Nothing creates a Vercel deployment for a pushed SHA, so polling for one
  could not detect a problem — only manufacture a red check, which is how a red `main` stops meaning
  anything. `verify-vercel-deploy.mjs` and `ensure-vercel-staging-alias.mjs` are **kept**, referenced
  by no workflow, for **#1578** to re-wire against a deployment CI creates; the alias script
  mitigates a real Vercel behaviour (the staging hostname lagging a READY deployment) that returns
  with it. Re-add the jobs keyed on the deployment id that workflow creates, not on the pushed SHA.

The other two bullets are unchanged and still live: `deploy-vercel-production.mjs`'s `gitSource` call
remains **presumed broken** (#1579 removed the preflight that blocked it, so it is now reachable and
can finally be measured — but nothing has measured it yet), and **nothing deploys staging web or
landing on merge**. Both wait on #1578.

This amendment also supersedes the future-tense repair language left in ADR-19's 2026-09-02
amendment and in the *Consequences* and closing paragraphs above ("#1579's fix is to invert…",
"Repairing them is CI work, tracked separately in #1579"): that work has landed. #1578 has not.

**Amendment (2026-09-04) — the remaining two breakages are repaired (#1578).** The replacement this
ADR called *designed, not built* is built. All four *Consequences* bullets are now historical.

- **Staging deploys exist again.** `.github/workflows/deploy-vercel-staging.yml` runs after CI
  succeeds on `main` and deploys web and then landing: `vercel pull --environment=preview`,
  `vercel build`, `vercel deploy --prebuilt`, then `ensure-vercel-staging-alias.mjs` to point
  `app.staging.frapp.live` and `staging.frapp.live` at the new deployments. It is gated on
  `workflow_run` rather than `push` for the reason `deploy-api.yml`'s header gives — a push-triggered
  deploy ships a commit whose CI has not finished — which is also why #1578's acceptance criterion
  naming `verify-deployments.yml` was met **in this workflow instead**: it holds the deployment id it
  created, so it verifies by id rather than searching for a deployment by SHA, and
  `verify-deployments.yml` stays the push-triggered Render observer.
- **`gitSource` is gone.** `scripts/ci/deploy-vercel-production.mjs` was **replaced** by
  `scripts/ci/deploy-vercel.mjs`, parameterised by target rather than production-only: after this ADR
  both channels are CI's job, and carrying the difference in one argument keeps them from drifting
  into two implementations. It never measured the old `gitSource` call — the call was removed rather
  than exercised, since ADR-21 already establishes it cannot work without the integration.

Two consequences this ADR's own requirements produce, recorded here because this is where they are decided rather than merely implemented:

- **Every CI-created deployment is stamped `--meta githubCommitSha` (and `githubCommitRef`).** A
  `--prebuilt` upload carries no git metadata at all, and three things read it back: ADR-19's
  named-commit guarantee, `ensure-vercel-staging-alias.mjs`'s lookup, and
  `verify-vercel-deploy.mjs`'s per-branch supersession test. Without the flag the alias step would
  silently find nothing and skip.
- **`git.deploymentEnabled` and `ignoreCommand: "exit 1"` remain in both `vercel.json` files and are
  now inert**, exactly as this ADR requires. The CLI path does not consult either: `ignoreCommand` is
  the Git integration's Ignored Build Step, and `--prebuilt` has already built. They stay because
  they are the versioned form of dashboard-only settings. #1376's premise is unchanged by this.

**Not done, and not doable by CI:** the Definition of Done's final clause — one production deploy
dispatched successfully through the new path — needs the `production` environment's required-reviewer
approval. `deploy-production.yml`'s `dry_run_only` still stops before the Vercel step.

**Correction 2026-09-07:** the CLI deploy **has** now run against the live projects. Run
[34155737950](https://github.com/pdcarlson/Frapp/actions/runs/34155737950) (`scope: full`, SHA
`f2938a01`) applied, shipped Render, and uploaded both Vercel production bundles with
`--prebuilt --prod`. The tag job failed afterward (`GET /pulls/1340`); that does not un-exercise
the upload path. Canonical timestamps and the Actions-list trap:
[`docs/internal/ops/deployment/ci-cd.md`](../../../docs/internal/ops/deployment/ci-cd.md#how-deployments-are-gated).

**Correction 2026-09-09:** #1376 closed as `not_planned` on 2026-09-02 (premise moot while
unlinked; reopen if Git is re-linked). The original *What it retires* paragraph that says it is
still open is the 2026-09-02 record, not current tracker state.

**Trigger to revisit:** CI-driven deploys prove unworkable and re-linking Git is considered. That
supersedes this ADR rather than amending it — and re-linking restores both Vercel settings, the
Production Branch and auto-deploy from push, along with the integration.
