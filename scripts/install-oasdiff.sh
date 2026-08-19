#!/usr/bin/env bash
# Download a pinned oasdiff binary into .cache/oasdiff/ (gitignored).
#
# oasdiff is a Go binary, not an npm package (the `oasdiff` name on npm is a
# security placeholder, not the tool). A raw pinned binary is used rather than
# the `oasdiff/oasdiff-action` GitHub Action for the same reasons as gitleaks:
# local and CI run the identical version, there is no third-party action in the
# supply chain, and it matches this repo's hand-rolled `run:`-step CI.
#
# Idempotent — a no-op when the pinned version is already cached.
# Override with OASDIFF_VERSION=x.y.z (e.g. to test an upgrade).
#
# Docs: docs/internal/ci-cd/QUALITY_GATES.md
set -euo pipefail

OASDIFF_VERSION="${OASDIFF_VERSION:-1.11.7}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_DIR="$ROOT/.cache/oasdiff"
BIN="$CACHE_DIR/oasdiff"

# `oasdiff --version` prints "oasdiff version 1.11.7", so compare the last field
# rather than the whole line — matching on the full string never hits and the
# installer silently re-downloads on every call.
if [ -x "$BIN" ] && [ "$("$BIN" --version 2>/dev/null | awk 'NR==1{print $NF}')" = "$OASDIFF_VERSION" ]; then
  echo "oasdiff $OASDIFF_VERSION already installed at $BIN"
  exit 0
fi

os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Linux) os_name="linux" ;;
  Darwin) os_name="darwin" ;;
  *) echo "install-oasdiff: unsupported OS '$os'." >&2; exit 1 ;;
esac
case "$arch" in
  x86_64 | amd64) arch_name="amd64" ;;
  arm64 | aarch64) arch_name="arm64" ;;
  *) echo "install-oasdiff: unsupported architecture '$arch'." >&2; exit 1 ;;
esac

asset="oasdiff_${OASDIFF_VERSION}_${os_name}_${arch_name}.tar.gz"
url="https://github.com/oasdiff/oasdiff/releases/download/v${OASDIFF_VERSION}/${asset}"

mkdir -p "$CACHE_DIR"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading oasdiff $OASDIFF_VERSION ($os_name/$arch_name)…"
if ! curl -fsSL "$url" -o "$tmp/$asset"; then
  echo "install-oasdiff: download failed from $url" >&2
  exit 1
fi

tar -xzf "$tmp/$asset" -C "$tmp"
mv "$tmp/oasdiff" "$BIN"
chmod +x "$BIN"

echo "oasdiff $OASDIFF_VERSION installed at $BIN"
