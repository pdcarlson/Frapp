# Implementation Plan: Member Dues & Financials

## Phase 1: Financial Schema
- [x] **Task:** Update `apps/api/src/infrastructure/database/schema.ts` with `financial_invoices` and `financial_transactions`.
- [x] **Task:** Create repository interfaces (`IFinancialRepository`).
- [x] **Task:** Implement Drizzle repositories.
- [x] **Task:** Write unit tests for repositories.

## Phase 2: Financial Service & Stripe Extension
- [x] **Task:** Update `IBillingProvider` to support `createInvoiceCheckout(invoiceId, amount, ...)`
- [x] **Task:** Implement `FinancialService`.
    - **Logic:** Create Invoice.
    - **Logic:** Mark Invoice Paid (idempotent).
- [x] **Task:** Update `StripeService` to implement the new interface methods.
- [x] **Task:** Write unit tests for `FinancialService`.

## Phase 3: Webhook Handling
- [x] **Task:** Update `StripeWebhookController` (or create `FinancialWebhookController`) to handle invoice payment events.
- [x] **Task:** Ensure webhook logic routes correctly between "Chapter Subscriptions" and "Member Invoices".

## Phase 4: Interface Layer
- [x] **Task:** Create `FinancialController`.
    - `POST /invoices` (Admin).
    - `GET /invoices/my` (Member).
    - `POST /invoices/:id/pay` (Member).
- [x] **Task:** Write E2E tests for the Invoice -> Pay -> Webhook -> Paid flow.

## Phase 5: Finalization
- [x] **Task:** Update Swagger documentation.
- [x] **Task:** Ensure >80% test coverage.
- [x] **Task:** Run final Build, Lint, and Type checks.
- [x] **Task:** Conductor - Final Track Verification
