# Docs/spec CI gate

## What runs

On pull requests to `main` and `production`, `.github/workflows/docs.yml` (workflow display name
**Docs spec sync**) runs **two jobs** covering **three** checks. They are separate on purpose: each
asserts one thing, and each fails with a different fix.

| Check | Script | Asserts | Scope | Job | Required? |
|---|---|---|---|---|---|
| Sync | [`check-docs-impact.mjs`](../../../scripts/check-docs-impact.mjs) | A PR touching non-doc files also touches `docs/` or `spec/` | PR diff | `docs-spec-sync` | **Yes** |
| Structure | [`check-docs-structure.mjs`](../../../scripts/check-docs-structure.mjs) | Newly **added** paths sit in allowed locations | Added/renamed paths in the diff | `docs-spec-sync` | **Yes** (same job) |
| Citations | [`check-doc-paths.mjs`](../../../scripts/check-doc-paths.mjs) | Backticked repo-path citations resolve to real files | Whole tree | `doc-paths` | Not yet — see rollout below |

`docs-spec-sync` is a required check under `enforce_admins: true`, registered via the `DOCS_CHECKS`
array in [`scripts/configure-branch-protection.mjs`](../../../scripts/configure-branch-protection.mjs)
— a **separate array** from `CI_CHECKS` in the same file, which is easy to miss when grepping.

**Sync** is intentionally simple: if the PR modifies **any** path **not** under `docs/` or `spec/`,
it must **also** modify **at least one** path under **either** prefix. So a single edit under
`docs/guides/`, `docs/internal/`, or `spec/` satisfies it for a product-code change. It does **not**
require a specific subtree (e.g. it does not yet require `spec/` for API-only changes). Two narrow
exemptions cut through that, below.

Pure helpers (`classifyChanges`, `NON_CODE_PREFIXES`) are exported for
`scripts/ci/__tests__/check-docs-impact.test.mjs`, run by the `ci-scripts-tests` job.

### Exemptions

`docs-spec-sync` is **required** under `enforce_admins: true`, so a category of PR that can never
satisfy it is not merely red — it is permanently unmergeable, with no override. Both exemptions exist
for that reason, and each is deliberately narrow.

| Exempt | Where | Why |
|---|---|---|
| Dependabot PRs | Workflow condition on the *step*, in both [`docs.yml`](../../../.github/workflows/docs.yml) and [`ci.yml`](../../../.github/workflows/ci.yml) | A bump touches `package.json` / `package-lock.json` and nothing else. Skipping the **step**, never the job, keeps the required check reporting — a skipped job never reports, leaving the PR blocked on a check that never arrives. |
| `.buildpad/**` | `NON_CODE_PREFIXES` in [`check-docs-impact.mjs`](../../../scripts/check-docs-impact.mjs) | The canvas export is neither code nor documentation, so it has no docs impact to sync. Every periodic sync would otherwise land as "N non-doc files changed, no docs updated". |

