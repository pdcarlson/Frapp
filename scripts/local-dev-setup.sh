#!/usr/bin/env bash
# Local development bootstrap (WSL / Ubuntu primary).
# Does not start dockerd — use Docker Desktop (WSL integration) or `sudo service docker start` with docker.io.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

QUICK=false
for arg in "$@"; do
  if [[ "$arg" == "--quick" ]]; then
    QUICK=true
  fi
done

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running or not reachable from this shell."
  echo ""
  echo "  WSL + Docker Desktop: start Docker Desktop and enable your distro under Settings → Resources → WSL integration."
  echo "  WSL + docker.io package: sudo service docker start   (and ensure your user is in the docker group)"
  echo ""
  exit 1
fi

echo "Installing npm dependencies..."
npm install

echo "Starting Supabase (first run may take ~90s)..."
npx supabase start

echo "Applying local migrations..."
npx supabase db push --local

if [[ "$QUICK" == "false" ]]; then
  echo "Running typecheck and migration safety check..."
  npm run check-types
  npm run check:migration-safety
else
  echo "Skipping check-types and check:migration-safety (--quick)."
fi

echo ""
echo "✅ Local stack is ready."
echo ""
echo "Run each in its own terminal (Infisical-injected secrets from repo root):"
echo "  npm run dev:api       → http://localhost:3001  (Swagger: /docs)"
echo "  npm run dev:web       → http://localhost:3000"
echo "  npm run dev:landing   → http://localhost:3002"
echo "  npm run dev -w apps/docs → http://localhost:3005"
echo ""
echo "Supabase Studio: http://127.0.0.1:54323"
echo ""
