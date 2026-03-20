#!/usr/bin/env bash

# Jules Environment Setup Script
# This script is used by Jules headless cloud VM environments to bootstrap the repository.

echo "Starting Docker daemon..."
sudo dockerd &>/tmp/dockerd.log &

# Wait for Docker socket to become available
echo "Waiting for Docker socket..."
while [ ! -e /var/run/docker.sock ]; do sleep 1; done
echo "Docker is ready!"

echo "Installing node dependencies..."
npm install

echo "Starting up Supabase (this may take up to 90s on the first run)..."
npx supabase start

echo "Applying migrations to local database..."
npx supabase db push --local

echo "Validating environment setup..."
npm run check-types
npm run check:migration-safety

echo "✅ Environment setup complete! Database and dependencies are ready."
