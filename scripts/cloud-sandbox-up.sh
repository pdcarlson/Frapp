#!/usr/bin/env bash
# Cloud sandbox PER-SESSION bringup. Idempotent. Brings the local stack up and writes the
# app .env.local files so the API boots and apps/web builds without Infisical:
#
#   1. start the Docker daemon (does not persist across sessions)
#   2. supabase start (fast — images were cached by cloud-sandbox-setup.sh)
#   3. supabase db push --local
#   4. write apps/api/.env.local and apps/web/.env.local from `supabase status`
#      (+ Stripe env vars for the API)
#   5. repair the local Postgres default ACLs (the image ships them without DML grants)
#   6. load the chapter directory seed (non-fatal)
#   7. verify node_modules is usable — LAST, so a broken npm never costs the database
#      (see the comment above the call for why this is not the first step)
#
# Steps 4 and 5 are in that order deliberately, and this list had them backwards until
# #1156 — see the comment above the ACL repair for why the env write has to come first.
#
# Auto-launched in the background by .claude/hooks/session-start.sh (gated on the
# /etc/frapp-cloud-sandbox marker or FRAPP_CLOUD_SANDBOX=1), or run directly. Writes a
# .cloud-sandbox-up.done / .cloud-sandbox-up.failed sentinel at repo root so callers can
# poll completion. See docs/internal/environment/CLOUD_SANDBOX.md.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT"
# shellcheck source=scripts/lib/cloud-sandbox-common.sh
. "$ROOT/scripts/lib/cloud-sandbox-common.sh"
# Match cs_log's prefix so the ACL lib's lines are indistinguishable from this script's.
# The lib reads this at call time, so the order relative to the source below does not matter.
FRAPP_ACL_LOG_PREFIX='[cloud-sandbox]'
FRAPP_SEED_LOG_PREFIX='[cloud-sandbox]'
# shellcheck source=scripts/lib/local-postgres-acl.sh
. "$ROOT/scripts/lib/local-postgres-acl.sh"
# Must come AFTER local-postgres-acl.sh — it calls frapp_run_local_sql from that lib.
# shellcheck source=scripts/lib/local-seed-data.sh
. "$ROOT/scripts/lib/local-seed-data.sh"

DONE_SENTINEL="$ROOT/.cloud-sandbox-up.done"
FAILED_SENTINEL="$ROOT/.cloud-sandbox-up.failed"
rm -f "$DONE_SENTINEL" "$FAILED_SENTINEL"

fail() {
  cs_log "ERROR: $1"
  printf '%s — %s\n' "$(date -u +%FT%TZ)" "$1" >"$FAILED_SENTINEL"
  exit 1
}

# Egress capability probe — deliberately FIRST, before any Docker or Supabase work.
#
# Two reasons it is here and not at the end, where it started:
#
#   1. It has nothing to do with the local stack. Reaching deployed staging does not
#      require Docker, Postgres, or a single container. Running it last meant that any
#      `fail()` above it — a denied ulimit, a stuck container, an image pull that ran out
#      of retries — exited before the probe and left the session with NO manifest, even
#      though its egress was completely intact. That is precisely backwards: a session
#      whose local stack died is the one most likely to fall back on live staging.
#   2. It finishes in about a second, so the answer is ready long before the ~60-90s
#      bringup lands `.done`. Nothing waiting on `.done` can observe a missing manifest.
#
# Non-fatal by construction — the probe cannot return non-zero (see its header). Invoked
# with `|| true` anyway so a future edit breaking that promise degrades to "no manifest"
# instead of taking down bringup for every session, including the ones that never touch
# staging.
cs_log "Probing deployed-environment egress..."
bash "$ROOT/scripts/cloud-sandbox-egress-probe.sh" >/dev/null || true

