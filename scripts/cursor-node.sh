#!/usr/bin/env bash
# Run a command under the repo's pinned Node (Cursor Cloud Agent helper).
#
# WHY THIS EXISTS. The Cursor Cloud base image ships its own Node as
# `/exec-daemon/node`, and that directory is injected at the FRONT of PATH by the shell
# wrapper — ahead of nvm — so a bare `nvm use` changes `npm` but NOT `node`. The only
# reliable way to get the repo's Node for the app processes is to prepend nvm's bin for
# that version explicitly, which is what this wrapper does before exec-ing the command.
#
# WHICH VERSION. Read from `.nvmrc` at the repo root — the single home for the dev Node,
# alongside `engines.node` in package.json. Do not hardcode a version here: this file
# was `cursor-node20.sh` and spent the Node 20 era asserting "this repo pins Node 20
# everywhere", which went false the moment CI and the Dockerfile moved to 24 while this
# wrapper kept forcing 20 underneath them.
#
# The historical reason for pinning *down* is gone: Node 22's stricter
# `ERR_REQUIRE_CYCLE_MODULE` used to break the Nest CLI (`nest start` ->
# @angular-devkit/schematics -> ESM `ora` in a require cycle). On Node 24 with the
# current tree `nest start` boots clean — verified, zero `ERR_REQUIRE_CYCLE_MODULE`.
# What remains is pinning *to a specific version*, which is still needed because the
# base image's Node is not the repo's.
#
#   Usage: bash scripts/cursor-node.sh <command> [args...]
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

NODE_VERSION="$(tr -d '[:space:]' <"$ROOT/.nvmrc" 2>/dev/null || true)"
if [ -z "${NODE_VERSION:-}" ]; then
  echo "[cursor-node] cannot read $ROOT/.nvmrc — refusing to guess a Node version" >&2
  exit 1
fi

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
fi

if command -v nvm >/dev/null 2>&1; then
  nodebin="$(dirname "$(nvm which "$NODE_VERSION" 2>/dev/null || true)" 2>/dev/null || true)"
  if [ -n "${nodebin:-}" ] && [ -x "${nodebin}/node" ]; then
    export PATH="${nodebin}:${PATH}"
  fi
fi

exec "$@"
