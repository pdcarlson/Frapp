#!/usr/bin/env bash
# Load the demo chapter and make its president loginable.
#
#   scripts/demo/setup-demo.sh
#
# Idempotent: re-running rebuilds the demo chapter and re-links the login.
# Requires the local Supabase stack to be up (scripts/cloud-sandbox-up.sh).
set -euo pipefail

cd "$(dirname "$0")/../.."

DB_CONTAINER="${DB_CONTAINER:-supabase_db_Frapp}"
SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
DEMO_EMAIL="${DEMO_EMAIL:-marcus.ellison@westfield.edu}"
DEMO_PASSWORD="${DEMO_PASSWORD:-DemoShowcase!2026}"

# The database half of this script is hard-wired to the local container, but the
# auth user is created against $SUPABASE_URL. Left unguarded, an exported
# SUPABASE_URL pointing at staging would seed nothing there and still create a
# confirmed account whose password is committed to this repo.
case "$SUPABASE_URL" in
  http://127.0.0.1:* | http://localhost:* | http://0.0.0.0:*) ;;
  *)
    if [ "${ALLOW_NONLOCAL_SUPABASE:-}" != "1" ]; then
      echo "error: SUPABASE_URL is not a loopback address ($SUPABASE_URL)." >&2
      echo "       This script seeds the LOCAL database via 'docker exec $DB_CONTAINER'," >&2
      echo "       so pointing it elsewhere only creates a demo login on that host." >&2
      echo "       Set ALLOW_NONLOCAL_SUPABASE=1 if that is genuinely what you want." >&2
      exit 1
    fi
    ;;
esac

SERVICE_KEY="$(grep '^SUPABASE_SERVICE_ROLE_KEY=' apps/api/.env.local | cut -d'"' -f2)"
if [ -z "$SERVICE_KEY" ]; then
  echo "error: SUPABASE_SERVICE_ROLE_KEY not found in apps/api/.env.local" >&2
  exit 1
fi

echo "==> Seeding demo chapter"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
  < scripts/demo/demo-seed.sql

echo "==> Linking demo login ($DEMO_EMAIL)"
# The seed deletes and recreates public.users, so the auth user outlives it and
# has to be re-pointed each run. Create it if this is a fresh stack, otherwise
# reuse the existing one — GoTrue rejects a duplicate email.
auth_id="$(
  curl -sS "$SUPABASE_URL/auth/v1/admin/users?per_page=1000" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" |
  python3 -c "
import json,sys
email = sys.argv[1]
users = json.load(sys.stdin).get('users', [])
print(next((u['id'] for u in users if u.get('email') == email), ''))
" "$DEMO_EMAIL"
)"

if [ -z "$auth_id" ]; then
  auth_id="$(
    curl -sS -X POST "$SUPABASE_URL/auth/v1/admin/users" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"$DEMO_EMAIL\",\"password\":\"$DEMO_PASSWORD\",\"email_confirm\":true}" |
    python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))"
  )"
  echo "    created auth user $auth_id"
else
  echo "    reusing auth user $auth_id"
fi

if [ -z "$auth_id" ]; then
  echo "error: could not create or find the demo auth user" >&2
  exit 1
fi

docker exec "$DB_CONTAINER" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 -c \
  "UPDATE users SET supabase_auth_id = '$auth_id' WHERE email = '$DEMO_EMAIL';"

echo "==> Done. Sign in at http://localhost:3000/sign-in"
echo "    $DEMO_EMAIL / $DEMO_PASSWORD"
