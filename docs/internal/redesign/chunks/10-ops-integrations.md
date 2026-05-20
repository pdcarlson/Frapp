# Chunk 10 — Ops integrations (template + sub-chunks 10a–10h)

**Depends on:** Chunk 05 (renderer registry + slash dispatch + push worker).
**Unblocks:** mostly each other (10a–10h are independent and parallelizable).

This brief is the **template** for the ops integration pattern. Each sub-chunk (10a Events, 10b Tasks, 10c Points, 10d Dues, 10e Rush/Recruitment/Intake, 10f Backwork, 10g Reports, 10h Onboarding pathway) follows it.

## Read first (every sub-chunk)

1. `docs/internal/redesign/master-plan.md` — *Architecture: Chat as the spine* (the integration pattern).
2. `packages/chat-integrations/` (Chunk 05) — renderer registry. Drop your sub-chunk's renderers in here.
3. `apps/web/lib/chat/chat-client.ts` (Chunk 04) — action buttons fire through here.
4. The relevant `design-handoff/project/*.jsx` for your sub-chunk's dashboard view.
5. Existing module code, if any (grep for the module name in `apps/api/src/modules/` and `apps/web/app/(dashboard)/`).

## Branch convention

`claude/redesign-chunk-10<letter>-<slug>` (e.g. `claude/redesign-chunk-10a-events`). From `main`.

## Goal (per sub-chunk)

Ship one ops integration end-to-end following the integration pattern: slash command(s) + rich renderer + system channel + (optional) dashboard surface. All chat-side actions go through Edge Functions; heavy compute goes through NestJS RPC with a `kind="loading"` placeholder.

## Template tasks

1. **Schema** — add or extend the module's tables. RLS scoped to chapter membership. Migration named `<date>_<module>_*.sql`.
2. **NestJS module** (cold path) — domain logic, complex queries, exports. RPC endpoints for heavy slash commands.
3. **Renderer(s)** — add `kind="<module>"` to `packages/chat-integrations/`. One renderer per artifact type (e.g. events module may need just `event` renderer; dues module needs `dues_invoice` + `dues_reminder`).
4. **Slash command(s)** — register in `packages/chat-integrations/`. Simple commands → `chat-send` Edge Function with the right `kind`. Heavy commands → NestJS RPC + loading placeholder.
5. **System channel** — on module enable, create `#<module>` if not present (e.g. `#events`, `#dues`). Module's system messages land here. Member notification preferences default per master plan.
6. **Optional dashboard surface** — secondary to chat. Only build it if the module's longer-form view materially adds value (calendar for events, kanban for tasks, leaderboard for points).
7. **Module catalog entry** — flip the module to `enabled_modules` default-false in `packages/org-archetypes/MODULE_CATALOG` so it shows in the Modules tab with the right trial/pricing copy.
8. **Spec updates** — `spec/behavior.md` (slash commands + audit hooks), `spec/ui-web-dashboard.md` (renderer screens + dashboard if any), `spec/product.md` (module catalog).

## Sub-chunk specifics

### 10a — Events

- Slash commands: `/event <title> at <when>` and `/rsvp <event-id> <going|maybe|no>`.
- Renderer: title, time, location, RSVP buttons + counts.
- Optional check-in mode: officer enables QR check-in for an event; renderer shows "Check in" button when active.
- Optional dashboard: list / month / week views.

### 10b — Tasks

- Slash commands: `/task @member <title> due <when>`, `/done <task-id>`.
- Renderer: title, assignee, due date, "Done" / "Confirm done" buttons depending on viewer role.
- Optional dashboard: kanban (todo / awaiting confirm / done).

### 10c — Points

- Slash commands: `/points grant @member <amount> for <reason>`, `/points deduct @member <amount> for <reason>`.
- Renderer: actor → recipient + amount + reason. Append-only enforced (no edit, no delete; corrections are new entries).
- Optional dashboard: leaderboard + ledger.

### 10d — Dues / Billing

- Slash commands: `/dues remind overdue` (heavy — NestJS RPC), `/dues status @member` (renderer shows AR + Pay button), `/dues invoice @member <amount>`.
- Renderer: invoice card with Pay button → Stripe checkout (use existing Stripe integration).
- Reads `chapter_dues_config` (Chunk 07).
- Optional dashboard: per-member AR view, aging buckets.

### 10e — Rush / Recruitment / Intake (vocab varies)

- Slash commands: `/<vocab> add @candidate`, `/<vocab> vote <candidate-id>`, `/<vocab> bid @candidate`.
- Renderer: candidate card with voting + bid status.
- Optional dashboard: candidate funnel by stage.

### 10f — Backwork

- Slash command: `/backwork share <link>` posts a card; full upload happens in dashboard.
- Renderer: course / type / professor / term.
- Dashboard: the 5-step upload flow (dept → course → type → term → prof → AI redaction → attribution → review).

### 10g — Reports

- No slash commands (it's a read-only module).
- Dashboard only: chapter health, exports (CSV/PDF), retention.

### 10h — Onboarding pathway

- Slash command: `/pathway assign @member <pathway>`.
- Renderer: milestone progress card.
- Optional dashboard: 8-week milestones + big/little pairing.

## Verification (per sub-chunk)

- [ ] Slash command(s) work in `#general` and render the right card.
- [ ] Action buttons (RSVP, Done, Vote, Pay, Confirm) fire optimistically and reconcile on Realtime.
- [ ] Disabling the module hides slash commands + nav + system channel.
- [ ] System channel receives notifications when the module's artifacts are created.
- [ ] Two-archetype check where vocab matters (Rush/Recruitment/Intake especially).
- [ ] Spec docs updated.

## Handoff (per sub-chunk)

- Branch + PR named per sub-chunk (e.g. `Chunk 10a — Events`).
- Update `STATUS.md` row for that sub-chunk.
- Sub-chunks can be in flight in parallel after Chunk 05 ships — coordinate via STATUS.md.