# Write apps/api/.env.local and apps/web/.env.local from the live local Supabase status
# (plus Stripe env vars for the API). Real Stripe test keys are used when present;
# otherwise clearly-marked placeholders that satisfy the non-empty check in
# apps/api/src/config/env.validation.ts (the API boots; billing endpoints that call
# Stripe will not work). Both files are gitignored.
#
# Both are written from ONE `supabase status` read. A second call would be a second
# chance to disagree with the first — and the web file's values are the same two the API
# file already validated, so re-deriving them independently buys nothing.
#
# apps/landing gets no file: its only NEXT_PUBLIC_* var (NEXT_PUBLIC_APP_URL) defaults to
# the production origin in apps/landing/lib/auth-urls.ts, so it builds unconfigured.
write_env_files() {
  local envfile="$ROOT/apps/api/.env.local"
  local webenvfile="$ROOT/apps/web/.env.local"
  local supa

  # Preferred: map Supabase's status output onto the names the two generated .env.local
  # files use. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are the API's; SUPABASE_ANON_KEY
  # is fetched for apps/web, which consumes it as NEXT_PUBLIC_SUPABASE_ANON_KEY below. The
  # API does not read the anon key and does not require it
  # (apps/api/src/config/env.validation.ts).
  supa=$(cs_supabase status -o env \
    --override-name api.url=SUPABASE_URL \
    --override-name auth.anon_key=SUPABASE_ANON_KEY \
    --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY 2>/dev/null)

  # Fallback for CLI versions that don't support --override-name: remap default names.
  if ! printf '%s' "$supa" | grep -q '^SUPABASE_URL='; then
    supa=$(cs_supabase status -o env 2>/dev/null) || return 1
    supa=$(printf '%s\n' "$supa" \
      | sed -e 's/^API_URL=/SUPABASE_URL=/' \
            -e 's/^ANON_KEY=/SUPABASE_ANON_KEY=/' \
            -e 's/^SERVICE_ROLE_KEY=/SUPABASE_SERVICE_ROLE_KEY=/' \
      | grep -E '^SUPABASE_(URL|ANON_KEY|SERVICE_ROLE_KEY)=')
  fi

  # Validate every variable the two generated .env.local files need, not just the URL.
  # `supabase status` omits the auth keys when gotrue is stopped or excluded (e.g. a
  # FRAPP_SUPABASE_START_ARGS override adding `-x gotrue`), and checking only SUPABASE_URL
  # let that write env files missing a key their consumer hard-requires — while still
  # returning 0 and landing the .cloud-sandbox-up.done success sentinel. Which consumer,
  # and how badly, differs per name; that is what the list below is for.
  #
  # Check each name for the consumer that needs it, never for the list it appears on:
  #   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  the API requires both at boot
  #                                              (apps/api/src/config/env.validation.ts).
  #   - SUPABASE_ANON_KEY                        apps/web requires it. It is NOT an API
  #                                              variable and env.validation.ts does not
  #                                              ask for it, so do not drop it from this
  #                                              loop on the strength of that list: the
  #                                              NEXT_PUBLIC_ write below derives from
  #                                              $supa and this is its only guard.
  #                                              Losing it breaks `npm run build -w
  #                                              apps/web` in every future session, and
  #                                              no CI job would catch that — see the
  #                                              note on the web write below for why
  #                                              `web-production-build` cannot.
  local key missing=""
  for key in SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY; do
    printf '%s' "$supa" | grep -q "^${key}=" || missing="${missing} ${key}"
  done
  if [ -n "$missing" ]; then
    cs_log "ERROR: 'supabase status' output is missing:${missing} — is the auth (gotrue) container running?"
    return 1
  fi

  {
    echo "# Generated by scripts/cloud-sandbox-up.sh — DO NOT COMMIT (gitignored)."
    echo "# Local Supabase values are regenerated each session from 'supabase status'."
    printf '%s\n' "$supa"
    echo "STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY:-sk_test_placeholder_cloud_sandbox}"
    echo "STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET:-whsec_placeholder_cloud_sandbox}"
    echo "STRIPE_PRICE_ID=${STRIPE_PRICE_ID:-price_placeholder_cloud_sandbox}"
    echo "PORT=3001"
    echo "NODE_ENV=development"
  } >"$envfile" || {
    # Without this the redirect's failure is swallowed and the trailing `if` below resets
    # $?, so the function returns 0 — landing the .cloud-sandbox-up.done success sentinel
    # over a missing or stale env file. That is the same silent-success failure this
    # function's key validation above exists to prevent. Reachable when $envfile is not
    # writable, e.g. root-owned from a root-run bringup followed by a non-root session.
    cs_log "ERROR: could not write $envfile (permissions?)."
    return 1
  }

  if [ -z "${STRIPE_SECRET_KEY:-}" ]; then
    cs_log "NOTE: no STRIPE_SECRET_KEY in env — wrote Stripe placeholders. Billing endpoints will not work."
  fi

  # apps/web reads its Supabase values under NEXT_PUBLIC_ names, and reads them
  # non-null-asserted (apps/web/lib/supabase/client.ts). Without this file `npm run build
  # -w apps/web` dies prerendering /chat — `createSupabaseBrowserClient()` throws inside
  # the static export — which reads as "my change broke the build" to the next agent
  # (#1156), and no CI job catches it. Not because CI skips the build — `web-production-build`
  # has run a real `next build` over apps/web on every PR since #1374, which closed #355 — but
  # because that job supplies its OWN NEXT_PUBLIC_SUPABASE_* stand-ins in its step `env:`
  # (.github/workflows/ci.yml). It therefore never reads the file written here, and a defect in
  # what this function generates is invisible to it by construction. Sandbox-local, always.
  #
  # The grep is the security boundary, not a tidiness filter. NEXT_PUBLIC_* is INLINED
  # INTO THE CLIENT BUNDLE by Next, so anything written here is public by construction.
  # Matching `SUPABASE_(URL|ANON_KEY)=` exactly is what keeps SUPABASE_SERVICE_ROLE_KEY —
  # present in $supa, and validated above — from being prefixed along with them. Widen
  # this pattern only with that in mind.
  #
  # $supa is already known to carry both keys: the loop above validated all three names
  # and returned non-zero if any were missing. SUPABASE_ANON_KEY is in that loop *for this
  # write* — the API neither reads nor requires it — so this line and that check are one
  # mechanism. Remove either and the other becomes silently wrong.
  #
  # NON-FATAL, unlike the API write above, and the asymmetry is the point. The caller is
  # `write_env_files || fail`, and `fail` exits before the ACL repair below — so returning
  # non-zero here would leave local Postgres without its DML grants (every query `42501`)
  # over a file nothing but `npm run build -w apps/web` needs. That is the *worse* of the
  # two documented degradations, traded for the lesser one, which is exactly the inversion
  # the ordering comment further down exists to prevent. So this warns and continues, the
  # same shape as the chapter-directory seed load: the stack is fully usable without it.
  if {
    echo "# Generated by scripts/cloud-sandbox-up.sh — DO NOT COMMIT (gitignored)."
    echo "# Local Supabase values are regenerated each session from 'supabase status'."
    echo "# These are the local demo keys the Supabase CLI prints; they are not secrets."
    printf '%s\n' "$supa" | grep -E '^SUPABASE_(URL|ANON_KEY)=' | sed 's/^/NEXT_PUBLIC_/'
    # Not required to build — apps/web's health poll treats an unset value as "do not
    # poll" — but the local API listens here, so setting it makes the sandbox's web app
    # actually talk to the sandbox's API instead of silently polling nothing.
    echo "NEXT_PUBLIC_API_URL=http://127.0.0.1:3001"
  } >"$webenvfile"; then
    return 0
  fi

  cs_log "WARN: could not write $webenvfile (permissions?)."
  cs_log "      The stack is fine; 'npm run build -w apps/web' will fail on the missing"
  cs_log "      NEXT_PUBLIC_SUPABASE_* vars until it exists (#1156)."
}

