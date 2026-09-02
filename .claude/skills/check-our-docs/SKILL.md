---
name: check-our-docs
description: >
  Verify what a repo doc or spec actually claims before you act on it, then fix the doc in the same
  pass when it turns out to be wrong. Use this **while coding**, not as a separate audit — the
  moment you are about to rely on something under `docs/` or `spec/` (or an `AGENTS.md`, or another
  skill) for env vars, secrets, where a secret is set, CI or required checks, deploy and promotion
  flow, migrations, branch protection, architecture patterns, file locations, or framework
  conventions. Also use when a doc and the code disagree, when a doc cites a path you cannot find,
  when the same fact appears in two places, or when you are about to copy a table or a value out of
  a doc into code, config, or a PR description. Reach for it even when the doc looks confident and
  well-written — confident and stale is the normal failure here.
---

# Check our docs

> Read a doc claim → verify it → act on the verified version → fix the doc in the same pass.
> This is a mid-task habit, not a batch audit. If you are about to *do* something because a doc
> said so, you are in the right place.

[`AGENTS.md`](../../../AGENTS.md) already states the doctrine:

> **`spec/` is the source of truth for intended behavior. Code is the source of truth for current
> behavior.** Disagreement is a tracked bug — file it; fix the stale side in the same PR when it's
> in scope.

The repo has the rule and no mechanism for it. This skill is the mechanism.

---

## Why this exists

A session read [`docs/internal/environment/ENV_REFERENCE.md`](../../../docs/internal/environment/ENV_REFERENCE.md)
correctly, and still concluded that a secret belonged in the Vercel dashboard rather than Infisical.
The file was not lying. It carried **two tables on one topic, ~60 lines apart, under different
headings, with no cross-reference** — and the session found the wrong one first, had no reason to
suspect a second, and shipped the wrong conclusion.

Nothing flagged it. The doc was **accurate and misleading**, which is a distinct failure from stale,
and the more dangerous one. Two docs in this repo say so about themselves in prose:

- `SECRETS_MANAGEMENT.md` § Provider syncs — "goes stale silently. Treat a disagreement between
  this table and the Infisical/Vercel dashboards as the table being wrong."
- `ENV_REFERENCE.md` § Infisical → Provider Syncs — "drifted badly enough to send a reader looking
  for problems that did not exist while missing ones that did."

Those sentences are a standing instruction. Honor them: when a doc tells you it might be wrong,
verify before you act.

---

## The loop

**1. Notice you are about to act on a doc claim.** Copying a table into code, setting a variable
where a doc says to set it, adding a required check because a list names it, following a runbook
step, matching a file layout a guide describes. That is the trigger.

**2. Classify the claim** — this decides how much verification it deserves:

| Kind of claim | Check it against | Cost |
|---|---|---|
| A path, filename, or module layout | The repo — `git ls-files`, `Glob`, `node scripts/check-doc-paths.mjs` | seconds |
| Behavior, a guard, a schema, a pattern | The code itself — read the file, don't trust the summary | ~a minute |
| A count, a list, an inventory ("all 10 checks", "6 syncs") | Whatever *generates* it — a script constant, a provider API | ~a minute |
| Provider/runtime state — required checks, secret syncs, deploys, migrations | The provider API, via [`infrastructure-research`](../infrastructure-research/SKILL.md) | minutes, network |
| Framework/SDK conventions | `node_modules/<pkg>/` — [`apps/web/AGENTS.md`](../../../apps/web/AGENTS.md) mandates reading `node_modules/next/dist/docs/` because this Next version diverges from training data | ~a minute |
| Intent — why a decision was made, an ADR's reasoning | Nothing. Docs *are* the truth here. Don't "verify" intent against code. | — |

That last row matters as much as the others. An ADR's rationale is not a claim about the world; it
is the record. Don't rewrite history because the code moved on — add an amendment, which is what
[`spec/architecture/README.md`](../../../spec/architecture/README.md) already does.

**When a doc names its own source, read that source whole.** A grep tells you whether your pattern
matched, not whether the fact is there — and the answer is often in a second declaration a few lines
away. Concretely: this skill's own PR claimed `docs-spec-sync` might not be a required check,
because `CI_CHECKS` in `scripts/ci/lib/required-checks.mjs` does not contain it. The same file
declares a **separate `DOCS_CHECKS` array** that does, and merges both into `ALL_REQUIRED_CHECKS`.
The docs were right and the verification was wrong — one topic, two locations, conclusion drawn from
the first. That is the same failure shape as the `ENV_REFERENCE.md` story above, which is the point:
it catches careful readers, and grep makes it easier, not harder.