The `.buildpad/` exemption **ignores** those paths; it does not treat them as documentation. A PR that
edits code *and* `.buildpad/` still owes a `docs/` or `spec/` edit, and the failure output names only
the real code changes. What the directory is, and why it is not a doc home:
[`DOCUMENTATION_CONVENTIONS.md`](../DOCUMENTATION_CONVENTIONS.md#buildpad-is-background-not-documentation).

`.claude/` is **not** exempt — a `SKILL.md`-only PR still fails the gate and must be paired with a
`docs/` file. [#810](https://github.com/pdcarlson/Frapp/issues/810) tracks teaching the gate about it;
[`ROUTINES.md`](ROUTINES.md#maintenance) records the workaround until then.

**Structure** only ever looks at paths a PR *adds* or renames — existing files are never flagged —
so it stops the sync gate from being satisfied by dropping a stray file. Placement rules live in
[`DOCUMENTATION_CONVENTIONS.md`](../DOCUMENTATION_CONVENTIONS.md).

### Citations (`check-doc-paths.mjs`)

This covers the blind spot in the **`Links`** workflow. lychee validates markdown links and heading
anchors; it never sees a file cited as inline code — `` `apps/api/src/main.ts` `` — which is how
these docs overwhelmingly cite the repo. Those citations rot silently when a file moves.

- **Scope:** `docs/`, `spec/`, every `AGENTS.md`, `.claude/skills/**/*.md`, and root `README.md` /
  `CONTRIBUTING.md`. Skills and `AGENTS.md` are included because a wrong path there misroutes an
  agent before a human reads it. `spec/ui/design-system/reference/` is excluded, matching the
  `Links` gate's exclusion of the same directory.
- **Whole-tree, not diff-based.** A citation breaks when the file it names moves — a change on the
  *other* side of the reference — so a diff-scoped check would miss the case it exists to catch.
- **Resolution** is tried three ways: repo root, the citing file's own directory, and a
  trailing-segment match (so a bare `main.ts` legitimately names `apps/api/src/main.ts`). When
  exactly one tracked file shares the basename, the failure names it: *"did it move to …?"*.
- **Noise** — globs, `<placeholders>`, fenced code blocks, prose elisions — is skipped by heuristic,
  not by allowlist.

**Deliberate dead references** — a removals/renames table, an ADR amendment naming a deleted file —
go in [`scripts/doc-paths-allowlist.json`](../../../scripts/doc-paths-allowlist.json). Entries are
scoped `perFile` by preference, since a dead path that is deliberate in one doc is usually a real bug
in another, and **every entry requires a `reason`** (the script exits 2 without one). Entries that
stop matching anything **fail the check**, so the allowlist shrinks as docs get fixed rather than
accumulating stale excuses.

Run locally: `npm run check:doc-paths`. Unit tests: `scripts/ci/__tests__/check-doc-paths.test.mjs`,
covered by the `ci-scripts-tests` job.

**Rollout.** `doc-paths` reports on every PR but is **not** merge-blocking yet. Because it is
whole-tree, making it required means a PR that renames a source file can be blocked by a citation in
a doc it never touched — a real trade worth accepting deliberately rather than by default. To
promote it, uncomment `"doc-paths"` in `DOCS_CHECKS` and re-run
`npm run configure:branch-protection` once the job has run green on the target branch (the same
rollout `secret-scan`, `clean-checkout-typecheck`, `dependency-audit` and `chapter-directory-seed`
each went through).

### What none of these check

Whether a doc's **claims** are still true. All three are structural — they check that files exist
and that edits happened, not that a sentence is accurate. A doc can pass every gate here and still
be confidently wrong, or be accurate and still mislead (two correct tables on one topic, far apart,
with no cross-reference). That judgement half is the
[`check-our-docs`](../../../.claude/skills/check-our-docs/SKILL.md) skill, invoked while coding —
before you act on what a doc told you.

## Why keep it broad

- Cheap to implement and explain; hard to game with accidental omissions of entire prefixes.
- Forces an explicit doc/spec touch for almost every non-doc change, which was an early goal when doc discipline was weak.

## Trade-offs

- **Noise:** Mechanical edits (e.g. `AGENTS.md` at repo root) still need a `docs/` or `spec/` touch unless the PR is docs-only in a sense the script does not recognize (root-level `.md` files are _not_ exempt).
- **Ambiguity:** Contributors should default to [`docs/guides/`](../../guides/README.md) and `spec/` for product-code PRs; there is no `apps/docs` workspace. Where to put updates: [`DOCUMENTATION_CONVENTIONS.md`](../DOCUMENTATION_CONVENTIONS.md).

## Optional future tightening (not implemented)

If the team wants less noise or stricter mapping:

- **Path-based rules:** e.g. changes under `apps/api/**` must touch `spec/` or `docs/**` matching an allowlist.
- **Labels:** e.g. maintainer-only `skip-docs-check` with mandatory justification (easy to abuse; needs culture + review).
- **Changelog:** allow a single audited file to count as the doc touch (still easy to make meaningless updates).

Any change to the script should update this file, `AGENTS.md`, and the PR template so agents and humans share one story.

## Maintenance Log
* Added unit tests for React Query Backwork hooks (`packages/hooks/src/use-backwork.spec.tsx`).
* Backwork hooks tests: microtask flush before asserting `enabled: false` (empty id) does not call `GET`; shared `queryKey` constants for invalidation expectations.
* Root `package-lock.json`: npm v10+ `peer: true` metadata on peer dependency entries (no dependency version changes).
