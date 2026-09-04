# Documentation conventions

Where a fact lives, what a doc owes a reader, and what to do when a doc turns out to be wrong. These docs are read by agents mid-task: optimise for retrieval, not for reading.

**What this document does not do is enforce itself.** Placement, naming and whether a cited path still exists used to be machine-checked; the four gates that did it were deleted, and no check replaced them — in CI those questions are now nobody's. So everything below is a convention this document states and a reviewer applies ([`.claude/skills/diff-review/SKILL.md`](../../.claude/skills/diff-review/SKILL.md)), not a rule a check will fail you on. A misplaced doc reds nothing; the cost lands later, on the reader who cannot find the fact or who trusts the stale copy of it. What CI does still check, and what it does not: [`ci-cd/DOCS_CI.md`](ci-cd/DOCS_CI.md).

**Cite a rule here by its section, never by a number.** These rules are named, not numbered, so a
citation survives one being added or reordered. Records that cite "hard rule N" predate that and
point at the section whose wording matches; an append-only record keeps its original words, so the
number stays and the section is where to read it.

## Where a fact lives

- **A fact belongs where the thing that would falsify it lives.** If a change to a guard, a schema, a workflow or a provider setting would make the sentence false, the sentence belongs in the doc that owns that thing. Everywhere else, link to it — path plus heading anchor, never a restatement. Most changes falsify nothing and need no doc edit; the question is never "did I touch a doc" but "which doc owns this fact". A paragraph parked in a canonical doc to look diligent is worse than none, because the next reader believes it.
- **Two homes for one fact is a structure defect to merge, not a tie-break rule to write down.** Delete one copy and link to the other; never add a case-specific exception here to arbitrate a seam. The test is not whether text is repeated but whether one real-world change would require editing two docs — and two copies that are both correct today are still a defect, because they diverge: in #1586 one wrong timestamp reached five files in a single commit, because the list it belonged to had been copied six times.
- **Never create a new top-level file, and never invent a top-level folder.** Put the change in the relevant existing doc; a new topic folder under `spec/` owes a `README.md` that routes to its files. Three homes are retired and must not come back: `docs/archive/` (git history is the archive), `docs/backlog/` (work tracking lives in **GitHub Issues** — see [`ci-cd/GITHUB_PM.md`](ci-cd/GITHUB_PM.md)), and `spec/**/chunks/` (merge canon into the real spec and track delivery as issues).
- **Work status is not a doc, and a restructure is not a document.** Status, plans and one-off narrative markdown — audits, "NOTES", "STATUS", consolidation writeups, migration plans — go to GitHub Issues, as an `[Epic]` with sub-issues when the work is large. Narrating a restructure into a file is forbidden; doing one is not.

## Where things go

Two rules make the table decidable, because rows nest and a directory is not a filename. **Take the most specific row that matches** — chat behavior goes to `spec/behavior/chat/`, not to the broader `spec/behavior/` row above it, and design-system work goes to `spec/ui/design-system/`, not to `spec/ui/`. **Inside the directory a row names, a topic is one file, `<topic>.md`**, and earns its own `<topic>/` folder with a `README.md` routing to its files only once it has 2+ of them; `spec/behavior/chat/` and `spec/behavior/settings/` are the two that crossed that line.

| Kind of change | Canonical home |
| -------------- | -------------- |
| Product behavior, rules, flows, invariants | `spec/behavior/<topic>.md` (or `<topic>/README.md` once it has 2+ files) |
| Chat behavior (a topic with 2+ files) | `spec/behavior/chat/` |
| Settings behavior (a topic with 2+ files) | `spec/behavior/settings/` |
| Product features, surfaces, positioning, module catalog | `spec/product/` |
| Architecture, data model, API patterns, ADRs | `spec/architecture/README.md` — ADRs are append-only (amend or supersede, never rewrite) |
| Engineering principles | `spec/engineering.md` |
| Environments, CI/CD model | `spec/environments/README.md` |
| UI requirements (brand, assets, resilience) | `spec/ui/` |
| Web-dashboard UI requirements | `spec/ui/web-dashboard/` |
| Mobile UI requirements | `spec/ui/mobile/` |
| Landing-site UI requirements | `spec/ui/landing/` |
| Design-system (tokens, typography, icons, microcopy, accent engine) | `spec/ui/design-system/` |
| Visual design reference (committed design exports) | `spec/ui/design-system/reference/` |
| How to run locally / test / contribute | `docs/guides/` |
| Documentation conventions and internal reference that is not a runbook | `docs/internal/` |
| CI / agent infra / automations | `docs/internal/ci-cd/` |
| Ops runbooks (DB, incidents, branch protection, deploy) | `docs/internal/ops/` |
| Env reference / secrets / local-dev / cloud sandbox / agent credentials | `docs/internal/environment/` |
| Security implementation notes / fixes log | `docs/internal/security/` |
| Accessibility / PR-review process | `docs/internal/quality/` |
| Mobile testing / smoke | `docs/internal/mobile/` |
| Per-service performance notes | `docs/internal/services/` |
| Per-optimization performance notes (one file per optimization) | `docs/performance/` |
| Data-layer hook conventions (query keys, chapter scope, optimistic mutations) | `docs/hooks/` |
| Work status / planning | **GitHub Issues** — not a doc; see [`ci-cd/GITHUB_PM.md`](ci-cd/GITHUB_PM.md) |

