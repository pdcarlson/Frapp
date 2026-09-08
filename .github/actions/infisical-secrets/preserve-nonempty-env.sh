#!/usr/bin/env bash
# Snapshot named env vars, then after Infisical injection restore any that
# came back empty. The production backup jobs inject Infisical `staging`
# (offsite destination) then `prod` (source). ENV_REFERENCE documents prod
# Infisical inject exports empty keys as empty GITHUB_ENV values, which would wipe the
# staging destination. Non-empty prod values still win (separate-bucket
# target). Never prints secret values.
set -euo pipefail

usage() {
  echo "usage: $0 snapshot|restore" >&2
  exit 2
}

cmd="${1:-}"
if [ "$cmd" != "snapshot" ] && [ "$cmd" != "restore" ]; then
  usage
fi

NAMES_CSV="${PRESERVE_NONEMPTY:-}"
DIR="${PRESERVE_SNAPSHOT_DIR:-${RUNNER_TEMP:-/tmp}/infisical-preserve}"

if [ -z "$NAMES_CSV" ]; then
  echo "PRESERVE_NONEMPTY is empty; nothing to ${cmd}."
  exit 0
fi

names=()
IFS=',' read -ra RAW <<< "$NAMES_CSV"
for raw in "${RAW[@]}"; do
  name="${raw//[[:space:]]/}"
  [ -z "$name" ] && continue
  if [[ ! "$name" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
    echo "::error::preserve-nonempty name is not a safe env identifier." >&2
    exit 1
  fi
  names+=("$name")
done

if [ "${#names[@]}" -eq 0 ]; then
  echo "PRESERVE_NONEMPTY parsed to no names; nothing to ${cmd}."
  exit 0
fi

if [ "$cmd" = "snapshot" ]; then
  rm -rf "$DIR"
  mkdir -p "$DIR"
  for name in "${names[@]}"; do
    printf '%s' "${!name-}" > "$DIR/$name"
  done
  echo "Snapshotted ${#names[@]} env name(s) to restore if this injection blanks them."
  exit 0
fi

if [ ! -d "$DIR" ]; then
  echo "::error::preserve-nonempty snapshot directory is missing; the snapshot step did not run." >&2
  exit 1
fi

github_env="${GITHUB_ENV:-}"
if [ -z "$github_env" ]; then
  echo "::error::GITHUB_ENV is unset; cannot restore preserved env names." >&2
  exit 1
fi

restored=0
for name in "${names[@]}"; do
  file="$DIR/$name"
  if [ ! -f "$file" ]; then
    echo "::error::preserve-nonempty snapshot file is missing." >&2
    exit 1
  fi
  prev="$(cat "$file")"
  current="${!name-}"
  if [ -z "$current" ] && [ -n "$prev" ]; then
    delim="PRESERVE_EOF_${RANDOM}${RANDOM}${RANDOM}"
    {
      printf '%s<<%s\n' "$name" "$delim"
      printf '%s\n' "$prev"
      printf '%s\n' "$delim"
    } >> "$github_env"
    echo "Restored ${name} from the previous injection (this environment left it empty)."
    restored=$((restored + 1))
  fi
done
echo "preserve-nonempty restore complete; restored ${restored} of ${#names[@]} name(s)."
