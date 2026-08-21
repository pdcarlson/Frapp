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
satisfy it is not merely red — it is permanently unmergeable, with no override. All three exemptions
exist for that reason.

The label is the one you are most likely to need, and reaching for it is **not** a failure of
discipline — see below.

| Exempt | Where | Why |
|---|---|---|
| Dependabot PRs | Workflow condition on the *step*, in [`docs.yml`](../../../.github/workflows/docs.yml) | A bump touches `package.json` / `package-lock.json` and nothing else. Skipping the **step**, never the job, keeps the required check reporting — a skipped job never reports, leaving the PR blocked on a check that never arrives. |
| `.buildpad/**` | `NON_CODE_PREFIXES` in [`check-docs-impact.mjs`](../../../scripts/check-docs-impact.mjs) | The canvas export is neither code nor documentation, so it has no docs impact to sync. Every periodic sync would otherwise land as "N non-doc files changed, no docs updated". |
| PRs labelled `no-doc-change-needed` | `EXEMPT_LABEL` in [`check-docs-impact.mjs`](../../../scripts/check-docs-impact.mjs) | A change with genuinely no docs impact — a pure-code consolidation, a lint fix, a formatting-only sweep — cannot satisfy the gate, and the gate is required, so it would be unmergeable rather than merely red. **This is the expected answer for a mechanical PR, not a last resort.** |

#### The `no-doc-change-needed` waiver

**Reach for this whenever your change genuinely has no docs impact.** The gate cannot tell a
relevant doc edit from an irrelevant one — it only checks that *some* path under `docs/` or `spec/`
moved (`const DOCS_OR_SPEC = ["docs/", "spec/"]`). So when a PR has nothing real to sync, there are
exactly two ways through, and they are not equally good:

- **Label it.** One reviewable act, visible in the timeline, annotated in the run summary.
- **Append something to a doc so the check goes green.** This passes, and it is worse than the
  failure it avoids. It puts a sentence nobody owns into a doc's canonical home, where the next
  reader has no way to tell it from a maintained claim, and it grows a corpus that already has no
  mechanism for retiring anything.

That second path is not hypothetical, and until this change **this file** carried the proof: a
`## Maintenance Log` sat at the bottom of it, holding three bullets about React Query hook tests
and `package-lock` peer metadata — notes that were perfectly true and had nothing to do with the
docs gate this document describes. It has been deleted.
[`diff-review`](../../../.claude/skills/diff-review/SKILL.md) now names that shape as a review
finding.

So: **if the honest answer is "this PR changes nothing a doc describes", the honest action is the
label.** A waived run is a better artifact than a green one bought with filler.

Applying it needs **write access**, so it is not a self-serve bypass for an outside contributor, and it
lands in the PR timeline as a named, reviewable act rather than a silent skip. The gate still **runs**
and still **prints the paths it would have required a doc for**, so what was waived is auditable from
the check's log, not just from the label.

Two mechanics make it work, and both are easy to get wrong:

- **The trigger.** `docs.yml` listens for `labeled`/`unlabeled` on top of the default
  `opened`/`synchronize`/`reopened`. Without them the label would be applied, nothing would re-run, the
  stale red conclusion would stand, and the PR would still be blocked. A waiver has to be able to
  re-run the check it waives.
- **The single home.** The same script used to run a second time as a step inside `ci.yml`'s
  `lint-and-typecheck` — itself a required check — so honouring the label would have meant giving
  `ci.yml` the same `labeled` trigger and re-running the entire suite, Docker build included, on every
  label mutation on every PR. The duplicate was removed instead. **The sync gate now has exactly one
  home: `docs.yml`.** The copies had already drifted once (only `docs.yml` carried the Dependabot
  exemption), which is the other half of the argument for keeping one.

Labels reach the script through `env:` (`PR_LABELS_JSON`, as `toJSON(...)`), never interpolated into
the `run:` string — a label is free-form text and would otherwise be shell-executable. An absent or
malformed value is treated as *no labels*, so a parse failure leaves the gate enforced rather than
silently waived.

A waived run also emits a `::warning::` annotation, so it shows up in the run summary and the Checks
UI rather than rendering as an ordinary green check — the label alone is easy to miss among the
routine `area:*` / `P2` / `in-review` labels every PR carries.

The label does not exist in the repo's label set until it is first applied; create it under
**Issues → Labels**, or type the name when applying it to a PR.

**Locally**, `npm run ci:local-gate` runs the same script and inherits the environment, so the waiver
works there too:

```sh
PR_LABELS_JSON='["no-doc-change-needed"]' npm run ci:local-gate
```

This matters more than it looks: the docs check runs **first** in that gate and a failure aborts the
whole run, so without the waiver a pure-code PR never reaches lint, type-check, the API tests, the
npm-audit gate, or the gitleaks scan. The failure output names this command.

The `.buildpad/` exemption **ignores** those paths; it does not treat them as documentation. A PR that
edits code *and* `.buildpad/` still owes a `docs/` or `spec/` edit, and the failure output names only
the real code changes. What the directory is, and why it is not a doc home:
[`DOCUMENTATION_CONVENTIONS.md`](../DOCUMENTATION_CONVENTIONS.md#buildpad-is-background-not-documentation).

`.claude/` is **not** exempt — a `SKILL.md`-only PR still fails the gate. Pair it with the `docs/`
file that states the same rule (usually the right move anyway), or label it `no-doc-change-needed`
when there genuinely is none. [#810](https://github.com/pdcarlson/Frapp/issues/810) tracks teaching the gate about it;
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

That last point is also the gate's failure mode, and it is worth stating plainly: a check that
demands a doc edit from *every* PR will get one from every PR, including the PRs with nothing to
say. Breadth buys coverage and pays for it in filler. The label is what keeps the bill down, which
is why it is documented above as the expected path rather than an escape hatch.

## Trade-offs

- **Noise:** Mechanical edits (e.g. `AGENTS.md` at repo root) still need a `docs/` or `spec/` touch unless the PR is docs-only in a sense the script does not recognize (root-level `.md` files are _not_ exempt). When there is no real doc to sync, label the PR `no-doc-change-needed` rather than inventing one.
- **Ambiguity:** Contributors should default to [`docs/guides/`](../../guides/README.md) and `spec/` for product-code PRs; there is no `apps/docs` workspace. Where to put updates: [`DOCUMENTATION_CONVENTIONS.md`](../DOCUMENTATION_CONVENTIONS.md).

## Optional future tightening (not implemented)

If the team wants less noise or stricter mapping:

- **Path-based rules:** e.g. changes under `apps/api/**` must touch `spec/` or `docs/**` matching an allowlist. Considered as the alternative to the label waiver and rejected for that purpose: a pure-code consolidation moves code *inside* `apps/*/src/**` and `packages/*/src/**`, the very paths any sane allowlist includes, so path-scoping never unblocks the case the waiver exists for. Still worth doing on its own merits, as noise reduction.
- **Changelog:** allow a single audited file to count as the doc touch (still easy to make meaningless updates).

Any change to the script should update this file, `AGENTS.md`, and the PR template so agents and humans share one story.
