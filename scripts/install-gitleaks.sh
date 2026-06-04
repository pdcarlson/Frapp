#!/usr/bin/env bash
# Download a pinned gitleaks binary into .cache/gitleaks/ (gitignored).
#
# Single source of truth for the gitleaks version used by all three secret-scan
# call sites: the local pre-commit hook, `npm run ci:local-gate`, and the CI
# `secret-scan` job. Idempotent — a no-op when the pinned version is already cached.
#
# Override the version with GITLEAKS_VERSION=x.y.z (e.g. to test an upgrade).
# This pinned cache is the source of truth; scan-secrets.mjs falls back to a compatible
# `gitleaks` on PATH (e.g. `brew install gitleaks`) only when this installer can't run.
#
# Docs: docs/internal/ci-cd/SECRET_SCANNING.md
set -euo pipefail

GITLEAKS_VERSION="${GITLEAKS_VERSION:-8.30.1}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_DIR="$ROOT/.cache/gitleaks"
BIN="$CACHE_DIR/gitleaks"

# Already cached at the pinned version? Done.
if [ -x "$BIN" ] && [ "$("$BIN" version 2>/dev/null)" = "$GITLEAKS_VERSION" ]; then
  echo "gitleaks $GITLEAKS_VERSION already installed at $BIN"
  exit 0
fi

# Map uname -> gitleaks release asset suffix.
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Linux) asset_os="linux" ;;
  Darwin) asset_os="darwin" ;;
  *)
    echo "Unsupported OS '$os'. Install gitleaks manually: https://github.com/gitleaks/gitleaks/releases" >&2
    exit 1
    ;;
esac
case "$arch" in
  x86_64 | amd64) asset_arch="x64" ;;
  arm64 | aarch64) asset_arch="arm64" ;;
  *)
    echo "Unsupported arch '$arch'. Install gitleaks manually: https://github.com/gitleaks/gitleaks/releases" >&2
    exit 1
    ;;
esac

asset="gitleaks_${GITLEAKS_VERSION}_${asset_os}_${asset_arch}.tar.gz"
base_url="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading gitleaks ${GITLEAKS_VERSION} (${asset_os}/${asset_arch})..."
curl -fsSL --retry 3 --max-time 120 -o "$tmp/$asset" "$base_url/$asset"

# Best-effort supply-chain check: verify the SHA-256 against the published
# checksums. Hard-fail on a mismatch; warn-and-proceed only if the checksums
# file itself can't be fetched (HTTPS already protects the primary download).
if curl -fsSL --retry 3 --max-time 60 -o "$tmp/checksums.txt" \
  "$base_url/gitleaks_${GITLEAKS_VERSION}_checksums.txt" 2> /dev/null; then
  expected="$(awk -v f="$asset" '$2 == f {print $1}' "$tmp/checksums.txt")"
  if [ -z "$expected" ]; then
    echo "No checksum entry for $asset in checksums.txt (asset-name/format drift?); refusing to install unverified." >&2
    exit 1
  fi
  if command -v sha256sum > /dev/null 2>&1; then
    actual="$(sha256sum "$tmp/$asset" | awk '{print $1}')"
  else
    actual="$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')"
  fi
  if [ "$expected" != "$actual" ]; then
    echo "Checksum mismatch for $asset (expected $expected, got $actual)" >&2
    exit 1
  fi
  echo "Checksum verified."
else
  echo "Warning: could not fetch checksums.txt; proceeding on HTTPS integrity only." >&2
fi

mkdir -p "$CACHE_DIR"
tar -xzf "$tmp/$asset" -C "$tmp" gitleaks
mv "$tmp/gitleaks" "$BIN"
chmod +x "$BIN"
echo "Installed gitleaks $("$BIN" version) -> $BIN"
