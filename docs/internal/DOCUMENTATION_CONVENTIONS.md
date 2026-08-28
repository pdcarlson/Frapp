# Documentation conventions — placement map

The **authoritative** guide to where docs/spec changes go. Read this before adding or moving any doc.
The goal: keep `docs/` and `spec/` clean and navigable, and stop the structure from drifting when
agents satisfy the docs-sync CI gate. Enforced (in part) by [`scripts/check-docs-structure.mjs`](../../scripts/check-docs-structure.mjs).

## Hard rules

1. **Never create a new top-level file** in `docs/` or `spec/`, and never invent a new top-level
   folder. Put the change in the **relevant existing** doc/spec (see the map below).
2. **Satisfy the docs-sync gate by updating the relevant doc — never by dropping a stray file, and
   never by appending a stray section to an unrelated one.** `scripts/check-docs-impact.mjs` only
   checks that *some* doc/spec changed; it is on you to edit the *right* one. When the honest answer
   is that nothing needs syncing, label the PR `no-doc-change-needed`
   ([`ci-cd/DOCS_CI.md`](ci-cd/DOCS_CI.md#the-no-doc-change-needed-waiver)) — that is the expected
   path for a mechanical change, and it beats parking an unowned paragraph in a canonical doc.
3. **Do not generate one-off narrative markdown** (audits, PR-consolidation writeups, "NOTES",
   "STATUS", thread-resolution maps, migration plans). That kind of file is what this restructure
   removed. Durable facts go in the canonical doc; ephemeral work goes into **GitHub Issues** (file a `triage`-labeled issue).
4. **Work status is not a doc.** It lives in **GitHub Issues**, reached via the GitHub MCP — see
   [`ci-cd/GITHUB_PM.md`](ci-cd/GITHUB_PM.md). A new initiative → an `[Epic]` parent issue with
   sub-issues. Don't track status in `docs/` or `spec/`.
5. **One canonical place per fact.** Elsewhere, link to it (path + heading). If two docs must
   summarize, one paragraph max, then link out.

## Where things go

| Kind of change | Canonical home |
| -------------- | -------------- |
| Product behavior, rules, flows, invariants | `spec/behavior/<topic>.md` (or `<topic>/README.md` if it has 2+ files) |
| Product features, surfaces, positioning, module catalog | `spec/product/` |
| Architecture, data model, API patterns, ADRs | `spec/architecture/README.md` — ADRs are append-only (amend or supersede, never rewrite) |
| Engineering principles | `spec/engineering.md` |
| Environments, CI/CD model | `spec/environments/README.md` |
| UI requirements (design system, web, landing, mobile, brand, assets, resilience) | `spec/ui/` |
| How to run locally / test / contribute | `docs/guides/` |
| Ops runbooks (DB, incidents, branch protection, deploy) | `docs/internal/ops/` |
| CI / agent infra / automations | `docs/internal/ci-cd/` |
| Design-system (tokens, typography, icons, microcopy, accent engine) | `spec/ui/design-system/` |
| Mobile testing / smoke | `docs/internal/mobile/` |
| Accessibility / PR-review process | `docs/internal/quality/` |
| Env reference / secrets / local-dev / cloud sandbox / agent credentials | `docs/internal/environment/` |
| Security implementation notes / fixes log | `docs/internal/security/` |
| Visual design reference (committed design exports) | `spec/ui/design-system/reference/` |
| Per-service performance notes | `docs/internal/services/` |
| Work status / planning | **GitHub Issues** — not a doc; see [`ci-cd/GITHUB_PM.md`](ci-cd/GITHUB_PM.md) |
| Product-planning canvas (Buildpad export) | `.buildpad/` — **read-only background, never a doc home**; see below |
| In-flight consolidation scope + progress | `REFACTOR-PLAN.md` / `REFACTOR-PROGRESS.md` at repo root — **temporary scratch, never a doc home**; see below |

## Satisfying the docs-sync gate (`scripts/check-docs-impact.mjs`)

It fails when a PR changes a path outside `docs/`/`spec/` without also changing at least one path under
them. Pick the **relevant** canonical home above:

- **API / domain:** `spec/architecture/README.md` and/or the topic under `spec/behavior/`; add a
  contributor note in `docs/guides/api-architecture.md` or `database.md` only if needed.
- **UI:** the relevant file under `spec/ui/` (design-system rules live in `spec/ui/design-system/`).
- **Infra / CI:** `spec/environments/README.md` and/or `docs/internal/ci-cd/`, or a focused ops runbook.
- **Mechanical / non-user-visible:** usually there is nothing to sync. Label the PR
  `no-doc-change-needed` (hard rule 2) rather than writing a note. Only add prose if the change
  really does alter something an existing doc asserts — and then it goes in *that* doc, not the
  nearest one.

Root-level files like `AGENTS.md` / `CONTRIBUTING.md` count as outside `docs/`/`spec/` and still need a
`docs/` or `spec/` change in the same PR when edited. The one prefix the script ignores outright is
`.buildpad/` — see the next section.

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
3. **It cannot satisfy the docs-sync gate**, and cannot fail it either: `check-docs-impact.mjs` ignores
   the prefix entirely, so a canvas-sync PR passes on its own while a PR that edits code *and*
   `.buildpad/` still owes a `docs/` or `spec/` edit. Mechanics:
   [`ci-cd/DOCS_CI.md`](ci-cd/DOCS_CI.md#exemptions).
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
2. **They are not exempt from the docs-sync gate.** Unlike `.buildpad/`, root-level paths are not in
   `NON_CODE_PREFIXES`, so a PR that edits either file still owes a `docs/` or `spec/` change —
   editing them cannot satisfy the gate either. That is deliberate: they are short-lived, and
   exempting a root path would weaken a gate required under `enforce_admins: true`.
3. **A conclusion worth keeping gets promoted** into its canonical `spec/` or `docs/` home from the map
   above before the files are deleted.
4. **Delete this section and the placement-map row in the same PR that deletes the files.** Both are
   cited above as backticked `.md` paths inside `docs/`, which `check-doc-paths.mjs` walks — leaving
   the section behind turns the citation gate red on a doc nobody touched.

## See also

- Folder map: [`docs/README.md`](../README.md)
- Docs gate behavior: [`ci-cd/DOCS_CI.md`](ci-cd/DOCS_CI.md)
- Work tracking (GitHub Issues): [`ci-cd/GITHUB_PM.md`](ci-cd/GITHUB_PM.md) · ADR-16 in [`../../spec/architecture/README.md`](../../spec/architecture/README.md)
