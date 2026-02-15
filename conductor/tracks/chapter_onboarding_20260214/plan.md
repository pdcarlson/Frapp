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

- [x] **Task:** Implement `ChapterOnboardingService` in `application`. fa54051
    - 3.1: Define `OnboardingInitDto` and validation rules. fa54051
    - 3.2: Implement `initiateOnboarding` with atomic creation logic. fa54051
    - 3.3: Implement `handleBillingWebhook` to process `BillingEvent` from the adapter. fa54051
- [x] **Task:** Create `OnboardingController` with `/init` endpoint. f1320f9
- [x] **Task:** Implement `StripeWebhookController` and `StripeWebhookGuard`. f1320f9
- [x] **Task:** Write E2E test for the onboarding flow (mocking Stripe response). f1320f9
- [x] **Task:** Conductor - User Manual Verification 'Onboarding Flow' f1320f9

## Phase 4: Invite System (The Growth)

- [x] **Task:** Create `InviteRepository` in `infrastructure`. 7abe0a4
- [x] **Task:** Add `createInvite` method to `ChapterService`. 7abe0a4
- [x] **Task:** Implement `POST /chapters/:id/invites` endpoint. a8c2b7c
- [x] **Task:** Implement `POST /onboarding/join` endpoint to process tokens. a8c2b7c
- [x] **Task:** Conductor - User Manual Verification 'Invite System' a8c2b7c

## Phase 5: Final Polish & Documentation

- [ ] **Task:** Update Swagger documentation for all new endpoints.
- [ ] **Task:** Ensure >80% test coverage for all new modules.
- [ ] **Task:** Run final Build, Lint, and Type checks.
- [ ] **Task:** Conductor - Final Track Verification