cs_ensure_docker_daemon || fail "Docker daemon did not start."
cs_docker_login_if_creds

cs_log "Starting Supabase (images cached)..."
# Start args (incl. the mandatory edge-runtime exclusion) live in the shared lib as
# CS_SUPABASE_START_ARGS so bringup and the setup pre-pull cannot drift apart.
#
# This is the ONLY retried step. It is the only network-bound one — ~10 images from ECR
# Public via CloudFront — and a CDN hiccup here used to kill the whole session. cs_retry
# retries transient failures and returns immediately on a blocked allowlist or an exhausted
# Docker Hub quota, both of which need a change in the web UI that no retry can supply.
#
# $CS_SUPABASE_START_ARGS must stay UNQUOTED through the wrapper: quoting it collapses
# `-x edge-runtime` into one argument and silently un-does the exclusion, which is the
# start-aborting failure documented at length in the shared lib.
#
# The failure message is the whole point of the classification. fail() writes it verbatim
# into .cloud-sandbox-up.failed, and that sentinel — not the log — is what a polling agent
# reads, so it has to name the fix rather than just the symptom.
CS_RETRY_LOG_LOCATION="/tmp/cloud-sandbox-up.log"
# shellcheck disable=SC2086
cs_retry "'supabase start'" "cs_supabase stop" cs_supabase start $CS_SUPABASE_START_ARGS \
  || fail "'supabase start' failed (${CS_RETRY_CLASS:-unknown}) — ${CS_RETRY_HINT:-see /tmp/cloud-sandbox-up.log}"

# Deliberately NOT retried, here or below: the remaining steps are deterministic and local. Retrying a
# failing migration or an unwritable env file just triples the time to the same error, and
# hides which step actually broke behind a generic "failed after 3 attempts".
cs_log "Applying local migrations..."
cs_supabase db push --local || fail "'supabase db push --local' failed."