**3. Verify before you act, cheapest first.** A path check is seconds; don't skip it because the
doc reads well. Escalate to a provider call only when the claim is genuinely about provider state.

**4. Act on what you verified**, not on what the doc said.

**5. Fix the doc in the same pass.** See below — this is the half that usually gets dropped.

---

## Fixing, not just noticing

The reason docs here rot is that every individual session had a reason not to fix them: it was
off-task, it was small, someone else would. The cost is asymmetric — fixing costs you a minute now,
and not fixing costs the next reader the same wrong conclusion you just avoided.

**In an interactive session: fix it.** You already did the verification; the fix is the cheap part.
This is explicitly sanctioned — `AGENTS.md` says fix in the same PR when it's in scope. A doc
correction alongside a code change also satisfies the `docs-spec-sync` gate honestly, which is what
that gate wanted in the first place.

**What "fix" means, in order of preference:**

1. **Correct the claim** in its canonical home.
2. **Delete the duplicate and link to the canonical home.** This is the strongest fix available and
   the one that actually prevents recurrence. `ENV_REFERENCE.md` § Infisical → Provider Syncs cured
   itself exactly this way — it deleted its copy of the sync table and linked to the canonical one,
   with a note explaining that "provider state in a second file has no mechanism to stay true."
   Copy that move.
