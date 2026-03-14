#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/pr-consolidation-helper.sh --canonical-pr-number <number> [--apply]

Description:
  Helps execute PR consolidation steps after the canonical PR is opened.
  By default, prints the gh commands (dry run). Use --apply to execute them.

Required:
  --canonical-pr-number <number>  The opened canonical PR number.

Optional:
  --apply                         Execute commands instead of printing.

Examples:
  scripts/pr-consolidation-helper.sh --canonical-pr-number 34
  scripts/pr-consolidation-helper.sh --canonical-pr-number 34 --apply
EOF
}

CANONICAL_PR_NUMBER=""
APPLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --canonical-pr-number)
      if [[ $# -lt 2 || -z "${2:-}" || "${2:-}" == -* ]]; then
        echo "Error: --canonical-pr-number requires a value." >&2
        usage
        exit 1
      fi
      CANONICAL_PR_NUMBER="${2:-}"
      shift 2
      ;;
    --apply)
      APPLY=true
      shift
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
  echo "Error: --canonical-pr-number is required." >&2
  usage
  exit 1
fi

if ! [[ "$CANONICAL_PR_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "Error: --canonical-pr-number must be numeric." >&2
  exit 1
fi

CANONICAL_PR_URL="$(gh pr view "$CANONICAL_PR_NUMBER" --json url --jq '.url')"
REDIRECT_MSG="Superseded by canonical implementation PR: ${CANONICAL_PR_URL}. This is now the single review source of truth."

run_or_print() {
  if [[ "$APPLY" == "true" ]]; then
    echo "+ $*"
    "$@"
  else
    printf '%q ' "$@"
    echo
  fi
}

if [[ "$APPLY" == "true" ]]; then
  echo "Executing consolidation commands for canonical PR #${CANONICAL_PR_NUMBER}..."
else
  echo "Dry run. Use --apply to execute."
  echo "Canonical PR URL: ${CANONICAL_PR_URL}"
  echo
fi

for pr in 30 31 32 33; do
  if [[ "$pr" == "$CANONICAL_PR_NUMBER" ]]; then
    continue
  fi
  run_or_print gh pr close "$pr" --comment "$REDIRECT_MSG"
done
run_or_print gh pr checks "$CANONICAL_PR_NUMBER"
run_or_print gh pr view "$CANONICAL_PR_NUMBER"
run_or_print gh pr list --state open
