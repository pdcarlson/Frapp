# Domain Logic & Patterns

## 1. Multi-Tenancy
Every resource in Frapp is scoped to a `chapter_id`.
- **Database Level:** Almost all tables have a `chapter_id` foreign key.
- **API Level:** `ChapterGuard` ensures that the `x-chapter-id` header provided by the client matches a chapter the user is actually a member of.

## 2. Auto-vivification (Backwork)
When a member uploads a study resource, they provide a `courseCode` and `professorName`.
If these don't exist in the chapter's dictionary yet, the system automatically creates them. This ensures high-quality dropdowns for future users without requiring manual administrative entry.

## 3. Atomic Point Awarding
When a user checks into an event:
1.  The `AttendanceService` validates the event and user.
2.  It records the attendance (`status: PRESENT`).
3.  It calls the `PointsService` to award the event's `pointValue` to the user.
*Implementation Note:* Currently handled sequentially; future refinement will use database transactions for strict atomicity.

## 4. Double-Entry Point Ledger
The `point_transactions` table acts as an audit log.
- **Rewards:** Positive `amount`.
- **Fines/Corrections:** Negative `amount`.
- **Balance:** Calculated as a sum of all transactions for a user.

## 5. Webhook Synchronization
- **Clerk:** Users are synced to the local `users` table via Svix-verified webhooks.
- **Stripe:** Chapter subscription statuses are kept in sync via verified Stripe webhooks.
