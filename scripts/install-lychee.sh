#!/usr/bin/env bash
# Install the lychee link checker locally, so heading anchors can be verified
# before pushing instead of only in CI.
#
# Why this exists: `.github/workflows/links.yml` runs lychee with
# `--include-fragments`, which is the only thing in the repo that validates
# markdown heading ANCHORS. lychee was not installable locally, so a change that
# moved a heading — or a file with headings other docs deep-link into — could
# only be checked by pushing and waiting. A restructure breaks anchors by
# construction, which is exactly when the feedback loop must be short.
#
# The binary lands in .tools/ (gitignored). Re-running is cheap and idempotent.
#
# Usage:
#   ./scripts/install-lychee.sh              # the pinned version below
#   LYCHEE_VERSION=lychee-v0.24.2 ./scripts/install-lychee.sh
#
# Note on pinning: lycheeverse/lychee-action@v2 installs the LATEST lychee, so a
# pin here can lag CI. It is pinned anyway, because a local checker that changes
# under you is worse than one that is a known quantity — and `npm run
# check:links` prints the version it used so a disagreement with CI is visible
# rather than mysterious. Bump it when CI and local ever disagree.

set -euo pipefail

LYCHEE_VERSION="${LYCHEE_VERSION:-lychee-v0.24.2}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="$REPO_ROOT/.tools"
TARGET="$TOOLS_DIR/lychee"

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Linux)  platform="unknown-linux-musl" ;;
  Darwin) platform="apple-darwin" ;;
  *)
    echo "install-lychee: unsupported OS '$os'." >&2
    echo "Install lychee yourself and put it on PATH: https://github.com/lycheeverse/lychee" >&2
    exit 1
    ;;
esac

case "$arch" in
  x86_64|amd64) cpu="x86_64" ;;
  arm64|aarch64) cpu="aarch64" ;;
  *)
    echo "install-lychee: unsupported architecture '$arch'." >&2
    exit 1
    ;;
esac

asset="lychee-${cpu}-${platform}.tar.gz"
url="https://github.com/lycheeverse/lychee/releases/download/${LYCHEE_VERSION}/${asset}"

if [ -x "$TARGET" ] && "$TARGET" --version 2>/dev/null | grep -q "${LYCHEE_VERSION#lychee-v}"; then
  echo "lychee ${LYCHEE_VERSION} already installed at $TARGET"
  exit 0
fi

mkdir -p "$TOOLS_DIR"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading $asset ($LYCHEE_VERSION)..."
if ! curl -fsSL "$url" -o "$tmp/$asset"; then
  echo "install-lychee: download failed: $url" >&2
  echo "If this environment blocks GitHub release downloads, run check:links in CI instead." >&2
  exit 1
fi

# The release publishes a .sha256 beside each asset. Verify when we can get it;
# a missing checksum file is not worth failing an install over, but a MISMATCH
# always is.
if curl -fsSL "${url}.sha256" -o "$tmp/$asset.sha256" 2>/dev/null; then
  expected="$(tr -d '\r\n' < "$tmp/$asset.sha256" | awk '{print $1}')"
  if command -v sha256sum >/dev/null 2>&1; then
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
else
  echo "install-lychee: no published checksum found; skipping verification." >&2
fi

tar -xzf "$tmp/$asset" -C "$tmp"
found="$(find "$tmp" -type f -name lychee -perm -u+x | head -n 1)"
if [ -z "$found" ]; then
  echo "install-lychee: no 'lychee' binary inside $asset." >&2
  exit 1
fi

mv "$found" "$TARGET"
chmod +x "$TARGET"
echo "Installed: $("$TARGET" --version) -> $TARGET"
echo "Run: npm run check:links"
