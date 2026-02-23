---
title: "Environments & CI/CD Roadmap"
description: "How Frapp transitions from local development to production scale."
---

# Environments & CI/CD Roadmap

As Frapp grows, managing how code moves from a developer's laptop to a user's phone requires a strict pipeline. Here is the blueprint for our environments and CI/CD strategy.

## The Three Environments

### 1. Local Development (Current)
*   **Infrastructure:** Docker Compose (Postgres, Redis, MinIO).
*   **Services:** Clerk (Development Instance), Stripe (Test Mode).
*   **Purpose:** Rapid iteration, building features, breaking things safely.

### 2. Staging / Preview (Next Step)
*   **Infrastructure:** 
    *   *Database:* Hosted Postgres (e.g., Supabase, Neon).
    *   *Web/Docs:* Vercel Preview Deployments.
    *   *API:* Render, Railway, or AWS App Runner.
*   **Services:** Clerk (Development Instance), Stripe (Test Mode), real AWS S3 (Development Bucket).
*   **Purpose:** QA testing, stakeholder review, testing Mobile builds before App Store submission.

### 3. Production (Launch)
*   **Infrastructure:** Scalable cloud architecture (AWS RDS, ECS, ElastiCache).
*   **Services:** Clerk (Production Instance - completely isolated users), Stripe (Live Mode), AWS S3 (Production Bucket).
*   **Purpose:** Serving real fraternities. Strict access controls. No test data.

---

## Continuous Integration (CI)

Every time a PR is opened to the `main` branch, a GitHub Action should run the following sequence to ensure the monorepo isn't broken:

1.  **Install & Link:** `npm install`
2.  **Lint:** `turbo run lint` (Checks Web, Mobile, API, Packages).
3.  **Type Check:** `turbo run check-types` (Ensures strict TypeScript compliance).
4.  **Test:** `turbo run test` (Runs Jest unit tests in the API and hooks).
5.  **Contract Verification:** Ensure `openapi.json` is up-to-date and `packages/api-sdk` matches the backend.

*If any step fails, the PR cannot be merged.*

---

## Continuous Deployment (CD)

Once code is merged to `main`:

### Web & Docs
*   **Provider:** Vercel
*   **Action:** Vercel automatically detects the push, runs `npm run build`, and deploys `apps/web` to `frapp.live` and `apps/docs` to `docs.frapp.live`.

### Backend API
*   **Provider:** Render / AWS
*   **Action:** A GitHub Action builds the Docker image for `apps/api`, runs database migrations (`drizzle-kit migrate`), and swaps out the live container with zero downtime.

### Mobile App
*   **Provider:** EAS (Expo Application Services)
*   **Action:** We trigger `eas build --platform all --profile production`.
*   **Over-the-Air (OTA) Updates:** For small UI fixes, we use EAS Update to push changes directly to users' phones without going through App Store review. For native code changes (e.g., adding a new camera library), we submit to Apple/Google.
