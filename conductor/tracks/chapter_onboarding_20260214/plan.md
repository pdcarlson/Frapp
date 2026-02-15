# Implementation Plan: Chapter Onboarding & Stripe Integration

## Phase 1: Modularization & Schema Foundation

- [ ] **Task:** Create `src/modules` directory and define `AuthModule`, `DatabaseModule`, and `ConfigModule` to refactor `AppModule`.
- [ ] **Task:** Update `schema.ts` to include `invites` table and expand `chapters` with Stripe fields.
- [ ] **Task:** Run migration/push to update Postgres database.
- [ ] **Task:** Update `DrizzleChapterRepository` to support new fields.
- [ ] **Task:** Conductor - User Manual Verification 'Modularization'

## Phase 2: Billing Infrastructure (The Adapter)

- [ ] **Task:** Define `IBillingProvider` interface in `domain/adapters`.
- [ ] **Task:** Implement `StripeService` in `infrastructure/billing` using the `stripe` SDK.
- [ ] **Task:** Register `StripeModule` and export the provider.
- [ ] **Task:** Write unit tests for `StripeService` (mocking the external SDK).
- [ ] **Task:** Conductor - User Manual Verification 'Billing Infrastructure'

## Phase 3: Onboarding API (The Payment Flow)

- [ ] **Task:** Implement `ChapterOnboardingService` in `application`.
- [ ] **Task:** Create `OnboardingController` with `/init` endpoint.
- [ ] **Task:** Implement `StripeWebhookController` and `StripeWebhookGuard` (similar to Clerk).
- [ ] **Task:** Write E2E test for the onboarding flow (mocking Stripe response).
- [ ] **Task:** Conductor - User Manual Verification 'Onboarding Flow'

## Phase 4: Invite System (The Growth)

- [ ] **Task:** Create `InviteRepository` in `infrastructure`.
- [ ] **Task:** Add `createInvite` method to `ChapterService`.
- [ ] **Task:** Implement `POST /chapters/:id/invites` endpoint.
- [ ] **Task:** Implement `POST /onboarding/join` endpoint to process tokens.
- [ ] **Task:** Conductor - User Manual Verification 'Invite System'

## Phase 5: Final Polish & Documentation

- [ ] **Task:** Update Swagger documentation for all new endpoints.
- [ ] **Task:** Ensure >80% test coverage for all new modules.
- [ ] **Task:** Run final Build, Lint, and Type checks.
- [ ] **Task:** Conductor - Final Track Verification
