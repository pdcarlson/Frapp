#!/usr/bin/env bash
# Format-check, lint, type-check and test the Supabase Edge Functions under
# supabase/functions/ (ADR-26) with a pinned Deno.
#
# `npm run check:edge-functions` runs this, and so does the required
# `lint-and-typecheck` CI job, so the version below is the one place Deno is
# pinned. It installs that version from the npm registry into .cache/deno/
# (gitignored) on first use. The npm `deno` package ships the binary as a
# platform dependency, so this works wherever `npm ci` does, the cloud sandbox
# included, where Deno's own download host is not on the allowlist.
#
# The functions run on Supabase's Edge Runtime, whose Deno version is
# Supabase's, not this one. This is the version the handler was verified on.
#
# Override with DENO_VERSION=x.y.z to try another. Docs: docs/guides/testing.md
# § 5b.
set -euo pipefail

DENO_VERSION="${DENO_VERSION:-2.9.6}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_DIR="$ROOT/.cache/deno"
DENO="$CACHE_DIR/node_modules/.bin/deno"

# `deno --version` prints "deno 2.9.6 (stable, ...)" on its first line.
if ! { [ -x "$DENO" ] && [ "$("$DENO" --version 2>/dev/null | awk 'NR==1 {print $2}')" = "$DENO_VERSION" ]; }; then
  echo "Installing Deno $DENO_VERSION into $CACHE_DIR"
  npm install --prefix "$CACHE_DIR" --no-save --no-audit --no-fund --loglevel=error "deno@$DENO_VERSION"
fi

cd "$ROOT/supabase/functions"
"$DENO" --version | head -n 1
"$DENO" fmt --check
"$DENO" lint
"$DENO" check .
# No permissions granted: a test that reached the network or the environment
# fails here instead of passing on a live call.
"$DENO" test
