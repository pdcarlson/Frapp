# Docs/spec CI gate

## What runs

On pull requests to `main` and `production`, `.github/workflows/docs.yml` (workflow display name **Docs spec sync**; required check-run id **`docs-spec-sync`**) runs `scripts/check-docs-impact.mjs` (after a full clone). The rule is intentionally simple:

- If the PR modifies **any** path **not** under `docs/` or `spec/`, the PR must **also** modify **at least one** path under **either** prefix.

So a single edit under `docs/guides/`, `docs/internal/`, or `spec/` satisfies the gate for a product-code change. The check does **not** require a specific subtree (e.g. it does not yet require `spec/` for API-only changes).

## Why keep it broad

- Cheap to implement and explain; hard to game with accidental omissions of entire prefixes.
- Forces an explicit doc/spec touch for almost every non-doc change, which was an early goal when doc discipline was weak.

## Trade-offs

- **Noise:** Mechanical edits (e.g. `AGENTS.md` at repo root) still need a `docs/` or `spec/` touch unless the PR is docs-only in a sense the script does not recognize (root-level `.md` files are _not_ exempt).
- **Ambiguity:** Contributors should default to [`docs/guides/`](../guides/README.md) and `spec/` for product-code PRs; there is no `apps/docs` workspace. Where to put updates: [`DOCUMENTATION_CONVENTIONS.md`](DOCUMENTATION_CONVENTIONS.md).

## Optional future tightening (not implemented)

If the team wants less noise or stricter mapping:

- **Path-based rules:** e.g. changes under `apps/api/**` must touch `spec/` or `docs/**` matching an allowlist.
- **Labels:** e.g. maintainer-only `skip-docs-check` with mandatory justification (easy to abuse; needs culture + review).
- **Changelog:** allow a single audited file to count as the doc touch (still easy to make meaningless updates).

Any change to the script should update this file, `AGENTS.md`, and the PR template so agents and humans share one story.
