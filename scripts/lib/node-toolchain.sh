#!/usr/bin/env bash
# Put a Node that satisfies the root package.json `engines.node` on PATH, in the cloud
# sandbox. Sourced, not executed, by scripts/cloud-sandbox-setup.sh (which installs it into
# the cached filesystem), scripts/cloud-sandbox-up.sh, and .claude/hooks/session-start.sh.
#
# Why: the sandbox image puts /opt/node22 first on PATH, and the repo needs Node 24.9+.
# Nothing failed loudly on 22. The API's Jest suite loads ESM-only dependencies such as
# @nestjs/config only on Node 24.9+ with --experimental-vm-modules
# (docs/guides/testing.md), so on 22 some suites die with "Must use import to load ES
# Module" while the rest pass, and `npm ci` itself runs under the wrong engine.
#
# No `set -e` here and no exit: callers decide their own error policy, and the hook must
# never abort session start over this. Every function returns non-zero on failure.

# Where the pinned Node lives. Overridable only so a test can point it at a scratch dir.
FRAPP_NODE_DIR="${FRAPP_NODE_DIR:-/opt/node24}"

_node_toolchain_log() {
  printf '[node-toolchain] %s\n' "$*" >&2
}

# True when version $1 (x.y.z) is at least version $2 (x.y.z).
_node_version_at_least() {
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

# The `engines.node` floor from $1/package.json, as x.y.z. Only a plain `>=x.y.z` range is
# understood; anything else prints nothing, and the caller then does nothing rather than
# guess at a range it cannot read.
node_engines_floor() {
  local pkg="$1/package.json" range
  [ -r "$pkg" ] || return 1
  command -v python3 >/dev/null 2>&1 || return 1
  range="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("engines",{}).get("node",""))' "$pkg" 2>/dev/null)" || return 1
  case "$range" in
    '>='[0-9]*.[0-9]*.[0-9]*) printf '%s\n' "${range#>=}" ;;
    *) return 1 ;;
  esac
}

# Version of the node binary $1 (default: the one on PATH), as x.y.z.
_node_version_of() {
  local bin="${1:-node}" v
  v="$("$bin" --version 2>/dev/null)" || return 1
  printf '%s\n' "${v#v}"
}

# Download the latest release of the floor's major line into FRAPP_NODE_DIR, verifying its
# SHA-256 against nodejs.org's SHASUMS256.txt. Extracts beside the target and renames, so an
# interrupted run never leaves a half-written FRAPP_NODE_DIR that looks installed.
_node_install() {
  local major="$1" arch base shasums file sum tmp
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) _node_toolchain_log "unsupported architecture $(uname -m)"; return 1 ;;
  esac
  command -v curl >/dev/null 2>&1 || { _node_toolchain_log "curl is missing"; return 1; }
  base="https://nodejs.org/dist/latest-v${major}.x"
  shasums="$(curl -fsSL --max-time 20 "$base/SHASUMS256.txt")" \
    || { _node_toolchain_log "could not reach $base (network policy?)"; return 1; }
  file="$(printf '%s\n' "$shasums" | awk -v a="linux-${arch}.tar.xz" '$2 ~ a"$" {print $2; exit}')"
  sum="$(printf '%s\n' "$shasums" | awk -v f="$file" '$2 == f {print $1; exit}')"
  [ -n "$file" ] && [ -n "$sum" ] || { _node_toolchain_log "no linux-${arch} build listed at $base"; return 1; }

  tmp="$(mktemp -d "${FRAPP_NODE_DIR}.tmp.XXXXXX" 2>/dev/null)" \
    || { _node_toolchain_log "cannot write beside $FRAPP_NODE_DIR"; return 1; }
  if ! curl -fsSL --max-time 90 -o "$tmp/$file" "$base/$file"; then
    _node_toolchain_log "download of $file failed"; rm -rf "$tmp"; return 1
  fi
  if ! printf '%s  %s\n' "$sum" "$tmp/$file" | sha256sum -c --quiet - >/dev/null 2>&1; then
    _node_toolchain_log "checksum mismatch for $file"; rm -rf "$tmp"; return 1
  fi
  mkdir "$tmp/node" && tar -xJf "$tmp/$file" -C "$tmp/node" --strip-components=1 \
    || { _node_toolchain_log "could not extract $file"; rm -rf "$tmp"; return 1; }
  rm -rf "$FRAPP_NODE_DIR" && mv "$tmp/node" "$FRAPP_NODE_DIR"
  local moved=$?
  rm -rf "$tmp"
  [ "$moved" -eq 0 ] || { _node_toolchain_log "could not move Node into $FRAPP_NODE_DIR"; return 1; }
  _node_toolchain_log "installed ${file%.tar.xz} into $FRAPP_NODE_DIR"
}

# Make `node` on PATH satisfy engines.node for the repo at $1, installing into
# FRAPP_NODE_DIR when neither PATH nor an earlier install does. Prepends FRAPP_NODE_DIR/bin
# to PATH in the calling shell when that is the Node it settles on.
#
# Call it directly, never inside `$(...)`: a command substitution is a subshell, and the
# PATH change would die with it. It reports through NODE_TOOLCHAIN_STATUS instead: `ok`
# (PATH already satisfied it), `cached` (an earlier install did), `installed`, `skipped`
# (no readable floor, so nothing to enforce), or `failed` (returns 1).
ensure_node_toolchain() {
  local root="$1" floor current cached
  NODE_TOOLCHAIN_STATUS=failed
  floor="$(node_engines_floor "$root")" || { NODE_TOOLCHAIN_STATUS=skipped; return 0; }

  current="$(_node_version_of node)" || current=""
  if [ -n "$current" ] && _node_version_at_least "$current" "$floor"; then
    NODE_TOOLCHAIN_STATUS=ok
    return 0
  fi

  cached="$(_node_version_of "$FRAPP_NODE_DIR/bin/node")" || cached=""
  if [ -n "$cached" ] && _node_version_at_least "$cached" "$floor"; then
    PATH="$FRAPP_NODE_DIR/bin:$PATH"
    export PATH
    NODE_TOOLCHAIN_STATUS=cached
    return 0
  fi

  _node_install "${floor%%.*}" || return 1
  cached="$(_node_version_of "$FRAPP_NODE_DIR/bin/node")" || cached=""
  if [ -z "$cached" ] || ! _node_version_at_least "$cached" "$floor"; then
    _node_toolchain_log "installed Node ${cached:-?} still does not satisfy >=$floor"
    return 1
  fi
  PATH="$FRAPP_NODE_DIR/bin:$PATH"
  export PATH
  NODE_TOOLCHAIN_STATUS=installed
}
