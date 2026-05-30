#!/usr/bin/env bash

# Jules Environment Setup Script
# This script is used by Jules headless cloud VM environments to bootstrap the repository.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/cloud-sandbox-common.sh
. "$ROOT/scripts/lib/cloud-sandbox-common.sh"

# Start Docker and (if DOCKERHUB_USERNAME/TOKEN are set) authenticate to avoid pull limits.
cs_ensure_docker_daemon
cs_docker_login_if_creds

echo "Installing node dependencies..."
npm install

echo "Starting up Supabase (this may take up to 90s on the first run)..."
npx supabase start

echo "Applying migrations to local database..."
npx supabase db push --local

echo "Validating environment setup..."
npm run check-types
npm run check:migration-safety

echo "[OK] Environment setup complete! Database and dependencies are ready."
