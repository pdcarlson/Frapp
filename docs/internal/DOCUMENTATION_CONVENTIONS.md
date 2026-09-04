# Documentation conventions — placement map

The **authoritative** guide to where docs/spec changes go. Read this before adding or moving any doc.
The goal: keep `docs/` and `spec/` clean and navigable, and stop the structure from drifting when
agents satisfy the docs-sync CI gate.

**This map is machine-checked.** The table below is checked against
[`scripts/ci/lib/docs-structure.mjs`](../../scripts/ci/lib/docs-structure.mjs) — the same map as data —
in both directions by `check-doc-tables.mjs`, so the two cannot drift apart. That manifest is what
[`scripts/check-docs-structure.mjs`](../../scripts/check-docs-structure.mjs) validates the **whole
tree** against on every PR. Until 2026-09 it read only the paths a PR *added*, which is how
`docs/hooks/` and `docs/performance/` came to exist without a row here.

The structure gate reports on its own `docs-structure` job and is **not merge-blocking yet** — it
became its own job when it stopped being diff-scoped, and takes the same
reporting-only rollout `doc-paths` had ([`ci-cd/DOCS_CI.md`](ci-cd/DOCS_CI.md)). So a violation reds
a check without blocking a merge: treat this map as binding anyway, because the whole point of the
rollout is to reach the day it blocks.

## Hard rules

1. **Never create a new top-level file** in `docs/` or `spec/`, and never invent a new top-level
   folder. Put the change in the **relevant existing** doc/spec (see the map below).
2. **When a change does alter a documented fact, edit the doc that owns it — never a stray new file,
   and never a section appended to a doc whose subject it does not match.** Most changes alter no
   documented fact and need no doc edit at all; that is the normal case. Nothing forces a write, and
   nothing should: the gate that used to (`docs-spec-sync`) could only see that *some* file moved,
   never whether it was the right one, so it was cheapest to satisfy with an unowned paragraph parked
   in the nearest canonical doc. It was deleted in #1597 for producing exactly the duplication these
   rules exist to prevent. An unowned claim in a canonical doc is worse than no claim, because the
   next reader believes it.
3. **Do not generate one-off narrative markdown** (audits, PR-consolidation writeups, "NOTES",
   "STATUS", thread-resolution maps, migration plans). That kind of file is what this restructure
   removed. Durable facts go in the canonical doc; ephemeral work goes into **GitHub Issues** (file a `triage`-labeled issue).
   This does not forbid *doing* a restructure — it forbids narrating one into a file. A planned
   change to the layout is an `[Epic]` with sub-issues (rule 4) plus an edit to the manifest, which
   is executable and therefore cannot go stale the way a plan document does.
4. **Work status is not a doc.** It lives in **GitHub Issues**, reached via the GitHub MCP — see
   [`ci-cd/GITHUB_PM.md`](ci-cd/GITHUB_PM.md). A new initiative → an `[Epic]` parent issue with
   sub-issues. Don't track status in `docs/` or `spec/`.
5. **One canonical place per fact.** Elsewhere, link to it (path + heading). If two docs must
   summarize, one paragraph max, then link out. The gates enforce *where a fact lives* and *that a
   pointer resolves* — never that two prose statements of the same fact agree. Duplicating a fact is
   still how a wrong one spreads: in #1586 a single wrong timestamp reached five files in one commit
   because the list had been copied six times.

## Where things go

| Kind of change | Canonical home |
| -------------- | -------------- |
| Product behavior, rules, flows, invariants | `spec/behavior/<topic>.md` (or `<topic>/README.md` if it has 2+ files) |
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
| How to run locally / test / contribute | `docs/guides/` |
| Ops runbooks (DB, incidents, branch protection, deploy) | `docs/internal/ops/` |
| Documentation conventions and internal reference that is not a runbook | `docs/internal/` |
| CI / agent infra / automations | `docs/internal/ci-cd/` |
| Design-system (tokens, typography, icons, microcopy, accent engine) | `spec/ui/design-system/` |
| Mobile testing / smoke | `docs/internal/mobile/` |
| Accessibility / PR-review process | `docs/internal/quality/` |
| Env reference / secrets / local-dev / cloud sandbox / agent credentials | `docs/internal/environment/` |
| Security implementation notes / fixes log | `docs/internal/security/` |
| Visual design reference (committed design exports) | `spec/ui/design-system/reference/` |
| Per-service performance notes | `docs/internal/services/` |
| Per-optimization performance notes (one file per optimization) | `docs/performance/` |
| Data-layer hook conventions (query keys, chapter scope, optimistic mutations) | `docs/hooks/` |
| Work status / planning | **GitHub Issues** — not a doc; see [`ci-cd/GITHUB_PM.md`](ci-cd/GITHUB_PM.md) |
| Product-planning canvas (Buildpad export) | `.buildpad/` — **read-only background, never a doc home**; see below |
| In-flight consolidation scope + progress | `REFACTOR-PLAN.md` / `REFACTOR-PROGRESS.md` at repo root — **temporary scratch, never a doc home**; see below |