cs_log "Writing apps/api/.env.local and apps/web/.env.local..."
write_env_files || fail "Could not write the app .env.local files from 'supabase status'."

# Ordering is deliberate on both sides.
#
# AFTER `db push`, because the repair fixes the tables those migrations just created — the
# grants are what stand between a green /health and `42501 permission denied for table …`.
#
# AFTER `write_env_files`, because this step is fatal and nothing in the env file depends on
# the grants. Running it first meant a failed repair aborted before .env.local was ever
# written, leaving the API unable to boot AT ALL (env.validation.ts throws on a missing
# SUPABASE_URL) — strictly worse than the 42501 this repairs, where the API at least boots.
# Failing here now degrades to "boots, queries denied" rather than "cannot start".
cs_log "Repairing local Postgres default ACLs..."
# cs_supabase is passed as the CLI to consult for DB_URL; the lib only invokes it when the
# host has psql, so a psql-less machine never pays for the round-trip. The parse itself lives
# in the lib rather than here, so both bootstrap paths cannot drift on CLI output format.
frapp_repair_local_acls "$ROOT" cs_supabase \
  || fail "Could not repair local Postgres default ACLs (see the log above)."

# Reference data. AFTER the ACL repair, because the load is a plain INSERT/UPDATE as
# `postgres` and would otherwise be the first thing to hit the missing DML grants.
#
# Non-fatal by design, unlike the repair above: an empty chapter_directory degrades
# onboarding autofill to the miss path, which exists and works, whereas missing grants
# make every table unreadable. The WARNING is loud because #840 is precisely the story
# of this table being empty in every environment without anyone noticing.
cs_log "Loading the chapter directory seed..."
if ! frapp_load_chapter_directory "$ROOT" cs_supabase; then
  cs_log "WARN: chapter directory seed did not load; onboarding autofill will match nothing."
  cs_log "      The stack is otherwise fine. Re-run: node scripts/load-chapter-directory.mjs"
fi

# Toolchain check — LAST, immediately before the success sentinel, and deliberately so.
#
# cloud-sandbox-setup.sh installs node deps non-fatally by design, and its warning lands in the
# web UI's environment setup log where no agent session can read it. This script never
# re-checked, so `.cloud-sandbox-up.done` asserted nothing whatsoever about dependencies and a
# session could reach a green sentinel with an EMPTY node_modules. Every turbo-run gate then
# died with `turbo: not found` — an error naming neither dependencies nor either script, while
# the plain-node gates kept passing, which made the breakage look selective (#1631). Because
# setup's filesystem is cached ~7 days, one bad install was re-served for three consecutive
# days before this landed.
#
# WHY LAST, when the obvious place is first. It is purely local, so failing early would save
# ~90s of Docker work — and that is the wrong trade. npm and Docker are independent failure
# domains, and running first makes the DATABASE conditional on npm: any reason `node_modules`
# is unusable would also cost Postgres, the migrations, both .env.local files and the ACL
# repair, none of which npm has anything to do with. The observed fault (#1631, three
# consecutive days) was a setup-time install failure with the registry perfectly reachable, so
# it is not even an exotic case. Running last, everything above has already succeeded and
# stays up: the session gets a working Postgres AND an honest sentinel naming the one thing
# that is broken. The check costs ~2.5s (`npm ls --depth=0`), ~3% of bringup, off the
# interactive path.
#
# Only the fatal signal reaches here — cs_verify_node_deps warns and returns 0 for a merely
# incomplete tree, so this message describes the one condition that produces it.
cs_log "Verifying the node toolchain..."
cs_verify_node_deps "$ROOT" \
  || fail "node_modules/.bin/turbo does not run (dependencies) — $(cs_failure_hint dependencies)"

# The soft signal rides in the .done BODY, not only in the log. Callers are told to wait for
# this sentinel, not to read /tmp/cloud-sandbox-up.log — so a warning that exists only in the
# log is a warning the session never sees, which is precisely the failure #1631 is about. It
# would be an odd fix that reproduced its own bug one file over.
printf '%s\n' "$(date -u +%FT%TZ)" >"$DONE_SENTINEL"
if [ "${CS_NODE_DEPS_WHY:-}" = "incomplete" ]; then
  printf 'WARN: npm ls --depth=0 reports a missing declared dependency; run `npm ci` if a workspace hits "Cannot find module".\n' \
    >>"$DONE_SENTINEL"
fi
cs_log "Cloud sandbox ready. Boot the API with: npm run start:dev -w apps/api"
