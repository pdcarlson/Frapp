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

# oasdiff ships ONE universal Darwin binary, published as `darwin_all` — there is
# no `darwin_amd64` or `darwin_arm64` asset, so deriving the name from the arch
# 404s on every Mac while CI (Linux) stays green.
if [ "$os_name" = "darwin" ]; then
  arch_name="all"
fi

asset="oasdiff_${OASDIFF_VERSION}_${os_name}_${arch_name}.tar.gz"
base_url="https://github.com/oasdiff/oasdiff/releases/download/v${OASDIFF_VERSION}"

mkdir -p "$CACHE_DIR"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading oasdiff $OASDIFF_VERSION ($os_name/$arch_name)…"
if ! curl -fsSL --retry 3 --max-time 120 "$base_url/$asset" -o "$tmp/$asset"; then
  echo "install-oasdiff: download failed from $base_url/$asset" >&2
  exit 1
fi

# Best-effort supply-chain check, matching install-gitleaks.sh: the binary is
# fetched over the network, made executable, and run in CI, so TLS alone is not
# the whole story. oasdiff publishes checksums.txt alongside the assets.
if curl -fsSL --retry 3 --max-time 60 "$base_url/checksums.txt" -o "$tmp/checksums.txt"; then
  expected="$(awk -v a="$asset" '$2 == a || $2 == "*"a {print $1}' "$tmp/checksums.txt" | head -n1)"
  if [ -z "$expected" ]; then
    echo "install-oasdiff: no checksum entry for $asset — refusing to install." >&2
    exit 1
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$tmp/$asset" | awk '{print $1}')"
  else
    actual="$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')"
  fi
  if [ "$actual" != "$expected" ]; then
    echo "install-oasdiff: checksum mismatch for $asset." >&2
    echo "  expected $expected" >&2
    echo "  actual   $actual" >&2
    exit 1
  fi
  echo "Checksum verified."
else
  echo "install-oasdiff: could not fetch checksums.txt — continuing unverified." >&2
fi

tar -xzf "$tmp/$asset" -C "$tmp"
# Extract to a temp name and move into place only once complete, so an
# interrupted run cannot leave a truncated binary cached and executable.
mv "$tmp/oasdiff" "$BIN.partial"
chmod +x "$BIN.partial"
mv "$BIN.partial" "$BIN"

echo "oasdiff $OASDIFF_VERSION installed at $BIN"
