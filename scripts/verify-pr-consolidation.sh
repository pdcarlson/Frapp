#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/verify-pr-consolidation.sh [--pr-number <number>] [--head-branch <branch>]

Description:
  Verifies post-open consolidation status for the canonical PR and reports
  whether phase-4 acceptance checks are satisfied.

Options:
  --pr-number <number>     Canonical PR number. If omitted, auto-detect from head branch.
  --head-branch <branch>   Head branch to auto-detect canonical PR (default: c/mobile-ui-ux-quality-plan-29ef).

Examples:
  scripts/verify-pr-consolidation.sh
  scripts/verify-pr-consolidation.sh --pr-number 34
EOF
}

CANONICAL_PR_NUMBER=""
HEAD_BRANCH="c/mobile-ui-ux-quality-plan-29ef"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr-number)
      CANONICAL_PR_NUMBER="${2:-}"
      shift 2
      ;;
    --head-branch)
      HEAD_BRANCH="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$CANONICAL_PR_NUMBER" ]]; then
  CANONICAL_PR_NUMBER="$(gh pr list --state open --head "$HEAD_BRANCH" --json number --jq '.[0].number // empty')"
fi

if [[ -z "$CANONICAL_PR_NUMBER" ]]; then
  echo "❌ Canonical PR is not open yet for head branch: $HEAD_BRANCH"
  exit 2
fi

echo "Canonical PR detected: #$CANONICAL_PR_NUMBER"

CANONICAL_PR_JSON="$(gh pr view "$CANONICAL_PR_NUMBER" --json number,url,title,headRefName,baseRefName,state,body)"
CANONICAL_PR_URL="$(jq -r '.url' <<<"$CANONICAL_PR_JSON")"
CANONICAL_BASE="$(jq -r '.baseRefName' <<<"$CANONICAL_PR_JSON")"
CANONICAL_HEAD="$(jq -r '.headRefName' <<<"$CANONICAL_PR_JSON")"
CANONICAL_STATE="$(jq -r '.state' <<<"$CANONICAL_PR_JSON")"
CANONICAL_BODY="$(jq -r '.body' <<<"$CANONICAL_PR_JSON")"

echo "URL: $CANONICAL_PR_URL"
echo "Head/Base: $CANONICAL_HEAD -> $CANONICAL_BASE"
echo "State: $CANONICAL_STATE"
echo

if [[ "$CANONICAL_BASE" != "preview" ]]; then
  echo "❌ Canonical PR base is '$CANONICAL_BASE' (expected 'preview')."
  exit 3
fi

if [[ "$CANONICAL_STATE" != "OPEN" ]]; then
  echo "❌ Canonical PR state is '$CANONICAL_STATE' (expected 'OPEN')."
  exit 4
fi

declare -a REQUIRED_BODY_SNIPPETS=(
  "Blocker fixes"
  "Theme parity"
  "Interaction QA"
  "Icon intent"
  "Test evidence"
)

for snippet in "${REQUIRED_BODY_SNIPPETS[@]}"; do
  if ! grep -qi "$snippet" <<<"$CANONICAL_BODY"; then
    echo "❌ Canonical PR body is missing expected section text: $snippet"
    exit 5
  fi
done

echo "✅ Canonical PR body includes required section text checks."
echo

for pr in 30 31 32 33; do
  state="$(gh pr view "$pr" --json state --jq '.state')"
  if [[ "$pr" == "$CANONICAL_PR_NUMBER" ]]; then
    continue
  fi
  if [[ "$state" == "OPEN" ]]; then
    echo "❌ PR #$pr is still OPEN; expected closed during consolidation."
    exit 6
  fi
done

echo "✅ Superseded/stale PRs are closed."
echo

echo "Running check status for canonical PR..."
set +e
gh pr checks "$CANONICAL_PR_NUMBER"
CHECKS_EXIT_CODE=$?
set -e

if [[ "$CHECKS_EXIT_CODE" -eq 8 ]]; then
  echo
  echo "ℹ️ Checks are still pending. Re-run this script when CI completes."
  exit "$CHECKS_EXIT_CODE"
elif [[ "$CHECKS_EXIT_CODE" -ne 0 ]]; then
  echo
  echo "❌ Unable to read canonical PR checks (exit code: $CHECKS_EXIT_CODE)."
  exit "$CHECKS_EXIT_CODE"
fi

echo
echo "✅ Consolidation verification checks completed."