3. **Delete the claim** if nothing needs to assert it.
4. **File an issue** only when the fix is genuinely out of scope — per
   [`file-follow-up`](../file-follow-up/SKILL.md), with `area:docs`. Say what you verified and how,
   so the next session doesn't redo it. (Not if you are the [`docs-upkeep`](../docs-upkeep/SKILL.md)
   routine — it reports instead of filing; see [below](#inside-a-scheduled-routine).)

**Placement is not your choice** — [`DOCUMENTATION_CONVENTIONS.md`](../../../docs/internal/DOCUMENTATION_CONVENTIONS.md)
holds the map, and `scripts/check-docs-structure.mjs` enforces part of it. Never satisfy a gate by
adding a new file; never write a narrative "audit" or "status" doc (rule 3), and never track work
status in a doc (rule 4 — that's GitHub Issues).

---

## Verifying against providers

The claims worth the network round-trip are the ones a provider can answer authoritatively and a
human cannot maintain by hand: required checks, secret sync inventories, deployment state, applied
migrations.

**Compose with [`infrastructure-research`](../infrastructure-research/SKILL.md) — do not
reimplement it.** It already holds the recipes for GitHub, Supabase, Render, Vercel and Infisical,
and points at [`AGENT_CREDENTIALS.md`](../../../docs/internal/environment/AGENT_CREDENTIALS.md) for
credential names. This skill only adds the mapping from *doc claim* to *which provider settles it*:

| Doc claim | Settled by |
|---|---|
| Required-check / branch-protection tables (`CONTRIBUTING.md`, `spec/environments/README.md`) | GitHub branch protection, and the `CI_CHECKS` array in `scripts/ci/lib/required-checks.mjs` — that constant is what `scripts/configure-branch-protection.mjs` actually applies |
| Infisical sync inventory (`SECRETS_MANAGEMENT.md` § Provider syncs) | The Infisical API — the doc's own note says the dashboard wins |
| Which env vars exist per environment | Infisical, compared against `ENV_REFERENCE.md` |
| Applied migrations, promotion state | Supabase (`npx supabase migration list --project-ref …`) |
| Deployment/branch → environment mapping | Vercel and Render APIs |
| Sentry projects and DSNs | Sentry |

**When a provider is unreachable, say "unverified" — never guess.** Credentials and MCP servers are
genuinely unreliable here: in the session that built this skill, `INFISICAL_API_KEY`,
`VERCEL_API_KEY` and the Supabase PAT were all unset, and several MCP servers disconnected
mid-session. A guess dressed as a verification is worse than the stale doc, because it launders an
assumption into something that reads as checked. Check reachability first, and if it fails, act on
what you *can* establish and note what you couldn't.

**Never print secret values** — names and presence/absence only.

---

## Dated stamps: only stamp what can be re-verified

Three docs carry manual "last verified <date>" stamps (`SECRETS_MANAGEMENT.md`, `ci-cd/GITHUB_PM.md`,
`ops/DB_PROMOTION_RUNBOOK.md`), and `docs/guides/deployment.md` carries four dated bullets.

A stamp is a promise that someone checked. It is only worth writing if a future reader can **re-run
the same check** — so pair it with *how* it was verified, not just when. A stamp with no method
decays into decoration: the date keeps getting older and nobody knows what to re-do. If you refresh
a stamp, refresh the claim under it too, or you have made the doc *more* misleading, not less.

If a fact can't be re-verified cheaply, prefer deleting the copy and linking to whatever owns it.

---

## Smells that mean "accurate but misleading"

These are the ones no checker catches, so they need your eyes while you're already in the file:

- **One topic, two locations.** The `ENV_REFERENCE.md` failure. If you find a second table on the
  same subject, you found a bug — even if both are currently correct, because they will diverge.
  `DOCUMENTATION_CONVENTIONS.md` rule 5 is the standard: one canonical place, link from elsewhere.
- **A hand-maintained count.** `SECRETS_MANAGEMENT.md` records that it and `ENV_REFERENCE.md` once
  disagreed 7-vs-6 on the same total because both counted by hand. Any hand-counted number is a
  future contradiction.
- **A live instruction pointing at a file that doesn't exist.** Distinct from a stale *reference* —
  this is a step someone will try to follow.
- **A doc that hedges about its own accuracy** without linking to what would settle it.
- **Two docs that would both need editing** for one real-world change. That's the duplication smell
  even when no text is literally repeated.

---

## The path lint

`node scripts/check-doc-paths.mjs` checks that backticked path citations — `` `apps/api/src/main.ts` ``
— resolve. This is the blind spot in the `Links` gate: lychee validates markdown links and heading
anchors, but the docs here overwhelmingly cite files as inline code, which lychee never sees.

Run it after editing docs. It resolves a citation three ways (repo root, the citing file's own
directory, trailing-segment match) and suggests the fix when a file has simply moved.

**Docs legitimately cite paths that no longer exist** — `spec/ui/mobile/screens.md` has a
removals/renames table where naming the dead route *is* the content, and ADR amendments name deleted
files on purpose. Those live in `scripts/doc-paths-allowlist.json`, scoped per file, each with a
required reason. Before adding an entry, be sure the citation is *deliberately* historical; if it's
a live pointer, fix the doc instead. The lint also fails on allowlist entries that no longer match
anything, so the list shrinks as docs get fixed.

---

## What this does not catch

Be honest about the boundary — overselling this skill is its own kind of stale doc.

- **The originating failure.** Two correct tables 60 lines apart is a *docs architecture* problem.
  This skill encodes it as a review criterion you apply while reading; it is not a check, and no
  check would find it. A file can pass every gate in the repo and still mislead.
- **Prose that is true but incomplete**, or that omits the caveat that mattered.
- **Whether the doc answers the question a reader actually arrives with.**
- **Anything you didn't happen to read.** This is a mid-task habit with the coverage of whatever
  you touched — that's the tradeoff for it being cheap enough to actually run. Broad sweeps are
  the [`audit`](../audit/SKILL.md) skill's shape, and the path lint's.

---

## Inside a scheduled routine

Same read-only inversion [`audit`](../audit/SKILL.md) uses: routines don't edit docs, they **file
issues** (`triage` + `area:docs` + priority, with an Agent brief). Include what you verified, against
which source, and on what date — a docs issue without its evidence gets re-litigated from scratch.

Three exceptions; the second is a full inversion:

- A skill's own docs-only self-maintenance PR.
- **[`docs-upkeep`](../docs-upkeep/SKILL.md) (routine 4) fixes rather than files, and is forbidden
  from opening `area:docs` issues at all.** It exists because filing docs debt here demonstrably
  does not work — those issues age instead of getting done — so the sweep that finds a stale claim
  is the one that repairs it (ADR-16 amendment 6). If you are running *that* routine, follow its
  skill, not this paragraph.
- **[`hygiene-scan`](../hygiene-scan/SKILL.md) (routine 5) edits product code and touches docs
  only as doc-sync** — a path citation its fix moved, or the doc that states a fact its fix
  changed. A stale claim it merely *reads* goes in its run report, never an `area:docs` issue
  (ADR-16 amendment 7).

---

## Updating this skill

- Add a row to the claim-type table when a new provider becomes reachable (Sentry, Expo EAS).
- If `check-doc-paths.mjs` gains an option or the allowlist schema changes, update
  [`DOCS_CI.md`](../../../docs/internal/ci-cd/DOCS_CI.md) — it is the canonical home for docs-gate
  behavior, and its own text asks that script changes keep it, `AGENTS.md`, and the PR template in
  one story.
- Credentials live in `AGENT_CREDENTIALS.md` and provider recipes in `infrastructure-research`;
  this skill should keep pointing at them rather than growing its own copies — which is the same
  rule it asks everyone else to follow.
