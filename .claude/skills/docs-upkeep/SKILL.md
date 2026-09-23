---
name: docs-upkeep
description: >
  Run the Docs Upkeep routine (4 of 5): sweep a rotating fifth of the docs corpus, verify its
  claims against code and providers, and fix what is wrong in a single docs-only PR. Use when the
  scheduled "Docs Upkeep" routine fires, or when asked to sweep, audit, or refresh the docs.
---

# Docs Upkeep (routine 4 of 5)

Docs decay quietly: a reader finds a wrong claim by acting on it. This routine sweeps this week's
slice of the corpus, checks its claims against the code and providers, and fixes what is wrong in
one docs-only PR that a human merges. A clean slice with no PR is a successful run. The standard a
doc is held to is
[`DOCUMENTATION_CONVENTIONS.md`](../../../docs/internal/DOCUMENTATION_CONVENTIONS.md).

Ownership, the tracker and the product-code ban are shared with every routine:
[`ROUTINES.md` → Shared ownership boundary](../../../docs/internal/ci-cd/ROUTINES.md#shared-ownership-boundary-all-routines)
(rule 3 holds this routine's wider path allowlist, rule 4 its MCP exception).

## Fix, don't file

Other routines file what they find ([`audit`](../audit/SKILL.md) says so). This one fixes it in
the PR, and never opens an `area:docs` issue, whatever the size of the problem (ADR-16 amendment
6). Docs issues age in the tracker instead of getting done, and many were minutes of work when
filed; meanwhile a wrong doc misroutes every reader until someone notices.

- If a fix needs more than a docs edit (a product decision, a provider change, code), leave the
  doc alone and put it in the run report, which reaches the owner.
- The one thing you may file is a proven human-only blocker (a dashboard-only toggle, a missing
  credential) per [`file-follow-up`](../file-follow-up/SKILL.md).
- A spec-vs-code contradiction is not yours to resolve, even when `AGENTS.md` § Spec vs code would
  let an in-scope change fix the stale side. Report it.

## Write permission

| | |
| --- | --- |
| **May edit** | `docs/**`, `spec/**`, `.claude/skills/**/*.md`, every tracked `AGENTS.md`, root `CONTRIBUTING.md` and `README.md` (exactly the corpus below) |
| **Never** | product code, `apps/**` except its `AGENTS.md` files, `packages/**`, `scripts/**`, `.github/**`, migrations |
| **Volume** | at most one PR per run, on `claude/docs-upkeep-YYYY-MM-DD` (append `-2` if that branch exists). Never merge it. |

## The slice

The corpus is every tracked doc an agent or reader can be misrouted by:

```sh
git ls-files 'docs/*.md' 'spec/*.md' '.claude/skills/*.md' '*AGENTS.md' CONTRIBUTING.md README.md
```

Use tracked files only (never `find`, which picks up untracked scratch), and take the count from
the command each run rather than writing one down.

Derive the slice from the calendar and the corpus alone. Sessions are fresh and carry no state,
and `ROUTINES.md` § Verify expects two runs in the same week to take the same slice.

1. Keep the command's output in its own order (already byte order; don't re-sort).
2. Number the files `0 … n-1`; file `i` is in group `floor(i * 5 / n)`, so groups `0–4` differ by
   at most one file.
3. Sweep group `$(date -u +%V) mod 5`.

`%V` is the ISO week; `%W` and `%U` differ from it most of the year. `-u` keeps a manual re-run
near the week boundary on the scheduled answer. `%V` is zero-padded, so parse it base 10
(`10#$V` in bash), or `08` and `09` fail as octal.

Two known imperfections are accepted. At New Year `mod 5` skews the cycle, so one group waits up to
eight weeks. And groups differ in reading weight by up to about 3× (group 0 holds every
`.claude/skills/` file plus `AGENTS.md`). Budget for that, and say in the report where you stopped
if you ran out of run, but don't re-scope the slice to balance it, because a judgement-based slice
isn't reproducible. A heavy slice is worth splitting across a few subagents, each taking a group of
files, since each file is independent, context-heavy reading; keep it within the
[`multi-agent`](../multi-agent/SKILL.md) budget. Checking a single claim is not worth a subagent.

## What to check, in priority order

The job is finding claims that are wrong or unmaintainable, not proofreading.

1. **Claims a machine can settle.** Cheapest and highest-yield. Check cheapest-first, act on what
   you verified rather than what the doc said, and use
   [`infrastructure-research`](../infrastructure-research/SKILL.md) for provider truth.

   | Claim in a doc | Settled by |
   | --- | --- |
   | A command (`npm run …`) | the `scripts` blocks in `package.json` and the workspace manifests |
   | A CI job or required check | `.github/workflows/*.yml`, and `CI_CHECKS` / `DOCS_CHECKS` in `scripts/ci/lib/required-checks.mjs` |
   | An env var name | the codebase, and `docs/internal/environment/ENV_REFERENCE.md` |
   | A file path | `git ls-files --error-unmatch <path>`. `npm run check:links` covers markdown links; a path in backticks is checked by nothing. |
   | Provider state (deploys, secrets, migrations) | the provider API, per `infrastructure-research` |
   | Intent, rationale, an ADR's reasoning | nothing; don't "verify" these against code |

2. **Facts stored more than once.** The biggest source of drift here. A table, list or enum that
   also exists elsewhere is a bug even while both copies agree, because they will diverge. Delete
   the copy and link to the canonical home rather than syncing them.
3. **Hand-maintained numbers** (test counts, package counts, "N contexts"). Nothing keeps them
   true. Delete the number or replace it with the command that produces it.
4. **Liveness claims** ("X is not merge-blocking yet", "the live config has N checks"). They go
   stale when an admin runs a script. State the intent the source of truth encodes and link to
   how a reader gets live state.
5. **Instructions pointing at something that moved**: a step someone will try to follow.
6. **Dated stamps.** Worth keeping only if they name how the claim was verified. If you refresh a
   date, re-verify the claim under it; a fresh date on a stale claim is worse than the old one.

## How to fix

Strongest first:

1. Correct the claim in its canonical home.
2. Delete the duplicate and link to the canonical home; this is the only fix that prevents
   recurrence. If the canonical home is outside the allowlist (code, a workflow, a script), fix or
   delete the copy in your slice and link out. Never edit the out-of-scope file; if the canonical
   side is wrong, report it.
3. Delete the claim if nothing needs to assert it.
4. Report it in the run report. Never file it.

Placement follows the map in `DOCUMENTATION_CONVENTIONS.md`. Never add a file, never append a
section to a doc about something else, and never write a narrative audit or status doc. Outside
the slice, edit only the canonical home of a duplicate you are collapsing or a link your own change
broke; say so in the report.

## Shipping

No findings, no PR: report that the slice was clean.

Otherwise:

1. **Verify.** Run `npm run check:links` (install lychee first with `npm run install:lychee`). It
   is the CI `link-check` invocation and the only check on markdown links and heading anchors.
   Renaming a heading or collapsing a duplicate can break a link in a file you never opened, so
   read its output beyond your slice. Resolve every backticked path you write or move.
2. **Review** with [`/diff-review`](../diff-review/SKILL.md). The pre-push hook refuses a push
   without review evidence for the pushed commit; retrying doesn't help, and `--no-verify` is
   never an option.
3. **Push and open** the PR against `main` with `mcp__github__create_pull_request`. If the GitHub
   MCP is unavailable, push the branch, report its name, and stop; `gh` and raw REST are not
   sanctioned paths. If `git push` itself fails, stop and report.
4. **Fix CI failures you caused, then stop; don't subscribe.** *Autofix on PR create* is on for
   this routine, so a subscribed session would be a second driver on the branch. A red
   `link-check` from a heading you renamed or a file you moved is yours: fix it and push. Anything
   else (code you didn't touch, a flake, an infra error) goes in the report. Never widen the PR
   outside the allowlist to chase a check, and don't babysit the PR to merge; merging is a human's
   call.

## Guardrails

- Never manufacture edits or rewrite prose that was already true. Churn in the docs reads as drift
  to the next reader.
- Never print secret values; names and presence only.
- When a provider is unreachable, say "unverified". A guess presented as a verification launders
  an assumption into something that reads as checked.

## How the run ends

Work the whole slice without stopping to summarize; put any status note in the same message as your
next tool call. The run ends when the slice is swept and either the PR is open with your own CI
failures fixed, or the slice was clean. End earlier only if a push fails, or the MCP is down after
you've pushed the branch. Your final message is the run report.

## Run report

1. **Slice**: group index, ISO week, file count, which areas.
2. **Fixed**: one line per change, naming the file and what was wrong; the PR link, or the branch
   name if the MCP was down.
3. **Found but not fixable in a docs edit**: needs a decision, a provider change or code, plus any
   canonical home outside the allowlist. This is the section the owner acts on, so make each item
   specific enough to act on.
4. **Unverified**: claims you couldn't settle, and why.
5. **Clean**: say so plainly when the slice held up, and where you stopped if you ran out of run.

## Self-maintenance

Per
[`ROUTINES.md` → Self-maintenance](../../../docs/internal/ci-cd/ROUTINES.md#self-maintenance-the-update-themselves-contract),
with this routine's own twist: this skill is inside the allowlist, so fix mechanical drift in it
(the corpus command, the commands in the table, cited paths) in the same PR. A change to what the
routine is for goes in the run report for the owner, never a self-authored rewrite and never an
`area:docs` issue.
