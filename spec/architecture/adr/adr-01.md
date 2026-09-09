### ADR-01: Why we split chat to Supabase Edge Functions

> **⚠️ Superseded for the hot path by [ADR-11](adr-11.md#adr-11-agent-dev-stack--chat-hot-path-moves-to-in-process-nestjs-pglite-for-local-db-validation-401) (#401 / #416).** `chat-send` and `chat-react` now live in NestJS (`apps/api/src/interface/controllers/chat.controller.ts`); the `supabase/functions/` Deno surface for chat retired in #416. The rationale below is retained as historical context — the cold-path / shared-validation framing still holds, only the hot-path split was unwound. ADR-11's "Trigger to revisit" governs any future reversal.

**Decision:** Chat hot-path writes (send message, add reaction, action/RSVP) go to Supabase Edge Functions (Deno), not NestJS.

**Rationale:** NestJS runs on a single Render instance (US-East). Edge Functions run at the CDN edge closest to the user, reducing p50 latency from ~150ms (single-region) to <50ms. The hot path is also the highest volume path — routing it past NestJS removes that single point of contention. Cold reads (history backfill, config, reports) stay in NestJS where guards, DTOs, and test infrastructure already live.

**Consequences:** Two write paths to maintain. Zod schemas in `packages/validation` must be importable from both Node.js and Deno (enforced by keeping validation dependency-light: `zod` only).
