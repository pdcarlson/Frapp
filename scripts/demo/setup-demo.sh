#!/usr/bin/env bash
# Load the demo chapter into the LOCAL stack and make its president loginable.
#
#   scripts/demo/setup-demo.sh
#
# Idempotent: re-running rebuilds the demo chapter and re-links the login.
# Requires the local Supabase stack to be up (scripts/cloud-sandbox-up.sh).
#
# Loopback only. A hosted project (staging, or production for App Review) is
# seeded with scripts/demo/seed-demo.mjs directly, under a namespace and
# password of its own: docs/guides/demo-data.md § Seed a hosted project.
set -euo pipefail

cd "$(dirname "$0")/../.."

DB_CONTAINER="${DB_CONTAINER:-supabase_db_Frapp}"
SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
# LOCAL_DEMO_EMAIL and LOCAL_DEMO_PASSWORD in seed-demo.mjs, restated because
# this is bash; the capture scripts import them.
LOCAL_PASSWORD='DemoShowcase!2026'
DEMO_EMAIL="${DEMO_EMAIL:-marcus.ellison@example.com}"
# The local stack's credential, and only the local stack's: seed-demo.mjs
# refuses this password for any non-loopback host.
DEMO_PASSWORD="${DEMO_PASSWORD:-$LOCAL_PASSWORD}"
# The marketing/screenshot chapter. capture-screenshots.mjs and
# capture-mobile.mjs read ids in this namespace.
NAMESPACE="c0ffee00"

case "$SUPABASE_URL" in
  http://127.0.0.1:* | http://localhost:* | http://0.0.0.0:*) ;;
  *)
    echo "error: SUPABASE_URL is not a loopback address ($SUPABASE_URL)." >&2
    echo "       This script seeds the local stack through 'docker exec $DB_CONTAINER'." >&2
    echo "       Seed a hosted project with scripts/demo/seed-demo.mjs instead:" >&2
    echo "       docs/guides/demo-data.md § Seed a hosted project." >&2
    exit 1
    ;;
esac

SERVICE_KEY="$(grep '^SUPABASE_SERVICE_ROLE_KEY=' apps/api/.env.local | cut -d'"' -f2)"
if [ -z "$SERVICE_KEY" ]; then
  echo "error: SUPABASE_SERVICE_ROLE_KEY not found in apps/api/.env.local" >&2
  exit 1
fi

export SUPABASE_URL DEMO_EMAIL DEMO_PASSWORD
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_KEY"

# The login first: the seed links roster #1 to the auth user with this email
# inside its own transaction, so the user has to exist before it runs.
echo "==> Demo login ($DEMO_EMAIL)"
node scripts/demo/seed-demo.mjs auth --namespace "$NAMESPACE"

echo "==> Seeding demo chapter"
node scripts/demo/seed-demo.mjs sql --namespace "$NAMESPACE" |
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1

echo "==> Uploading document and backwork placeholders"
node scripts/demo/seed-demo.mjs storage --namespace "$NAMESPACE"

echo "==> Done. Sign in at http://localhost:3000/sign-in"
# Only the committed local password is ever printed. DEMO_PASSWORD may be
# inherited from a shell that ran the production procedure in demo-data.md,
# and that value must not land in scrollback or a captured log.
if [ "$DEMO_PASSWORD" = "$LOCAL_PASSWORD" ]; then
  echo "    $DEMO_EMAIL / $DEMO_PASSWORD  (local stack only)"
else
  echo "    $DEMO_EMAIL / the password in DEMO_PASSWORD (not printed)"
fi
