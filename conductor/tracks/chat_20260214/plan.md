# Implementation Plan: Real-time Chat System

## Phase 1: Chat Schema & Domain
- [x] **Task:** Update `apps/api/src/infrastructure/database/schema.ts` with `chat_channels` and `chat_messages`.
- [x] **Task:** Create repository interfaces for Channels and Messages.
- [x] **Task:** Implement Drizzle repositories.
- [x] **Task:** Write unit tests for repositories.

## Phase 2: Real-time Infrastructure (Socket.io)
- [x] **Task:** Install WebSocket dependencies (`@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`).
- [x] **Task:** Configure Redis adapter for Socket.io.
- [x] **Task:** Implement `ChatGateway` with JWT authentication in the handshake.
- [x] **Task:** Implement room-joining logic based on `chapter_id`.

## Phase 3: Chat Application Service
- [x] **Task:** Implement `ChatService`.
    - **Logic:** `sendMessage(senderId, channelId, content)`.
    - **Logic:** `fetchHistory(channelId, pagination)`.
    - **Logic:** Parse mentions and call `NotificationService`.
- [x] **Task:** Write unit tests for `ChatService`.

## Phase 4: Interface Layer (REST & WS)
- [x] **Task:** Implement REST endpoints for channel management.
- [x] **Task:** Implement WebSocket handlers for message broadcasting.
- [x] **Task:** Write E2E tests for the full chat flow (Message -> DB -> Broadcast -> Notification).

## Phase 5: Finalization
- [x] **Task:** Update Swagger documentation.
- [x] **Task:** Ensure >80% test coverage.
- [x] **Task:** Run final Build, Lint, and Type checks.
- [x] **Task:** Conductor - Final Track Verification
