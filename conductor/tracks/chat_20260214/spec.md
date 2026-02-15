# Specification: Real-time Chat System

## 1. Overview
The Chat System provides real-time communication for chapter members. It supports role-gated channels, persistent message history, and integrates with the Notification System for alerts.

## 2. Database Schema (Drizzle)

### `chat_channels`
| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | uuid | Primary Key |
| `chapter_id` | uuid | References `chapters.id`, Not Null |
| `name` | text | Not Null |
| `description` | text | |
| `type` | text | 'PUBLIC', 'PRIVATE', 'ROLE_GATED' |
| `allowed_role_ids` | text[] | Optional |
| `created_at` | timestamp | Default: now() |

### `chat_messages`
| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | uuid | Primary Key |
| `channel_id` | uuid | References `chat_channels.id`, Not Null |
| `sender_id` | uuid | References `users.id`, Not Null |
| `content` | text | Not Null |
| `metadata` | jsonb | Optional (e.g., `{ "attachments": [...] }`) |
| `created_at` | timestamp | Default: now() |

## 3. Real-time Architecture (Socket.io)

### Chat Gateway
- **Technology:** NestJS WebSockets with Socket.io.
- **Scaling:** Redis adapter for multi-instance support.
- **Multi-tenancy:**
  - Users join rooms named by `chapter_id` and `channel_id`.
  - Authentication via JWT in the handshake.

### Flow: Sending a Message
1.  Client emits `sendMessage` event.
2.  Gateway validates user's membership in the channel.
3.  `ChatService` saves message to Postgres.
4.  Gateway broadcasts `newMessage` to the channel room.
5.  `ChatService` identifies mentions (e.g., `@user`) and calls `NotificationService.notifyUser()`.

## 4. API & WebSocket Contracts

### WebSockets
- `Event: joinChannel`: joins a specific channel room.
- `Event: sendMessage`: sends a message content.
- `Event: newMessage`: received by clients when a new message is posted.

### REST
- `GET /api/chat/channels`: List accessible channels for the user.
- `GET /api/chat/channels/:id/messages`: Paginated message history.
- `POST /api/chat/channels`: (Admin Only) Create a new channel.

## 5. Dependency: Notification System
The Chat System will use the Notification System to send push notifications for:
- Direct mentions (@user).
- New messages in channels where the user has notifications enabled.
