# Architecture Decision Records

One file per ADR. [`spec/architecture/README.md`](../README.md) is the system map; this folder is the decision log. Policy: [`AGENTS.md` § ADR discipline](../../../AGENTS.md#adr-discipline).

**Status** is read from each ADR's own text. *Current*: the decision stands as written. *Amended*: it stands, but dated amendments or corrections in the file change part of it, so read those before relying on the original text. *Superseded by ADR-N*: a later ADR replaced the decision, wholly or for the part named. *Lapsed*: the world the decision assumed no longer holds, and nothing replaced it. *Retired*: the file is deleted and the number is never reused.

| ADR | Status | File |
| --- | --- | --- |
| ADR-01: Why we split chat to Supabase Edge Functions | Superseded by ADR-11 for the chat hot path | [adr-01.md](adr-01.md) |
| ADR-02: Why Supabase Realtime Broadcast for presence/typing | Superseded by ADR-10 for presence; typing is still Broadcast | [adr-02.md](adr-02.md) |
| ADR-03: Why optimistic + idempotent client UUIDs | Amended | [adr-03.md](adr-03.md) |
| ADR-04: Why presence-aware push notifications | Amended | [adr-04.md](adr-04.md) |
| ADR-05: Dexie-backed offline queue + reconnect-with-backfill (Chunk 04) | Amended | [adr-05.md](adr-05.md) |
| ADR-06: `chat_notification_preferences` is a new table, not a column on `notification_preferences` (Chunk 05) | Amended | [adr-06.md](adr-06.md) |
| ADR-07: chat-react UPSERT semantics for poll vote-change (Chunk 05) | Current | [adr-07.md](adr-07.md) |
| ADR-08: Audit→chat bridge via NestJS Realtime subscriber (Chunk 05) | Current | [adr-08.md](adr-08.md) |
| ADR-09: Push worker host is the in-process NestJS API, with a documented scaling watermark (Chunk 05) | Amended | [adr-09.md](adr-09.md) |
| ADR-10: Supabase Realtime Presence is the presence source — no custom broadcast topic (Chunk 05) | Amended | [adr-10.md](adr-10.md) |
| ADR-11: Agent dev stack — chat hot path moves to in-process NestJS; PGlite for local DB validation (#401) | Amended | [adr-11.md](adr-11.md) |
| ADR-12: Agent hot-path verification — PGlite+NestJS default, Supabase branch opt-in (#401) | Amended | [adr-12.md](adr-12.md) |
| ADR-13: Repository visibility — public → private on GitHub Pro (2026-05-31) | Lapsed: the repo is public again (correction 2026-09-05) | [adr-13.md](adr-13.md) |
| ADR-14: Code review in CI (CodeRabbit, then a Claude Action, then the advisory `codex review` CLI) — **retired 2026-09-21; the number is never reused.** Deleted with the codex reviewer in [#2449](https://github.com/pdcarlson/Frapp/pull/2449); its text is in git history | Retired | — |
| ADR-15: CI cost — Actions-cache build dedup, Playwright/Docker caches, path-gating (2026-06-01) | Amended | [adr-15.md](adr-15.md) |
| ADR-16: Project management — retire the in-repo backlog, adopt Linear as canonical (2026-06-01) | Amended: GitHub Issues replaced Linear (amendment 5) | [adr-16.md](adr-16.md) |
| ADR-17: Secret scanning — gitleaks pre-commit + CI gate (2026-06-03) | Current | [adr-17.md](adr-17.md) |
| ADR-18: Agent operating docs — recurring rules vs one-off records; spec vs code (2026-08-19) | Amended | [adr-18.md](adr-18.md) |
| ADR-19: Retire the `production` branch — deploy a named commit from `main` (2026-08-28) | Amended: the Vercel half is superseded by ADR-21 | [adr-19.md](adr-19.md) |
| ADR-20: CI/CD pipeline redesign — production-shaped CI, one path to production, a six-stage program (2026-08-30) | Amended | [adr-20.md](adr-20.md) |
| ADR-21: Retire the Vercel Git integration — deploys move into CI (landing 2026-09-01, web 2026-09-02) | Amended | [adr-21.md](adr-21.md) |
| ADR-22: Sentry is the system of record for exceptions and traces; PostHog for product analytics | Amended | [adr-22.md](adr-22.md) |
| ADR-23: Multi-agent budget — one big review, everything else small, explicit effort (2026-09-23) | Amended | [adr-23.md](adr-23.md) |
| ADR-24: Delivery platform — outcome-verified delivery on the current hosts; Cloud Run only on triggers (2026-09-23) | Amended | [adr-24.md](adr-24.md) |
| ADR-25: The product is named Frapp; "Signet" stays the design system's internal name until after the beta (2026-09-23) | Current | [adr-25.md](adr-25.md) |
| ADR-26: Discord bot imports copy attachments inside Supabase, through an Edge Function (2026-09-29) | Amended | [adr-26.md](adr-26.md) |
