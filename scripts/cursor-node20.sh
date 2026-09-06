#!/usr/bin/env bash
# Run a command under the repo's pinned Node 20 (Cursor Cloud Agent helper).
#
# WHY THIS EXISTS. The Cursor Cloud base image ships Node 22 as `/exec-daemon/node`,
# and that directory is injected at the FRONT of PATH by the shell wrapper — ahead of
# nvm — so a bare `nvm use 20` changes `npm` but NOT `node` (which stays 22). This repo
# pins Node 20 everywhere (apps/api/Dockerfile `node:20-alpine`, every CI job's
# `node-version: 20`), and Node 22's stricter `ERR_REQUIRE_CYCLE_MODULE` breaks the Nest
# CLI (`nest start` -> @angular-devkit/schematics -> ESM `ora` in a require cycle). So the
# only reliable way to get Node 20 for the app processes is to prepend nvm's Node 20 bin
# explicitly, which is what this wrapper does before exec-ing the command.
#
#   Usage: bash scripts/cursor-node20.sh <command> [args...]
set -uo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
fi

if command -v nvm >/dev/null 2>&1; then
  node20bin="$(dirname "$(nvm which 20 2>/dev/null || true)" 2>/dev/null || true)"
  if [ -n "${node20bin:-}" ] && [ -x "${node20bin}/node" ]; then
    export PATH="${node20bin}:${PATH}"
  fi
fi

exec "$@"
