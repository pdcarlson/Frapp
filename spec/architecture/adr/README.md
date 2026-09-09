# Architecture Decision Records

One file per ADR. [`spec/architecture/README.md`](../README.md) is the system map; this folder is the decision log. Policy: [`AGENTS.md` § ADR discipline](../../../AGENTS.md#adr-discipline).

| ADR | File |
| --- | --- |
| ADR-01: Why we split chat to Supabase Edge Functions | [adr-01.md](adr-01.md) |
| ADR-02: Why Supabase Realtime Broadcast for presence/typing | [adr-02.md](adr-02.md) |
| ADR-03: Why optimistic + idempotent client UUIDs | [adr-03.md](adr-03.md) |
| ADR-04: Why presence-aware push notifications | [adr-04.md](adr-04.md) |
| ADR-05: Dexie-backed offline queue + reconnect-with-backfill (Chunk 04) | [adr-05.md](adr-05.md) |
| ADR-06: `chat_notification_preferences` is a new table, not a column on `notification_preferences` (Chunk 05) | [adr-06.md](adr-06.md) |
| ADR-07: chat-react UPSERT semantics for poll vote-change (Chunk 05) | [adr-07.md](adr-07.md) |
| ADR-08: Audit→chat bridge via NestJS Realtime subscriber (Chunk 05) | [adr-08.md](adr-08.md) |
| ADR-09: Push worker host is the in-process NestJS API, with a documented scaling watermark (Chunk 05) | [adr-09.md](adr-09.md) |
| ADR-10: Supabase Realtime Presence is the presence source — no custom broadcast topic (Chunk 05) | [adr-10.md](adr-10.md) |
| ADR-11: Agent dev stack — chat hot path moves to in-process NestJS; PGlite for local DB validation (#401) | [adr-11.md](adr-11.md) |
| ADR-12: Agent hot-path verification — PGlite+NestJS default, Supabase branch opt-in (#401) | [adr-12.md](adr-12.md) |
| ADR-13: Repository visibility — public → private on GitHub Pro (2026-05-31) | [adr-13.md](adr-13.md) |
| ADR-14: Code review — CodeRabbit → self-hosted Claude review GitHub Action (2026-06-01) | [adr-14.md](adr-14.md) |
| ADR-15: CI cost — Actions-cache build dedup, Playwright/Docker caches, path-gating (2026-06-01) | [adr-15.md](adr-15.md) |
| ADR-16: Project management — retire the in-repo backlog, adopt Linear as canonical (2026-06-01) | [adr-16.md](adr-16.md) |
| ADR-17: Secret scanning — gitleaks pre-commit + CI gate (2026-06-03) | [adr-17.md](adr-17.md) |
| ADR-18: Agent operating docs — recurring rules vs one-off records; spec vs code (2026-08-19) | [adr-18.md](adr-18.md) |
| ADR-19: Retire the `production` branch — deploy a named commit from `main` (2026-08-28) | [adr-19.md](adr-19.md) |
| ADR-20: CI/CD pipeline redesign — production-shaped CI, one path to production, a six-stage program (2026-08-30) | [adr-20.md](adr-20.md) |
| ADR-21: Retire the Vercel Git integration — deploys move into CI (landing 2026-09-01, web 2026-09-02) | [adr-21.md](adr-21.md) |
