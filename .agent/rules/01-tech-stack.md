---
trigger: always_on
---

# Technical Stack & Standards

## Monorepo Structure

- **Manager:** Turborepo (`pnpm`)
- **API:** `apps/api` (NestJS + Fastify Adapter)
- **Web:** `apps/web` (Next.js 15 + ShadCN)
- **Mobile:** `apps/mobile` (Expo + React Native)
- **DB:** `packages/database` (Drizzle ORM + PostgreSQL)

## Key Libraries

- **Auth:** Clerk (Identity), Custom RBAC (Permissions)
- **Validation:** Zod (Global)
- **Communication:** Socket.io (NestJS Gateway), Redis (Adapter)
- **Billing:** Stripe SDK
- **Date Handling:** Date-fns

## Coding Style

- **Naming:** `camelCase` for variables, `PascalCase` for classes/components, `kebab-case` for filenames.
- **Comments:** Lowercase for inline comments (e.g., `// check permissions`). JSDoc for exported functions.
- **Exports:** Named exports only (Avoid `export default`).
