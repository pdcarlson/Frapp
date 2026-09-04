---
name: docs-upkeep
description: >
  Run the Docs Upkeep routine (4 of 5) — sweep a rotating fifth of the docs corpus, verify its
  claims against code and providers, and fix what is wrong in a single docs-only PR. Use when the
  scheduled "Docs Upkeep" routine fires, or when asked to sweep, audit, or refresh the docs.
---

# Docs Upkeep (routine 4 of 5)

The tracker routines keep the **tracker** honest. This one keeps the **docs** honest, and it was
the first routine that fixes what it finds instead of filing it — [`hygiene-scan`](../hygiene-scan/SKILL.md)
(routine 5) now does the same for code.

It exists because a doc's claims decay quietly: a reader finds out by acting on one, and by then the
wrong turn is already taken. The standard in
[`DOCUMENTATION_CONVENTIONS.md`](../../../docs/internal/DOCUMENTATION_CONVENTIONS.md) says what a doc
owes a reader, but it binds only where a session happened to look — so debt pools in exactly the
low-traffic runbooks a cold session needs most. This routine is the scheduled sweep that reaches
them.

**Ownership, tracker, and the product-code ban** —
[`ROUTINES.md` → Shared ownership boundary](../../../docs/internal/ci-cd/ROUTINES.md#shared-ownership-boundary-all-routines),
whose rule 3 carries this routine's wider path allowlist and rule 4 its MCP exception.

---

## Fix, don't file (read this first — it inverts the other routines)

[`audit`](../audit/SKILL.md) tells a scheduled routine to file findings as GitHub issues rather than
fix them in place. **That rule does not apply to this routine, and the inversion is the entire
point** (ADR-16 amendment 6).

Filing docs debt does not work here. Of the `area:docs` issues ever opened, well over half are still
open; roughly a third of the open ones were five-minute fixes on the day they were filed; several
have never been touched since. A docs issue is a promise to do a minute of work later, and the
tracker is where those promises go to age. Docs are cheap to fix and expensive to leave wrong,
because a wrong doc misroutes every reader until someone notices.

So:

- **Fix it in the PR.** That is what this routine is for.
- **Never open an `area:docs` issue.** Not for a small fix, not for a big one, not "to track it".
- If a fix is genuinely beyond a docs edit — it needs a product decision, a provider change, or code
  — **say so in the run report** and leave the doc alone. The report reaches the owner; an issue
  would just queue.

The one thing you may still file is a **proven human-only blocker** per
[`file-follow-up`](../file-follow-up/SKILL.md) — a dashboard-only toggle, a missing credential.
That is a request for someone's hands, not a docs task.

A **spec-vs-code contradiction** is not yours to resolve either way: `AGENTS.md` § Spec vs code says
never "correct" a spec to match a bug, nor working code to match a superseded spec. Report it.

---

## Repo write permission

[`ROUTINES.md` → Self-maintenance](../../../docs/internal/ci-cd/ROUTINES.md#self-maintenance-the-update-themselves-contract)
already lets a routine open a **docs-only PR on a restricted path allowlist**, through the normal
pre-push review gate, never self-merged, at most one per run. This routine uses that mechanism with
a wider allowlist:

| | |
| --- | --- |
| **May edit** | `docs/**`, `spec/**`, `.claude/skills/**/*.md`, every `AGENTS.md` (including `apps/web/AGENTS.md`), root `CONTRIBUTING.md` / `README.md` — i.e. exactly the corpus below |
| **Never** | product code, `apps/**` *except* its `AGENTS.md`, `packages/**`, `scripts/**`, `.github/**`, migrations |
| **Volume** | at most **one** PR per run, on `claude/docs-upkeep-YYYY-MM-DD` (append `-2` if that branch exists). Never merge it — a human does. |

> **ADRs are append-only.** `spec/architecture/README.md` holds ADRs and their amendments. Never
> rewrite one to make it match today's code, even when it is factually overtaken — that is what
> `AGENTS.md` § ADR discipline forbids. A superseded ADR claim goes in the run report, or becomes a
> new dated amendment if the owner asks for one. Historical records are *supposed* to read as stale.

---

## Scope and the rotation

**The corpus is every tracked doc an agent can be misrouted by** — `.claude/skills/**` and every
`AGENTS.md` included, because a wrong claim there misroutes an agent before a human ever reads it.
Get it with:

```sh
git ls-files 'docs/*.md' 'spec/*.md' '.claude/skills/*.md' '*AGENTS.md' CONTRIBUTING.md README.md
```

Take the count from that command each run; do not write one down here, because a count in prose has
no mechanism to stay true. Tracked files only — never `find`, which would sweep untracked scratch.
`spec/ui/design-system/reference/` has no markdown in it, so it falls outside the include set
already, listed here only so nobody re-adds it.

**Pick the slice deterministically — carry no state.** Sessions are fresh per run and there is no
tracker memory here, so derive the slice from the calendar and the corpus alone:

1. Take the command's output **in its own order** (that is byte-order already — do not re-sort).
2. Number the files `0 … n-1`. File `i` is in group `floor(i * 5 / n)`, so groups are numbered
   **0–4** and come out within one file of each other.
3. Sweep the group whose index is `$(date -u +%V) mod 5`.

Each step is exact on purpose. `%V` is **ISO** week — `%W` and `%U` differ from it for most of the
year (`date -u +'%V %W %U'` if you doubt it), and picking the wrong one silently sweeps the wrong
fifth. `-u` keeps a manual re-run near a Sunday boundary on the same answer as the scheduled firing.
`%V` is zero-padded, so parse it base 10 (`10#$V` in bash) or `08` and `09` throw.

**Two honest imperfections, neither worth correcting:**

- **The cycle skews at New Year.** `mod 5` does not divide a 52- or 53-week year, so at each
  rollover one group waits up to **eight** weeks and two get swept twice a few weeks apart. Accepted.
- **Groups differ by up to ~3× in reading weight**, not in file count — group 0 carries every
  `.claude/skills/` file plus `AGENTS.md`, and which group holds a heavy file like `AGENT_INFRA.md`
  shifts as the corpus grows. Budget for it, and say in the report if you ran out of run. **Do not
  re-scope the slice to balance it** — a slice that depends on judgement is not reproducible, and
  `ROUTINES.md` § Verify asserts that two runs in one week take the same one.

---

## What to check, in priority order

Work the slice file by file. The job is not to proofread — it is to find claims that are **wrong**
or **unmaintainable**.

**1. Claims a machine can settle.** Highest-yield and cheapest. Size the check to the claim and
escalate cheapest-first — the table below is the mapping — and compose with
[`infrastructure-research`](../infrastructure-research/SKILL.md) for provider truth rather than
reimplementing it. Act on what you verified, not on what the doc said.

| Claim in a doc | Settled by |
| --- | --- |
| A command (`npm run …`) | the `scripts` blocks in `package.json` / the workspace manifests |
| A CI job or required check | `.github/workflows/*.yml`, and `CI_CHECKS` / `DOCS_CHECKS` in `scripts/ci/lib/required-checks.mjs` |
| An env var name | the codebase, and `docs/internal/environment/ENV_REFERENCE.md` |
| A file path | `git ls-files --error-unmatch <path>` — resolve it, don't eyeball it. A markdown *link* is covered by `npm run check:links`; a path in backticks is covered by nothing. |
| Provider state (deploys, secrets, migrations) | the provider API, per `infrastructure-research` |
| Intent, rationale, an ADR's reasoning | **nothing** — do not "verify" these against code |

**2. Facts stored more than once.** The single biggest source of drift in this repo. If the slice
contains a table, list, or enum that also exists elsewhere, that is a bug **even when both copies
are currently correct**, because they will diverge. Prefer deleting the copy and linking to the
canonical home over syncing the two.

**3. Hand-maintained numbers.** A test count, a package count, an "N contexts" figure. These have no
mechanism to stay true. Delete the number or replace it with the command that produces it.

**4. Per-check or per-environment liveness claims.** "X is not merge-blocking yet", "the live config
has N checks". These go stale the moment an admin runs a script. State *intent* (what the source of
truth says) and link to how a reader gets live state.

**5. Instructions pointing at something that moved.** Distinct from a stale reference: this is a
step someone will actually try to follow.

**6. Dated stamps.** A stamp is only worth keeping if it names *how* it was verified so a reader can
re-run the check. If you refresh a date, refresh the claim under it — otherwise you have made the
doc more misleading, not less.

---

## How to fix

The fix ladder from
[`DOCUMENTATION_CONVENTIONS.md`](../../../docs/internal/DOCUMENTATION_CONVENTIONS.md), strongest
first, with this routine's own rung 4:

1. **Correct the claim** in its canonical home.
2. **Delete the duplicate and link to the canonical home.** The strongest available fix, because it
   is the only one that prevents recurrence. If the canonical home is **outside** the allowlist —
   product code, a workflow, a script — do the half you may: fix or delete the copy in the slice and
   link out. Never edit the out-of-scope file; if the canonical side is the wrong one, report it.
3. **Delete the claim** if nothing needs to assert it.
4. **Report it** — never file it. See "Fix, don't file" above.

Placement is not a judgement call:
[`DOCUMENTATION_CONVENTIONS.md`](../../../docs/internal/DOCUMENTATION_CONVENTIONS.md) holds the map.
Never add a file, never append a section to a doc that is not about that subject, and never write a
narrative "audit" or "status" doc — that shape is itself a review finding.

Editing outside the slice is fine when it is the canonical home of a duplicate you are collapsing.
Say so in the report.

---

## Shipping the PR

**No findings → no PR.** Report that the slice was clean and stop. A PR is not the deliverable; a
true corpus is.

Otherwise, in order:

1. **Verify.** `npm run check:links` (install the binary first with `npm run install:lychee`). It
   runs the same lychee invocation CI runs and is the one check that validates a markdown link and
   its heading **anchor** — renaming a heading and collapsing a duplicate are this routine's literal
   job, and either can red a link in a file this run never opened, so read its output past the
   slice. A path written in backticks is validated by nothing, so resolve every one you write or
   move. `npm run ci:local-gate` previews the code gates and is heavier than a docs run needs.
2. **Review.** Run [`/diff-review`](../diff-review/SKILL.md). The pre-push hook **denies `git push`**
   without its marker for the current HEAD — retrying does not help, and after four denials the
   livelock guard pushes anyway, labelled UNREVIEWED. This is the gate that actually blocks you.
3. **Push and open** against `main` with `mcp__github__create_pull_request`. If the GitHub MCP is
   unavailable, push the branch, report its name, and stop — `gh` and raw REST are not sanctioned
   paths (`AGENTS.md` § Work tracking), so there is no fallback that opens a PR.
4. **Fix your own CI, then stop.** `AGENTS.md` § Autonomous PR lifecycle tells an interactive
   session to babysit a PR all the way to merge; that does **not** apply here — merging is
   forbidden and subscribing is optional. But a failure *this sweep caused* is yours: renaming a
   heading or moving a file reds `link-check`, on a doc this sweep may never have opened. That is a
   docs problem in your own scope, and handing it back as a red PR contradicts the point of
   repairing rather than filing. Fix and push.
   Anything else — a failure in code you did not touch, a flake, an infra error — is a run-report
   finding, not a reason to keep pushing. Never widen the PR to chase a red check outside the
   allowlist.

> **A PR touching only `.claude/` merges on its own.** It could not before #1597, when
> `docs-spec-sync` was required and counted `docs/` and `spec/` only — which is why every skill
> change up to then was paired with a `docs/` file. Pair with `ROUTINES.md` when the rule genuinely
> lives in both, not to get a check green.

---

## Budget and guardrails

- **Zero changes is a success.** A slice that is already accurate is the outcome you want, not a
  failed run. Never manufacture edits to show work, and never "improve" prose that was already true
  — churn in a doc corpus is indistinguishable from drift to the next reader.
- **Never touch product code**, and never widen the sweep beyond the slice except as "How to fix"
  allows.
- **Never print secret values** — names and presence only.
- **Say "unverified" when a provider is unreachable.** A guess dressed as a verification is worse
  than the stale line, because it launders an assumption into something that reads as checked.

---

## Run report

End every run with:

1. **Slice** — group index, week number, how many files, which areas.
2. **Fixed** — one line per change, naming the file and what was wrong. The PR link, or the branch
   name if the MCP was down.
3. **Found but not fixable in a docs edit** — things needing a decision, a provider change, or code,
   plus any canonical home outside the allowlist. This is the section the owner actually reads; be
   specific enough to act on.
4. **Unverified** — claims you could not settle, and why.
5. **Clean** — say so plainly when the slice held up, and if you ran out of run, where you stopped.

---

## Self-maintenance

Same contract as the other routines
([`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md#self-maintenance-the-update-themselves-contract)),
with this routine's own inversion: verify your own claims each run — the corpus command, the
commands in the table above, the paths you cite — and fix mechanical drift in this file
in the same PR, since this skill's directory is inside the allowlist. Mind the `.claude/`-only trap
above when that is the *only* thing you changed. Judgement-laden drift — a change to what this
routine is *for* — goes in the run report for the owner, never a self-authored rewrite, and never an
`area:docs` issue.
