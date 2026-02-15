# Implementation Plan: Chapter Onboarding & Stripe Integration

## Phase 1: Modularization & Schema Foundation [checkpoint: 1e3acfc]

- [x] **Task:** Create `src/modules` directory and define `AuthModule`, `DatabaseModule`, and `ConfigModule` to refactor `AppModule`. c0a3f3f
- [x] **Task:** Update `schema.ts` to include `invites` table and expand `chapters` with Stripe fields. 9559ec7
- [x] **Task:** Run migration/push to update Postgres database. 9559ec7
- [x] **Task:** Update `DrizzleChapterRepository` to support new fields. f577fbf
- [x] **Task:** Conductor - User Manual Verification 'Modularization' 1e3acfc

## Phase 2: Billing Infrastructure (The Adapter)

- [x] **Task:** Define `IBillingProvider` interface in `domain/adapters`. 673af59
- [x] **Task:** Implement `StripeService` in `infrastructure/billing` using the `stripe` SDK. 673af59
- [x] **Task:** Register `StripeModule` and export the provider. 673af59
- [x] **Task:** Write unit tests for `StripeService` (mocking the external SDK). 673af59
- [x] **Task:** Conductor - User Manual Verification 'Billing Infrastructure' 673af59

## Phase 3: Onboarding API (The Payment Flow)

- [ ] **Task:** Implement `ChapterOnboardingService` in `application`.
    - 3.1: Define `OnboardingInitDto` and validation rules.
    - 3.2: Implement `initiateOnboarding` with atomic creation logic.
    - 3.3: Implement `handleBillingWebhook` to process `BillingEvent` from the adapter.
- [ ] **Task:** Create `OnboardingController` with `/init` endpoint.
- [ ] **Task:** Implement `StripeWebhookController` and `StripeWebhookGuard`.
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
