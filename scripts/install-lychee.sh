#!/usr/bin/env bash
# Download a pinned lychee binary into .cache/lychee/ (gitignored).
#
# Single source of truth for the lychee version used locally. `npm run check:links`
# runs it with the flags read out of .github/workflows/links.yml, so the local
# check and the CI `link-check` job assert the same thing.
#
# Why this exists: links.yml runs lychee with `--include-fragments`, the only
# thing in the repo that validates markdown heading ANCHORS. lychee was not
# installable locally, so a change that moved a heading — or a file other docs
# deep-link into — could only be checked by pushing and waiting. A restructure
# breaks anchors by construction, which is when that loop most needs to be short.
#
# Idempotent — a no-op when the pinned version is already cached.
# Override with LYCHEE_VERSION=x.y.z (e.g. to test an upgrade).
#
# Note on pinning: lycheeverse/lychee-action@v2 installs the LATEST lychee, so
# this pin can lag CI. Pinned anyway — a local checker that changes under you is
# worse than a known quantity — and check-links.mjs prints the version and flags
# it used, so a disagreement with CI is visible rather than mysterious.
#
# Docs: docs/internal/ci-cd/DOCS_CI.md
set -euo pipefail

LYCHEE_VERSION="${LYCHEE_VERSION:-0.24.2}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_DIR="$ROOT/.cache/lychee"
BIN="$CACHE_DIR/lychee"

# Already cached at the pinned version? Done. `lychee --version` prints
# "lychee 0.24.2", so compare the field rather than the whole string.
if [ -x "$BIN" ] && [ "$("$BIN" --version 2>/dev/null | awk '{print $2}')" = "$LYCHEE_VERSION" ]; then
  echo "lychee $LYCHEE_VERSION already installed at $BIN"
  exit 0
fi

# Map uname -> lychee release asset suffix.
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Linux) asset_platform="unknown-linux-musl" ;;
  Darwin) asset_platform="apple-darwin" ;;
  *)
    echo "Unsupported OS '$os'. Install lychee manually: https://github.com/lycheeverse/lychee/releases" >&2
    exit 1
    ;;
esac
case "$arch" in
  x86_64 | amd64) asset_arch="x86_64" ;;
  arm64 | aarch64) asset_arch="aarch64" ;;
  *)
    echo "Unsupported arch '$arch'. Install lychee manually: https://github.com/lycheeverse/lychee/releases" >&2
    exit 1
    ;;
esac

asset="lychee-${asset_arch}-${asset_platform}.tar.gz"
base_url="https://github.com/lycheeverse/lychee/releases/download/lychee-v${LYCHEE_VERSION}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading lychee ${LYCHEE_VERSION} (${asset_arch}/${asset_platform})..."
if ! curl -fsSL --retry 3 --max-time 120 -o "$tmp/$asset" "$base_url/$asset"; then
  echo "install-lychee: download failed: $base_url/$asset" >&2
  echo "If this environment blocks GitHub release downloads, rely on the CI link-check job." >&2
  exit 1
fi

# Supply-chain check. Every lychee release publishes a .sha256 beside each
# asset, so a MISSING checksum is not the ordinary case — it means something
# interfered with that one small request, which is exactly the tampering case.
# Failing open there would mv+chmod +x an unverified binary that the developer
# then runs, and the cache check above means it is never re-verified. So this
# hard-fails both ways, with an explicit escape hatch for a genuinely offline
# mirror rather than a silent one.
if curl -fsSL --retry 3 --max-time 60 -o "$tmp/$asset.sha256" "$base_url/${asset}.sha256" 2> /dev/null; then
  expected="$(awk '{print $1}' < "$tmp/$asset.sha256" | tr -d '\r')"
  if command -v sha256sum > /dev/null 2>&1; then
    actual="$(sha256sum "$tmp/$asset" | awk '{print $1}')"
  else
    actual="$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')"
  fi
  if [ "$expected" != "$actual" ]; then
    echo "install-lychee: checksum mismatch for $asset" >&2
    echo "  expected $expected" >&2
    echo "  actual   $actual" >&2
    exit 1
  fi
  echo "Checksum verified."
elif [ "${LYCHEE_ALLOW_UNVERIFIED:-}" = "1" ]; then
  echo "install-lychee: no published checksum found; continuing because LYCHEE_ALLOW_UNVERIFIED=1." >&2
else
  echo "install-lychee: could not fetch ${asset}.sha256, so the download is unverified." >&2
  echo "Every lychee release publishes one, so this is unexpected. Refusing to install." >&2
  echo "If you are behind a mirror that strips checksums, re-run with LYCHEE_ALLOW_UNVERIFIED=1." >&2
  exit 1
fi

mkdir -p "$CACHE_DIR"
tar -xzf "$tmp/$asset" -C "$tmp"

# The archive layout has varied across releases (bare binary vs a versioned
# directory), so locate it rather than assuming a path.
found="$(find "$tmp" -type f -name lychee -print -quit)"
if [ -z "$found" ]; then
  echo "install-lychee: no 'lychee' binary inside $asset." >&2
  exit 1
fi

mv "$found" "$BIN"
chmod +x "$BIN"
echo "Installed: $("$BIN" --version) -> $BIN"
echo "Run: npm run check:links"