## Naming

**kebab-case `.md`, or `README.md`.** Enforced whole-tree by
[`scripts/check-docs-structure.mjs`](../../scripts/check-docs-structure.mjs).

There was no naming rule before 2026-09, and the corpus split along one seam: every
`SCREAMING_SNAKE_CASE` file lives under `docs/internal/`, while `docs/guides/`, `docs/performance/`
and every part of `spec/` were already kebab. Those remaining are grandfathered in the manifest's
`LEGACY_NAMES`, which is a **ratchet, not an amnesty**: an entry that no longer matches a tracked
file fails the gate, so a rename must delete its entry in the same commit and the list can only
shrink. Nothing new may be added to it.

`.dc.html` design exports under `spec/ui/design-system/reference/` are exempt — they are artifacts of
a design tool, not prose, and keep that tool's naming.

Renaming a doc is never just a rename: `check-doc-paths.mjs` and `check-doc-refs.mjs` are both
whole-tree and will fail on every citation the old name left behind, including citations in source
code that no other gate can see.

## Which doc a change belongs in

Most changes alter no documented fact and need no doc edit. When one does, the
question is never "did I touch a doc" but "which doc owns this fact" — the
placement map above answers it. Editing the wrong doc to look diligent is the
failure mode these conventions exist to prevent, not a lesser form of compliance.

## `.buildpad/` is background, not documentation

`.buildpad/` is a periodically-synced git export of the Buildpad product-planning canvas: `blobs/`
(research and audits), `documents/`, and `notes/`. It is committed so agents can read canvas research
straight off the filesystem instead of having documents pasted into a prompt — point prompts at a path
under `.buildpad/` rather than saying "I've attached X".

Treat it as a running brainstorm, not a source of truth:

1. **`spec/` wins.** The canvas can hold stale, superseded, or contradictory ideas — that is the nature
   of a brainstorm. Nothing in it is a decision until the owner says so
   ([`.buildpad/notes/process-note-everything-buildpad-and-claude-code.md`](../../.buildpad/notes/process-note-everything-buildpad-and-claude-code.md)).
   Where it disagrees with `spec/`, `spec/` is the contract.
2. **Never hand-edit it in a PR.** The next canvas sync overwrites it. A conclusion worth keeping gets
   promoted into its canonical `spec/` or `docs/` home from the map above.
3. **It is not documentation and cannot stand in for it.** A conclusion that matters gets promoted
   into its canonical `docs/` or `spec/` home; leaving it in the canvas leaves it stale by design.
4. **Source tooling skips it.** It holds no code, so the `Links`, `doc-paths` and docs-structure gates
   never walk it, and [`.prettierignore`](../../.prettierignore) keeps `npm run format` from rewriting
   the whole export into a diff the next sync would just undo.

## `REFACTOR-PLAN.md` / `REFACTOR-PROGRESS.md` are scratch, not documentation

Two tool-neutral files at repo root carry the scope and running state of the in-flight consolidation
project: `REFACTOR-PLAN.md` (per-item `file:line` inventories, shared homes, call sites, and the
cross-item collision map that keeps two parallel agents off the same file) and `REFACTOR-PROGRESS.md`
(one checkbox per item). They exist so each isolated agent gets exact scope instead of re-deriving it,
and they are **deleted when the project wraps**.

**Why this is not a hole in Hard rules 3 and 4.** Rule 3 bans one-off narrative markdown *in `docs/`
and `spec/`* — including migration plans — and rule 4 says work status lives in GitHub Issues. Both
still hold: these two files are at repo root, not under `docs/` or `spec/`, they are excluded from the
placement map rather than added to it, and they carry no work status. Item-level status, priority and
ownership stay in GitHub Issues; `REFACTOR-PROGRESS.md` records only whether a given agent run
finished its own scope, which is execution state a deleted file may lose harmlessly. An agent that
finds real work does not write it here — it files a `triage` issue.

The same rules as `.buildpad/` otherwise apply, with one difference that matters:

1. **`spec/` still wins.** A plan file records what the code looks like today and what an agent should
   do next. It is not a behavior contract.
2. **They are not documentation.** Editing one never stands in for updating the doc that owns a fact;
   they are short-lived scratch, and are deleted when the project wraps.
3. **A conclusion worth keeping gets promoted** into its canonical `spec/` or `docs/` home from the map
   above before the files are deleted.
4. **Delete this section and the placement-map row in the same PR that deletes the files.** Both are
   cited above as backticked `.md` paths inside `docs/`, which `check-doc-paths.mjs` walks — leaving
   the section behind turns the citation gate red on a doc nobody touched.

## See also

- Folder map: [`docs/README.md`](../README.md)
- Docs gate behavior: [`ci-cd/DOCS_CI.md`](ci-cd/DOCS_CI.md)
- Work tracking (GitHub Issues): [`ci-cd/GITHUB_PM.md`](ci-cd/GITHUB_PM.md) · ADR-16 in [`../../spec/architecture/README.md`](../../spec/architecture/README.md)