## What a doc owes a reader

- **A hand-maintained number is a future contradiction.** A total typed into prose has no mechanism to stay true, and two hand-kept copies of one total will eventually disagree. Delete it; restate one only where it is load-bearing, and then name the command that produces it.
- **A copy of live state must say whether it states intent or observation.** The doc owns intent — what the system is supposed to do. An observation is what something was doing when someone looked, so it is only borrowed: it carries a dated stamp naming *how* it was checked (the command, the API call, the run), and the claim is refreshed whenever the date is. A bare date is decoration — it ages while nobody knows what to re-run.
- **Do not verify intent against code.** `spec/` states intended behavior, code states current behavior, and a rationale is the record rather than a claim about the world that code can settle. When the code moves on, amend with a dated note; never rewrite the record to match today's code.
- **Provenance is evidence, not narration, and a rule is never widened past what was verified.** A dated record naming the run or command that tested something is the only proof it works, so compressing it away deletes the proof; and a narrow claim that was checked beats a general one that was not. Both rules in full: [`spec/engineering.md` § Changing existing code](../../spec/engineering.md#changing-existing-code).
- **Say what a doc does not cover, beside what it does.** Coverage a reader assumes and does not have is how a confident wrong conclusion ships. A doc that hedges about its own accuracy is instructing you to verify before acting — so remove the reason for the hedge rather than leaving it standing with nothing to check against.

## When a doc turns out to be wrong

- **Verify before you act, cheapest first, and read the named source whole.** A path is settled by the repo in seconds; behavior, a guard or a schema by reading the file rather than a summary; an inventory by whatever generates it; provider state only by the provider. A grep proves your pattern matched, not that the fact is there — one topic is routinely declared twice a few lines apart, so the first hit can be the wrong half and still read as confirmation. Conclude from the whole declaration, then act on what you verified rather than on what the doc said.
- **Fix it in this order.** (1) Correct the claim in its canonical home. (2) Delete the duplicate and link to that home — the strongest fix available and the only one that prevents recurrence, so prefer it over syncing two copies. (3) Delete the claim if nothing needs to assert it. (4) File an issue, only when the fix is genuinely out of scope, saying what you verified and how so the next reader does not redo it.
- **A deletion or rename is not finished until every doc naming the old thing is edited in the same change.** Grep for the **name**, not just the path: the bare token, the slash form and the prose title all cite it, and source code cites docs too. Naming a removed thing on purpose is content — a removals table or an amendment needs the dead name — but a step someone will try to follow that points at something absent is a defect. When you cannot tell which you are reading, treat it as a live instruction.

## Naming and formatting

- **kebab-case `.md`, or `README.md`.** Files that predate the rule are grandfathered, not precedent: rename one when you are already touching it, and never add a new file in the old style. Committed `.dc.html` design exports are exempt — they are artifacts of a design tool, not prose, and keep that tool's naming.
- **Markdown is deliberately not machine-formatted.** `npm run format` covers `ts`/`tsx` only, so diffs here stay hand-authored and a reviewer reading one sees the change and not a reflow. Never run prettier over prose: most tracked markdown differs from its defaults. Measure it with the repo's own pinned prettier rather than trusting a figure here — `npx prettier --list-different $(git ls-files '*.md') | wc -l` — because a count taken with a different prettier answers a different question than the one `npm run format` would ask. One `--write` therefore buries whatever the diff was carrying, and there is no `.prettierignore` to stop you. The `ts`/`tsx` half of the same command is unresolved rather than settled — no repo-root config, no `--check` in CI, and root defaults that contradict the repo's only committed style config ([`apps/api/.prettierrc`](../../apps/api/.prettierrc), `singleQuote`) — tracked in #1650.

## See also

- Tree indexes: [`docs/README.md`](../README.md) · [`spec/README.md`](../../spec/README.md) — they
  route to files; the directory map is the table above, and they point back here for it
- Work tracking: [`ci-cd/GITHUB_PM.md`](ci-cd/GITHUB_PM.md) · ADR-16 in [`spec/architecture/README.md`](../../spec/architecture/README.md)
