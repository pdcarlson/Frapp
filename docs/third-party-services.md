---
title: "Third-Party Services Strategy"
description: "When and how to provision external services like AWS, Stripe, and Clerk."
---

# Third-Party Services Strategy

Frapp relies on several heavy-lifting external services. To keep development fast and cheap, we delay provisioning real cloud infrastructure until it is absolutely necessary. 

Here is the strategy for when to create root access and how to manage these accounts.

## 1. Authentication (Clerk)
*   **Current State:** **Active (Dev).** You have created an account and have a Development instance running.
*   **When to create Prod:** Just before launch. You will click "Deploy to Production" in the Clerk dashboard. This gives you a completely separate set of API keys. Never mix Dev and Prod Clerk keys.
*   **Cost:** Free tier is generous (10k MAU).

## 2. Payments & Billing (Stripe)
*   **Current State:** Stubbed in the code (fails gracefully if keys are missing).
*   **When to create:** **Very Soon.** The next major feature involves Chapter Onboarding, which requires a Stripe Checkout session.
*   **Action Required:**
    1.  Create a free Stripe account.
    2.  Keep the "Test Mode" toggle ON.
    3.  Copy the `sk_test_...` key into `apps/api/.env.local`.
    4.  Set up a webhook endpoint (using Stripe CLI) to point to `localhost:3001/v1/webhooks/stripe` to test payment confirmations.
*   **When to create Prod:** You must undergo business verification (KYC) before turning off Test Mode. Do this ~2 weeks before launch.

## 3. Storage (AWS S3)
*   **Current State:** **Mocked (MinIO).** Our `docker-compose.yml` spins up a MinIO container that perfectly mimics an AWS S3 bucket on your local machine.
*   **When to create:** Not needed until we set up the **Staging Environment**.
*   **Action Required (Later):**
    1.  Create an AWS Root Account.
    2.  Immediately enable MFA.
    3.  Create an IAM User (never use Root keys in code).
    4.  Create an S3 bucket named `frapp-staging-uploads`.

## 4. Notifications (Expo Push Service)
*   **Current State:** Code is written to use `expo-server-sdk`.
*   **When to create:** **Now/Soon.** You need an Expo account to send push notifications to real devices.
*   **Action Required:**
    1.  Create an account at [expo.dev](https://expo.dev).
    2.  Run `eas login` in the terminal to link your local codebase to your Expo account.
    3.  This allows the API to send push notifications to the Expo Go app on your phone.

## Managing Secrets
As the developer, you must treat `.env.local` files like toxic waste—never commit them. 

When we transition to Staging/Production, we will adopt a Secret Manager (like **Infisical** or **Doppler**). This will allow you to run a command like `infisical run -- npm run dev`, which injects the secrets directly into memory from the cloud, eliminating the need for `.env` files entirely.
