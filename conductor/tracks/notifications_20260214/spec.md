# Specification: Notification System

## 1. Overview
The Notification System is a foundational service used to alert members about events, mentions, and system updates. It is designed to be decoupled from the domains that trigger it (e.g., Chat, Ledger).

## 2. Database Schema (Drizzle)

### `push_tokens`
Stores Expo Push Tokens mapped to users.
| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | uuid | Primary Key |
| `user_id` | uuid | References `users.id`, Not Null |
| `token` | text | Not Null, Unique |
| `device_info` | jsonb | Optional |
| `created_at` | timestamp | Default: now() |

### `notifications` (In-App History)
| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | uuid | Primary Key |
| `chapter_id` | uuid | References `chapters.id`, Not Null |
| `user_id` | uuid | References `users.id`, Not Null |
| `title` | text | Not Null |
| `body` | text | Not Null |
| `data` | jsonb | Optional (e.g., `{ "chat_id": "...", "type": "MENTION" }`) |
| `read_at` | timestamp | Nullable |
| `created_at` | timestamp | Default: now() |

## 3. Architecture

### Notification Provider (Adapter Pattern)
- **Interface:** `INotificationProvider` in `domain/adapters`.
- **Implementation:** `ExpoNotificationProvider` in `infrastructure/notifications`.
- **Logic:** Handles the actual delivery to the Expo Push Service.

### Application Service
- **Service:** `NotificationService`.
- **Method:** `notifyUser(userId, payload)`.
- **Method:** `notifyChapter(chapterId, payload)`.
- **Workflow:**
  1. Save notification to `notifications` table (In-app history).
  2. Fetch user's `push_tokens`.
  3. Send push notification via the provider.

## 4. API Contracts
- `POST /api/notifications/tokens`: Register a new push token for the current user.
- `GET /api/notifications`: Get recent notification history for the user.
- `PATCH /api/notifications/:id/read`: Mark a notification as read.

## 5. Decoupling Logic
Other modules (like Chat) will depend on `NotificationService` but will not know about Expo or push tokens. They will simply call `notificationService.notifyUser()`.
