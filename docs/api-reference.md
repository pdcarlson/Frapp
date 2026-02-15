# API Reference

## Authentication
All API requests (except webhooks) require a `Bearer` token in the `Authorization` header.
Additionally, most endpoints require a `x-chapter-id` header to scope the request.

## Endpoints

### Backwork (Academic Library)
- `GET /api/backwork/upload-url?filename=...&contentType=...`
  - Returns a presigned S3 PUT URL and the S3 key.
- `POST /api/backwork`
  - Body: `CreateBackworkResourceDto`
  - Saves metadata and confirms upload. Auto-vivifies Courses/Professors.
- `GET /api/backwork/:id/download`
  - Returns a presigned S3 GET URL.

### Points (Internal Ledger)
- `GET /api/points/me`
  - Returns current user's balance and transaction history.
- `GET /api/points/leaderboard?limit=...`
  - Returns the top members in the chapter.
- `POST /api/points/adjust` (Admin Only)
  - Manually awards or deducts points.

### Events & Attendance
- `POST /api/events` (Admin Only)
  - Creates a new event with a configurable `pointValue`.
- `GET /api/events`
  - Lists all events for the chapter.
- `POST /api/events/:id/check-in`
  - Checks the current user into an event and automatically awards points.
- `GET /api/events/:id/attendance` (Admin Only)
  - Lists attendance status for all members for a specific event.

### Onboarding
- `POST /api/onboarding/init`
  - Initiates chapter creation and Stripe checkout.
- `POST /api/onboarding/join`
  - Joins a chapter using an invite token.

### Invites
- `POST /api/chapters/:id/invites` (Admin Only)
  - Generates a new invite token.

## Webhooks
- `POST /api/webhooks/clerk`
  - Securely syncs user data from Clerk.
- `POST /api/webhooks/stripe`
  - Processes subscription events and activates chapters.
