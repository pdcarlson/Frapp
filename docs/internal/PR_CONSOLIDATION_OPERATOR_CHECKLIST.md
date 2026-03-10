# PR Consolidation Operator Checklist

> Purpose: execute the remaining administrative consolidation steps that cannot be performed from a read-only GitHub CLI environment.

## Preconditions

- Branch `c/mobile-ui-ux-quality-plan-29ef` is up to date on origin.
- Canonical PR body draft is available at:
  - `docs/internal/PR_CONSOLIDATION_CANONICAL_PR_BODY.md`
- Thread mapping and closure note snippets are available at:
  - `docs/internal/MOBILE_THREAD_RESOLUTION_MAP.md`

## Step 1 — Open canonical PR

Create PR from:

- **head:** `c/mobile-ui-ux-quality-plan-29ef`
- **base:** `preview`

Title recommendation:

- `feat(ui): consolidate mobile/web UX remediation into canonical PR`

Body:

- Copy from `docs/internal/PR_CONSOLIDATION_CANONICAL_PR_BODY.md`.

Suggested command (maintainer/write-capable environment):

```bash
gh pr create \
  --base preview \
  --head c/mobile-ui-ux-quality-plan-29ef \
  --title "feat(ui): consolidate mobile/web UX remediation into canonical PR" \
  --body-file docs/internal/PR_CONSOLIDATION_CANONICAL_PR_BODY.md
```

Optional helper:

```bash
# After the canonical PR is opened, use this helper to print/execute
# the close + verification sequence.
scripts/pr-consolidation-helper.sh --canonical-pr-number <NEW_PR_NUMBER>
scripts/pr-consolidation-helper.sh --canonical-pr-number <NEW_PR_NUMBER> --apply
```

## Step 2 — Close superseded/stale PRs with redirect note

After canonical PR is open, close these PRs in this order:

1. `#30` (stale draft)
2. `#32` (stale draft)
3. `#33` (stale draft)
4. `#31` (superseded mega-PR)

For each closure, include:

- direct link to canonical PR,
- one-line statement that canonical PR is the single review source of truth.

Suggested command sequence:

```bash
# Replace <NEW_PR_URL> with the canonical PR URL returned by gh pr create.
gh pr close 30 --comment "Closing during PR consolidation. Superseded by canonical implementation PR: <NEW_PR_URL>."
gh pr close 32 --comment "Closing during PR consolidation. Superseded by canonical implementation PR: <NEW_PR_URL>."
gh pr close 33 --comment "Closing during PR consolidation. Superseded by canonical implementation PR: <NEW_PR_URL>."
gh pr close 31 --comment "Closing as superseded by canonical implementation PR: <NEW_PR_URL>. This is now the single review source of truth for this UX remediation scope."
```

## Step 3 — Post-open verification gate

Validate the canonical PR has full review/CI context:

- Required checks are queued and running.
- Review description includes:
  - blocker fix summary,
  - theme parity summary,
  - interaction and icon docs links,
  - test evidence (lint/types/visual/manual walkthrough).
- Old PRs are closed and no longer active review sources.

Suggested verification commands:

```bash
# Replace <NEW_PR_NUMBER> with the canonical PR number.
gh pr checks <NEW_PR_NUMBER>
gh pr view <NEW_PR_NUMBER>
gh pr list --state open
```

Optional helper:

```bash
# Auto-detect canonical PR by head branch and run phase-4 checks.
scripts/verify-pr-consolidation.sh

# Or explicitly target a PR number.
scripts/verify-pr-consolidation.sh --pr-number <NEW_PR_NUMBER>
```

## Step 4 — Completion criteria

Consolidation is complete only when:

- Exactly one active implementation PR remains for this workstream.
- Canonical PR has the required evidence and check coverage.
- Superseded/stale PRs include redirect notes to canonical PR.
