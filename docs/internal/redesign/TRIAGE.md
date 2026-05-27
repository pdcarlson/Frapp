# Issue triage — automation backlog mapped onto chunks

Cursor's "Suggestion Triage" automation (see `docs/internal/CURSOR_AUTOMATIONS.md`) does whole-repo product + security reviews and files `suggestion` + `area:*` + `severity:*` issues. Without active triage these accumulate and re-surface across reviews. This file maps each automation issue to its owning chunk (or marks it standalone / out-of-scope) so chunk agents inherit the relevant context and orchestrators don't re-discover the same findings.

> **Process:** when a new batch of `suggestion` issues lands, the orchestrator adds rows here, verifies the high/critical security findings against the code (automations can hallucinate), and references issues that gate a chunk in that chunk's brief's blocking-prerequisites section.

## Mapping (issues #242–#267, from the 2026-05-25 batch)

| # | Sev | Area | Title (short) | Owner |
| --- | --- | --- | --- | --- |
| 242 | critical | security | sendMessage missing sender-membership check | **Chunk 04 — Phase 0** (NestJS sibling of #233) |
| 243 | high | security | getMessages missing channel/chapter read auth | **Chunk 04 — Phase 0** |
| 244 | critical | security | Scope member role updates/removal to active chapter | **Chunk 09** (members) — RBAC tightening |
| 245 | critical | deps | Resolve critical/high npm audit vulns | Standalone (security ops, outside redesign) |
| 246 | high | security | Scope RBAC role update/delete to active chapter | **Chunk 07** (custom roles) + cross-cutting RBAC |
| 247 | high | security | Verify chapter membership before notification-preference reads/updates | **Chunk 05** (push worker + preferences) |
| 248 | high | ci | Make API lint script read-only (currently `eslint --fix`) | Standalone (CI hygiene) |
| 249 | high | ci | `check-types` reliable on fresh install | Standalone (CI hygiene) |
| 250 | critical | security | Enforce chapter subscription read/write locks across API routes | **Chunk 10d** (dues/billing) + cross-cutting |
| 251 | high | product | Wire `chapter_dues_config` to chapter-config API | **Chunk 10d** |
| 252 | high | product | Implement member invoice Stripe PaymentIntents | **Chunk 10d** |
| 253 | high | product | Replace mobile preview shell with spec-backed flows | **Chunk 11** (mobile chat parity opens the door) |
| 254 | high | ux | Require Terms/Privacy acceptance during chapter creation | **Chunk 03 follow-up** (wizard already shipped — small standalone PR) |
| 255 | high | ci | Run API E2E tests in CI | Standalone — relates to #235 (CI runtime-verify) |
| 256 | medium | api | Align rate limiting with spec per-user tracker + `Retry-After` | Standalone (API hardening) |
| 257 | medium | product | Branded PDF report export + signed download URLs | **Chunk 10g** (reports) |
| 258 | medium | research | Instrument push notification delivery metrics | **Chunk 05** (observability for push worker) |
| 259 | critical | security | Block President role changes via generic member role updates | **Chunk 09** + cross-cutting RBAC (pairs with #244, #246) |
| 260 | high | security | Validate upload-confirm storage paths before issuing download access | Standalone (storage hardening; touches multiple chunks that upload) |
| 261 | high | security | Filter global chat search results by channel access | **Chunk 05** (if chat search ships then; otherwise defer with the chat-search work) |
| 262 | medium | api | Persist Stripe webhook idempotency across restarts | **Chunk 10d** |
| 263 | high | api | Scheduled jobs for auto-absent + due notifications | **Chunk 10a** (auto-absent) + **Chunk 10d** (due notif) |
| 264 | medium | product | Gate disabled modules across nav, commands, API writes | **Chunk 06** (modules tab is the canonical control surface) |
| 265 | medium | ux | Multi-chapter dashboard switcher | **Chunk 06** (settings shell) or post-MVP — check master-plan |
| 266 | high | ux | Sync mobile notification preferences with server | **Chunk 11** (also relates to #247) |
| 267 | medium | research | Free-to-paid activation funnel instrumentation | **Chunk 12** (marketing) + analytics cross-cutting |

## Cluster notes

- **Chat authorization cluster** (gates Chunk 04): #233 (Edge `chat-send`), #234 (Edge `chat-react`), #242 (NestJS `sendMessage`), #243 (NestJS `getMessages` reads). #261 (search-result filtering) is adjacent — fold in if Chunk 04/05 ships chat search.
- **RBAC tightening cluster**: #244, #246, #259 — same class of bug in members / roles / president-protection. Best done together; map to Chunk 07 (custom roles) and Chunk 09 (members) coordination.
- **Dues / billing cluster**: #250, #251, #252, #262 — fold into Chunk 10d.
- **CI / runtime verification**: #235 (orchestrator-filed) + #248 / #249 / #255 (automation) — same general theme. #235 is the canonical roof for runtime migration + Edge Function verification; the others are independent CI hygiene.
- **Observability / metrics**: #258 (push), #267 (funnel) — small, ship alongside the relevant chunks.

## How to use this file

- **Orchestrator:** when starting a chunk's kickoff prompt, scan this file for that chunk's issues and reference them in the prompt's prerequisites or operating bar.
- **Chunk agent:** the chunk brief should already list its critical/high prerequisites; this file is the orchestrator's working ledger, not the source of truth for any one chunk.
- **New automation batches:** add rows; rinse-and-repeat.
