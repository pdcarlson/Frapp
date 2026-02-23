---
title: "Local Development Guide"
description: "How to set up, run, and interact with the Frapp ecosystem locally."
---

# Local Development Guide

Welcome to the Frapp ecosystem. Because this is a monorepo containing a backend, a web app, a mobile app, and a documentation site, starting it up requires a few specific steps.

## Prerequisites

1. **Node.js** (v18+)
2. **npm** (v10+)
3. **Docker Desktop** (Running)
4. **Expo Go** (App installed on your iOS/Android device)

## Step 1: Environment Variables

For security, secrets are never committed to version control. You must create `.env.local` files in specific directories.

### Web App (`apps/web/.env`)
```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_... # Get from Clerk Dashboard
CLERK_SECRET_KEY=sk_test_...                 # Get from Clerk Dashboard
NEXT_PUBLIC_API_URL=http://localhost:3001/v1
```

### Mobile App (`apps/mobile/.env.local`)
```env
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_... # Same as Web
EXPO_PUBLIC_API_URL=http://localhost:3001/v1
```

### API (`apps/api/.env.local`)
```env
# Clerk
CLERK_SECRET_KEY=sk_test_... # Same as Web

# Database (Matches docker-compose.yml)
DATABASE_URL=postgres://postgres:password@localhost:5432/frapp

# Stripe (Optional for now, required for billing flows)
STRIPE_SECRET_KEY=sk_test_... 
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...

# AWS/MinIO (Matches docker-compose.yml for local testing)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
AWS_S3_BUCKET_NAME=frapp-uploads
```

## Step 2: Boot Infrastructure

Before starting the code, start the databases and services. Open a terminal in the root directory:

```bash
docker compose up -d
```
*This starts Postgres (Database), Redis (WebSockets), and MinIO (Local S3 storage).*

## Step 3: Push Database Schema

Ensure your local database has the correct tables.
```bash
npm run db:push -w apps/api
```

## Step 4: Run the Ecosystem

You can run everything at once from the root directory using Turborepo:

```bash
npm run dev
```

### Accessing the Sites:
*   **Web App (Command Center):** [http://localhost:3000](http://localhost:3000)
*   **API Swagger Docs:** [http://localhost:3001/docs](http://localhost:3001/docs)
*   **Developer Docs:** [http://localhost:3005](http://localhost:3005)

### Running Mobile:
The mobile app is best run in its own terminal window to easily scan the QR code.
```bash
cd apps/mobile
npm start
```
Scan the QR code with your phone's camera (iOS) or the Expo Go app (Android). Ensure your phone and PC are on the same Wi-Fi network.

## Updating the API Contract

If you change an endpoint in NestJS (`apps/api`), you must update the shared frontend SDK so the web and mobile apps know about it:

```bash
npm run openapi:export -w apps/api
npm run generate -w packages/api-sdk
```
