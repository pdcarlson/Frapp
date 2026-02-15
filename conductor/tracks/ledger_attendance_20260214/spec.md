# Specification: House Points & Attendance

## 1. Overview
The House Points system is the "Internal Ledger" for each chapter. It tracks member engagement, rewards participation (Attendance, Academics), and allows for chapter-specific point configurations.

## 2. Database Schema (Drizzle)

### `point_transactions`
*Replaces ledger_transactions to focus on points.*
| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | uuid | Primary Key |
| `chapter_id` | uuid | References `chapters.id`, Not Null |
| `user_id` | uuid | References `users.id`, Not Null |
| `amount` | integer | Not Null (Positive for rewards, negative for fines/corrections) |
| `category` | text | Not Null (e.g., 'ATTENDANCE', 'ACADEMIC', 'SERVICE', 'FINE') |
| `description` | text | Not Null (e.g., "Attended Chapter Meeting") |
| `metadata` | jsonb | Optional (e.g., `{ "event_id": "...", "study_session_id": "..." }`) |
| `created_at` | timestamp | Default: now() |

### `events` (Configurable Rewards)
| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | uuid | Primary Key |
| `chapter_id` | uuid | References `chapters.id`, Not Null |
| `name` | text | Not Null |
| `description` | text | |
| `start_time` | timestamp | Not Null |
| `end_time` | timestamp | Not Null |
| `point_value` | integer | Default: 10 (Configurable per event) |
| `is_mandatory` | boolean | Default: false |
| `created_at` | timestamp | Default: now() |

### `event_attendance`
| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | uuid | Primary Key |
| `event_id` | uuid | References `events.id`, Not Null |
| `user_id` | uuid | References `users.id`, Not Null |
| `status` | text | Not Null ('PRESENT', 'EXCUSED', 'ABSENT', 'LATE') |
| `check_in_time` | timestamp | |

## 3. Key Workflows

### Configurable Attendance Reward
When an Admin creates an event, they set the `point_value`. When a member checks in:
1.  Check-in record is created.
2.  A `point_transaction` is automatically generated with `amount = event.point_value`.
3.  Atomic transaction ensures points are only awarded if check-in succeeds.

### Manual Adjustments (Fines/Rewards)
Admins (Presidents/Treasurers) can manually add or subtract points for things not tied to an event (e.g., "Cleaned the kitchen: +5 pts", "Missed cleaning duty: -10 pts").

## 4. API Boundaries
- `GET /api/points/my-points`: Returns total balance and recent transaction history.
- `GET /api/points/leaderboard`: Scoped to chapter, shows top members.
- `POST /api/points/adjust`: (Admin Only) Manual point adjustment.
- `POST /api/events/:id/check-in`: Self-service check-in that triggers reward logic.
