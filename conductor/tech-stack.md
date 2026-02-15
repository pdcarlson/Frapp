# Technical Architecture: Frapp

## 1. High-Level Stack

- **Monorepo Manager:** Turborepo
- **Package Manager:** npm
- **Cloud Provider:** AWS (Elastic Container Service)

## 2. Applications (`/apps`)

### `apps/api` (The Brain)

- **Framework:** NestJS (Node.js).
- **Language:** TypeScript (Strict).
- **Role:** REST API + WebSocket Gateway.
- **Security:**
  - `ClerkAuthGuard`: Validates JWT.
  - `ChapterGuard`: Enforces `x-chapter-id` header matches User's permissions.

### `apps/web` (The Admin Console)

- **Framework:** Next.js 15 (App Router).
- **UI Library:** Tailwind CSS + ShadCN UI.
- **Role:** High-density dashboards for Treasurers/Presidents.

### `apps/mobile` (The Member Experience)

- **Framework:** Expo (React Native).
- **Navigation:** Expo Router.
- **Local Database:** WatermelonDB (for offline chat caching).

## 3. Data Layer (`/packages/database`)

- **Database:** PostgreSQL 16.
- **ORM:** Drizzle ORM.
- **Schema Pattern:**
  - **Users:** `id`, `clerk_id`, `email`.
  - **Members:** `user_id`, `chapter_id`, `role_ids[]`.
  - **All Other Tables:** Must include `chapter_id` foreign key.

## 4. Infrastructure (AWS)

- **Compute:** AWS Fargate (Serverless Docker).
- **Storage:** AWS S3 (Private Buckets for "Backwork").
- **Caching:** AWS ElastiCache (Redis) - _Critical for Socket.io adapter._
- **CDN:** CloudFront (Asset delivery).
- **Logging:** AWS CloudWatch (Centralized logging).

## 5. Development Workflow (TDD)

1.  **Spec:** Write/Update `.agent/spec.md`.
2.  **Test:** Write a failing test in `apps/api/src/domain/x.spec.ts`.
3.  **Code:** Implement logic until Green.
4.  **Refactor:** Optimize.
