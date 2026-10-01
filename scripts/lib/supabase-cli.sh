#!/usr/bin/env bash
# The repo's pinned Supabase CLI, for the scripts that run it on a developer's own machine:
# the cloud-sandbox bringup (scripts/cloud-sandbox-up.sh and cloud-sandbox-setup.sh, through
# cs_supabase) and the laptop bootstrap (scripts/local-dev-setup.sh). Sourced, not executed.
# No `set -e` here — callers decide their own error policy; frapp_supabase signals failure via
# its return code.
#
# Side-effect-free at source time: it sets one constant and defines two functions. That is
# what lets the laptop path source it. scripts/lib/cloud-sandbox-common.sh, which also sources
# it, exports telemetry vars and normalizes retry knobs as it loads, and the laptop bootstrap
# deliberately takes none of that.
#
# ONE VERSION, EVERYWHERE (#723). CI installs the CLI through
# .github/actions/supabase-cli/action.yml, the single supabase/setup-cli pin behind the staging
# and production migration applies, the production rehearsal, the migration-replay gate, the
# nightly backup's `db dump` and the Edge Function deploy. This constant must equal that pin:
# scripts/ci/__tests__/infisical-secrets-action.test.mjs asserts it, so a bump has to move both
# and the failure names this file. It is a literal rather than parsed out of the YAML because
# an empty parse here would install whatever "latest" is, silently, which is the bug this
# file exists to end.
#
# Until #723 the three disagreed: CI ran 2.77.0, the sandbox 2.110.0, and the laptop bootstrap
# bare `npx supabase`, i.e. whatever "latest" was that day. The sandbox could not move back to
# 2.77.0 (its realtime container aborts with `:listen_error, :eafnosupport` binding IPv6, which
# the cloud sandbox does not support), so CI moved forward to the version the sandbox had been
# running since #640.
#
# Override with FRAPP_SUPABASE_CLI_VERSION to try another version locally. Any spec npm accepts
# works (a version, a range, `latest`); the cache below keys on it.
FRAPP_SUPABASE_CLI_PIN="2.110.0"

# Log prefix, looked up at CALL time (not at source time), so callers may set it before or
# after sourcing: cloud-sandbox-common.sh sets `[cloud-sandbox]`, local-dev-setup.sh its own.
frapp_supabase_cli_log() {
  printf '%s %s\n' "${FRAPP_SUPABASE_CLI_LOG_PREFIX:-[supabase-cli]}" "$*" >&2
}

# Resolve (installing on first use) and invoke the pinned Supabase CLI.
#
# Mirrors the pinned-tooling pattern already used for gitleaks
# (scripts/install-gitleaks.sh → .cache/gitleaks/): the binary lives in a gitignored
# .cache/supabase-cli/ rather than in the repo's dependency tree. That matters because the
# v2 CLI's platform binary is ~200 MB; as a root devDependency it would be downloaded by
# every `npm ci` in CI and pulled into the API image's dev-deps build stage, for a tool
# only the local bootstrap scripts call (cf. ADR-15 on CI cost). CI installs its own copy
# through setup-cli instead.
#
# Deliberately NOT bare `npx supabase`, which caused the failure this replaces: it
# re-resolves "latest" every session, and the v2 CLI ships its executable as a
# platform-specific optionalDependency. When that optional install is skipped the
# launcher throws "No matching Supabase CLI binary package found for <platform>" and
# aborts the whole bringup — and npx caches the broken tree under ~/.npm/_npx, so it stays
# broken for the rest of the session.
#
# Self-healing by design: the cache is a build artifact, not a checked-in file, so an
# expired sandbox filesystem cache or a failed `npm ci` just triggers a reinstall here
# instead of failing the bringup. The readiness probe runs the binary rather than testing
# for its presence, because the launcher script exists and is executable even when the
# platform binary behind it is missing — the exact case above.
#
# Returns 127 for its own install failures (a bad version spec, a blocked registry, a
# skipped platform binary), so a caller can tell "the CLI could not run" from "the CLI ran
# and failed". cloud-sandbox-common.sh's cs_retry relies on that: it never retries a 127,
# and reports it as the `toolchain` class.
frapp_supabase() {
  local root cache bin log spec have needs_install
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  cache="$root/.cache/supabase-cli"
  bin="$cache/node_modules/.bin/supabase"
  log="$cache/install.log"
  spec="${FRAPP_SUPABASE_CLI_VERSION:-$FRAPP_SUPABASE_CLI_PIN}"

  # Probe by RUNNING the binary — the launcher exists and is executable even when the
  # platform binary behind it was skipped, so a presence test would pass a broken tree.
  have="$("$bin" --version 2>/dev/null || true)"
  # Key the cache on the REQUESTED SPEC, not the printed version. Comparing the spec to the
  # printed version only works for exact pins: a non-exact spec (latest, ^2.110.0) never
  # equals "2.112.0", so string-comparing reinstalled before every call, while treating
  # non-exact as "accept anything cached" silently ignored the upgrade the override exists
  # to test — and swallowed typos like 2.110.O whenever any cache existed. Recording the
  # spec handles both: a working binary installed for this exact spec string is reused, and
  # changing the spec at all forces a reinstall.
  needs_install=1
  if [ -n "$have" ] && [ "$(cat "$cache/.spec" 2>/dev/null || true)" = "$spec" ]; then
    needs_install=0
  fi

  if [ "$needs_install" -eq 1 ]; then
    frapp_supabase_cli_log "Installing Supabase CLI ${spec} into .cache/supabase-cli..."
    mkdir -p "$cache"
    [ -f "$cache/package.json" ] \
      || printf '{"name":"frapp-supabase-cli","private":true}\n' >"$cache/package.json"
    # Keep npm's output: it is the only place the real cause appears (a 404 on a typo'd
    # version reads identically to a blocked registry once discarded).
    if ! npm install --prefix "$cache" "supabase@${spec}" \
      --no-audit --no-fund >"$log" 2>&1; then
      frapp_supabase_cli_log "ERROR: installing supabase@${spec} failed — full output in $log:"
      tail -n 5 "$log" 2>/dev/null | while IFS= read -r line; do frapp_supabase_cli_log "  $line"; done
      return 127
    fi
    # npm exits 0 even when a platform-specific optionalDependency is skipped — which is
    # exactly the failure this helper exists to prevent — so re-probe instead of trusting
    # the exit code.
    if ! "$bin" --version >/dev/null 2>&1; then
      frapp_supabase_cli_log "ERROR: supabase installed but its platform binary is missing (@supabase/cli-<platform> skipped) — see $log"
      return 127
    fi
    # Record the spec only after the binary is proven to run, so a half-installed tree is
    # never cached as satisfying the spec.
    printf '%s' "$spec" >"$cache/.spec" 2>/dev/null || true
  fi

  "$bin" "$@"
}
