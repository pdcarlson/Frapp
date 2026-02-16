# Specification: Member Dues & Financials

## 1. Overview
The Member Dues module allows Chapter Treasurers to issue invoices to members (e.g., "Fall 2026 Dues", "T-Shirt Fee"). Members can view their outstanding balance and pay via Stripe.

## 2. Database Schema (Drizzle)

### `financial_invoices`
Tracks requests for payment issued to members.
| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | uuid | Primary Key |
| `chapter_id` | uuid | References `chapters.id`, Not Null |
| `user_id` | uuid | References `users.id`, Not Null |
| `title` | text | Not Null |
| `description` | text | |
| `amount` | integer | Not Null (in cents, e.g. 50000 = $500.00) |
| `status` | text | 'DRAFT', 'OPEN', 'PAID', 'VOID' |
| `due_date` | timestamp | Not Null |
| `paid_at` | timestamp | Nullable |
| `stripe_payment_intent_id` | text | Optional |
| `created_at` | timestamp | Default: now() |

### `financial_transactions`
The actual money log (Real Currency).
| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | uuid | Primary Key |
| `chapter_id` | uuid | References `chapters.id`, Not Null |
| `invoice_id` | uuid | References `financial_invoices.id`, Nullable |
| `amount` | integer | Not Null (Positive = Payment, Negative = Refund) |
| `type` | text | 'PAYMENT', 'REFUND', 'ADJUSTMENT' |
| `stripe_charge_id` | text | Optional |
| `created_at` | timestamp | Default: now() |

## 3. Architecture

### Financial Service
- **Logic:** `createInvoice(userId, amount, title)`.
- **Logic:** `processPayment(invoiceId, stripePaymentId)`. This updates the invoice status and creates a transaction record.
- **Logic:** `getChapterBalance(chapterId)`: Aggregates paid transactions.

### Billing Integration
- Reuse `StripeService` but extend it to support single-charge Checkout Sessions for invoices, distinct from the Chapter Subscription flow.

## 4. API Contracts

### `POST /api/financials/invoices` (Admin Only)
- **Body:** `{ userId, amount, title, dueDate }`
- **Effect:** Creates an OPEN invoice.

### `GET /api/financials/invoices/my`
- **Returns:** List of invoices for the current user.

### `POST /api/financials/invoices/:id/pay`
- **Effect:** Generates a Stripe Checkout URL for this specific invoice.

### `POST /api/webhooks/stripe`
- **Update:** Handle `checkout.session.completed` for Invoice payments.

## 5. Security & Decoupling
- **Separation:** Financials are distinct from "House Points". A payment *might* award points (gamification), but the systems remain separate.
- **Access:** Strict RBAC. Only Treasurers/Admins can issue invoices.
